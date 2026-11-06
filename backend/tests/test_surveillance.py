"""Tests for the surveillance adapter (parsing + status policy, no network)."""

import pytest

from surveillance import (
    _merge_restrictions,
    _parse_asm_payload,
    _parse_sec_list_csv,
    check_symbol,
)


ASM_PAYLOAD = {
    "longterm": {
        "data": [
            {
                "symbol": "A2ZINFRA",
                "asmSurvIndicator": "Stage I",
                "survDesc": "Long Term Additional Surveillance Measure (LTASM) - Stage I",
            }
        ]
    },
    "shortterm": {
        "data": [
            {
                "symbol": "ACUTAAS",
                "asmSurvIndicator": "Stage I",
                "survDesc": "Short Term Additional Surveillance Measure (STASM) - Stage I",
            }
        ]
    },
}

SEC_LIST_CSV = """Symbol,Series,Security Name,Band,Remarks
RELIANCE,EQ,RELIANCE INDUSTRIES LIMITED,20,"-"
ABAN,BE,ABAN OFFSHORE LIMITED,2,"-"
ANKITMETAL,BZ,ANKIT METAL & POWER LIMITED,2,"GSM STAGE - 0"
XYZ,EQ,XYZ LIMITED,5,"GSM STAGE - 3"
"""


def test_parse_asm_payload_reads_both_buckets():
    out = _parse_asm_payload(ASM_PAYLOAD)
    assert out["A2ZINFRA"]["t_group"] is True
    assert out["ACUTAAS"]["t_group"] is True
    assert "LTASM" in out["A2ZINFRA"]["detail"]
    assert "STASM" in out["ACUTAAS"]["detail"]


def test_parse_asm_payload_handles_garbage():
    assert _parse_asm_payload(None) == {}
    assert _parse_asm_payload({"longterm": "nope"}) == {}
    assert _parse_asm_payload({"longterm": {"data": [None, "x", {"nope": 1}]}}) == {}


def test_parse_sec_list_flags_trade_for_trade_series():
    out = _parse_sec_list_csv(SEC_LIST_CSV)
    assert out["ABAN"]["t_group"] is True
    assert out["ABAN"]["detail"] == "series BE"
    # BZ is trade-for-trade AND carries a GSM remark.
    assert out["ANKITMETAL"]["t_group"] is True
    assert out["ANKITMETAL"]["gsm"] is True


def test_parse_sec_list_flags_gsm_without_series_restriction():
    out = _parse_sec_list_csv(SEC_LIST_CSV)
    assert out["XYZ"]["gsm"] is True
    assert out["XYZ"]["t_group"] is False


def test_parse_sec_list_leaves_normal_names_clean():
    out = _parse_sec_list_csv(SEC_LIST_CSV)
    assert "RELIANCE" not in out


def test_parse_sec_list_handles_empty_body():
    assert _parse_sec_list_csv("") == {}
    assert _parse_sec_list_csv("not,a,real,csv") == {}


def test_merge_prefers_union_of_flags():
    merged = _merge_restrictions(
        {"A": {"t_group": True, "gsm": False, "source": "a"}},
        {"A": {"t_group": False, "gsm": True, "source": "b"}},
    )
    assert merged["A"]["t_group"] is True
    assert merged["A"]["gsm"] is True


def test_check_symbol_distinguishes_clean_from_unknown():
    ok_payload = {"status": "ok", "source": "nse:reportASM", "data": {}}
    res = check_symbol(ok_payload, "RELIANCE")
    assert res["is_restricted"] is False
    assert res["source_status"] == "ok"

    # An empty payload with a degraded status must surface that status, so the
    # gate/UI can tell "verified clean" from "could not verify".
    flag_payload = {"status": "flag_only", "source": "none", "data": {}}
    res = check_symbol(flag_payload, "RELIANCE")
    assert res["is_restricted"] is False
    assert res["source_status"] == "flag_only"


@pytest.mark.parametrize(
    "record,expected_type",
    [
        ({"t_group": True, "gsm": False, "suspended": False}, "t_group"),
        ({"t_group": True, "gsm": True, "suspended": False}, "gsm"),
        ({"t_group": True, "gsm": True, "suspended": True}, "suspended"),
    ],
)
def test_check_symbol_reports_the_most_severe_restriction(record, expected_type):
    payload = {"status": "ok", "data": {"ACME": {**record, "source": "x"}}}
    res = check_symbol(payload, "ACME")
    assert res["is_restricted"] is True
    assert res["restriction_type"] == expected_type
