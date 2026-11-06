import json
from datetime import date

import pytest

from corporate_actions import (
    _has_excluded_action_within,
    _normalise_action_rows,
    fetch_corporate_actions_list,
    lookup_corporate_actions,
    parse_action_date,
)


# --- date parsing: the regression that zeroed the PASS list -----------------

@pytest.mark.parametrize(
    "raw,expected",
    [
        ("06-Nov-2026", date(2026, 11, 6)),   # NSE's real format
        ("06-nov-2026", date(2026, 11, 6)),   # case-insensitive month
        ("2026-11-06", date(2026, 11, 6)),    # ISO
        ("06-11-2026", date(2026, 11, 6)),    # DD-MM-YYYY
        ("06/11/2026", date(2026, 11, 6)),
        ("06 Nov 2026", date(2026, 11, 6)),
        ("2026-11-06T00:00:00.000", date(2026, 11, 6)),
    ],
)
def test_parse_action_date_accepts_nse_formats(raw, expected):
    assert parse_action_date(raw) == expected


@pytest.mark.parametrize("raw", [None, "", "-", "NA", "not-a-date", 12345.6])
def test_parse_action_date_rejects_garbage(raw):
    assert parse_action_date(raw) is None


# --- excluded-action window ------------------------------------------------

def test_excluded_action_today_is_detected():
    """Reproduces the production bug: `06-Nov-2026` used to parse as None and
    the gate silently passed every name."""
    actions = [{"action": "FACE VALUE SPLIT (SUB-DIVISION)", "ex_date": "06-Nov-2026"}]
    assert _has_excluded_action_within(actions, 30, today=date(2026, 11, 6)) is True


def test_excluded_action_inside_window():
    actions = [{"action": "BONUS 1:2", "ex_date": "20-Nov-2026"}]
    assert _has_excluded_action_within(actions, 30, today=date(2026, 11, 6)) is True


def test_excluded_action_outside_window():
    actions = [{"action": "BONUS 1:2", "ex_date": "20-Jan-2027"}]
    assert _has_excluded_action_within(actions, 30, today=date(2026, 11, 6)) is False


def test_recent_past_ex_date_still_counts():
    actions = [{"action": "SPLIT", "ex_date": "05-Nov-2026"}]
    assert _has_excluded_action_within(actions, 30, today=date(2026, 11, 6)) is True


def test_long_past_ex_date_does_not_count():
    actions = [{"action": "SPLIT", "ex_date": "01-Oct-2026"}]
    assert _has_excluded_action_within(actions, 30, today=date(2026, 11, 6)) is False


def test_non_excluded_action_does_not_trip_the_gate():
    """Dividends and interest payments are not price-contaminating."""
    actions = [{"action": "INTERIM DIVIDEND - RS 3.05 PER SHARE", "ex_date": "06-Nov-2026"}]
    assert _has_excluded_action_within(actions, 30, today=date(2026, 11, 6)) is False


def test_undateable_excluded_action_fails_closed():
    actions = [{"action": "DEMERGER", "ex_date": "whenever"}]
    assert _has_excluded_action_within(actions, 30, today=date(2026, 11, 6)) is True


# --- payload normalisation -------------------------------------------------

def test_normalise_action_rows_accepts_real_nse_shape():
    rows = _normalise_action_rows({
        "_raw": [
            {
                "symbol": "HAPPSTMNDS",
                "subject": "Face Value Split (Sub-Division)",
                "exDate": "06-Nov-2026",
                "recDate": "06-Nov-2026",
                "series": "EQ",
            }
        ],
    })
    assert rows == [
        {
            "symbol": "HAPPSTMNDS",
            "action": "FACE VALUE SPLIT (SUB-DIVISION)",
            "ex_date": "06-Nov-2026",
        }
    ]


