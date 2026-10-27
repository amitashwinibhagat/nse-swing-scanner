from corporate_actions import _normalise_action_rows, lookup_corporate_actions


def test_normalise_action_rows_accepts_raw_payload():
    rows = _normalise_action_rows({
        "_raw": [{"SYMBOL": "ABC", "purpose": "BONUS", "exDate": "2026-10-30"}],
    })
    assert rows == [{"symbol": "ABC", "action": "BONUS", "ex_date": "2026-10-30"}]


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