def test_normalise_action_rows_accepts_raw_payload_without_wrapper():
    rows = _normalise_action_rows({
        "_raw": [{"SYMBOL": "ABC", "purpose": "BONUS", "exDate": "2026-10-30"}],
    })
    assert rows == [{"symbol": "ABC", "action": "BONUS", "ex_date": "2026-10-30"}]


def test_normalise_action_rows_rejects_non_list():
    assert _normalise_action_rows({"data": "nope"}) is None
    assert _normalise_action_rows(None) is None


# --- lookup ----------------------------------------------------------------

def test_lookup_corporate_actions_fails_closed_for_source_failure():
    result = lookup_corporate_actions({
        "source": "nse:corporate-actions",
        "status": "source_failed",
        "error": "unreachable",
        "data": None,
    }, "ABC")
    assert result["status"] == "source_failed"
    assert "data" not in result


def test_lookup_corporate_actions_marks_absent_symbol_not_applicable():
    result = lookup_corporate_actions({
        "source": "nse:corporate-actions",
        "status": "ok",
        "data": {},
    }, "ABC")
    assert result["status"] == "not_applicable"
    assert result["data"]["has_excluded_action"] is False


# --- fetch: request construction (the "Missing index" regression) ----------

class _FakeResponse:
    def __init__(self, payload, status=200):
        self._payload = payload
        self.status_code = status
        self.text = json.dumps(payload) if not isinstance(payload, str) else payload

    def json(self):
        return json.loads(self.text)


def test_fetch_requests_index_and_date_range(monkeypatch):
    """Without ?index=equities&from_date=...&to_date=... NSE answers HTTP 200
    with the body `Missing index`, which json-decode rejects. Assert we always
    send all three."""
    captured = {}

    def fake_get(path, **kwargs):
        captured["path"] = path
        captured.update(kwargs.get("params") or {})
        return _FakeResponse(
            [{"symbol": "ACME", "subject": "Bonus 1:1", "exDate": "20-Nov-2026"}]
        )

    monkeypatch.setattr("corporate_actions.nse_get", fake_get)
    payload = fetch_corporate_actions_list(today=date(2026, 11, 6))

    assert captured["path"] == "/api/corporates-corporateActions"
    assert captured["index"] == "equities"
    assert "-" in captured["from_date"] and "-" in captured["to_date"]
    # DD-MM-YYYY, not ISO
    assert captured["from_date"] == "03-11-2026"
    assert captured["to_date"] == "06-12-2026"
    assert payload["status"] == "ok"
    assert payload["data"]["ACME"]["has_excluded_action"] is True


def test_fetch_returns_source_failed_when_endpoint_is_unreachable(monkeypatch):
    monkeypatch.setattr("corporate_actions.nse_get", lambda *a, **k: None)
    payload = fetch_corporate_actions_list(today=date(2026, 11, 6))
    assert payload["status"] == "source_failed"
    assert payload["error"]


def test_source_failed_message_names_the_actual_cause(monkeypatch):
    """A bare "not reachable" was undiagnosable from a CI log. NSE's failure
    modes differ (Akamai block, `Missing index`, non-JSON body) and need
    different fixes, so the envelope carries the status and a body preview."""
    monkeypatch.setattr(
        "corporate_actions.nse_get",
        lambda *a, **k: _FakeResponse("Missing index", status=200),
    )
    payload = fetch_corporate_actions_list(today=date(2026, 11, 6))
    assert payload["status"] == "source_failed"
    assert "not JSON" in payload["error"]
    assert "HTTP 200" in payload["error"]
    assert "Missing index" in payload["error"]


def test_fetch_does_not_cache_failures(monkeypatch):
    calls = {"n": 0}

    def fake_get(*a, **k):
        calls["n"] += 1
        return None

    monkeypatch.setattr("corporate_actions.nse_get", fake_get)
    fetch_corporate_actions_list(today=date(2026, 11, 6))
    fetch_corporate_actions_list(today=date(2026, 11, 6))
    assert calls["n"] == 2
