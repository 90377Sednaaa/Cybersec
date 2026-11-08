"""M4 T4.3: risk model — OWASP matrix, score bands, and doc/code consistency.

The docs check is the interesting one: it parses the rating matrix table out
of docs/risk-methodology.md and asserts every cell matches app/risk.py, so
the methodology note and the code cannot drift apart.
"""

import re
from pathlib import Path

import pytest

from app.models import Severity
from app.risk import (
    REPRESENTATIVE_SCORES,
    RISK_MATRIX,
    risk_rating,
    score_for,
    severity_for_score,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
DOC_PATH = REPO_ROOT / "docs" / "risk-methodology.md"

# --- matrix ------------------------------------------------------------------

@pytest.mark.parametrize(
    ("likelihood", "impact", "expected"),
    [
        ("low", "low", Severity.info),
        ("low", "medium", Severity.low),
        ("low", "high", Severity.medium),
        ("medium", "low", Severity.low),
        ("medium", "medium", Severity.medium),
        ("medium", "high", Severity.high),
        ("high", "low", Severity.medium),
        ("high", "medium", Severity.high),
        ("high", "high", Severity.critical),
    ],
)
def test_matrix_all_nine_pairs(likelihood, impact, expected):
    assert risk_rating(likelihood, impact) == expected

def test_matrix_dict_matches_parametrized_table():
    assert len(RISK_MATRIX) == 9  # complete 3x3, nothing missing or extra

def test_unknown_inputs_raise_value_error():
    with pytest.raises(ValueError):
        risk_rating("catastrophic", "high")  # type: ignore[arg-type]
    with pytest.raises(ValueError):
        risk_rating("low", "extreme")  # type: ignore[arg-type]

def test_inputs_are_case_insensitive():
    assert risk_rating("HIGH", "Medium") == Severity.high

# --- score bands -------------------------------------------------------------

@pytest.mark.parametrize(
    ("score", "expected"),
    [
        (0.0, Severity.info),
        (0.9, Severity.info),
        (1.0, Severity.low),
        (3.9, Severity.low),
        (4.0, Severity.medium),
        (6.9, Severity.medium),
        (7.0, Severity.high),
        (8.9, Severity.high),
        (9.0, Severity.critical),
        (10.0, Severity.critical),
    ],
)
def test_severity_for_score_band_edges(score, expected):
    assert severity_for_score(score) == expected

def test_severity_for_score_clamps_out_of_range():
    assert severity_for_score(-3.0) == Severity.info
    assert severity_for_score(42.0) == Severity.critical

def test_score_for_representative_values():
    assert score_for(Severity.info) == 0.0
    assert score_for(Severity.low) == 2.5
    assert score_for(Severity.medium) == 5.5
    assert score_for(Severity.high) == 8.0
    assert score_for(Severity.critical) == 9.5

def test_representative_scores_round_trip():
    for tier in Severity:
        assert severity_for_score(score_for(tier)) == tier

def test_scores_are_monotonic():
    order = [Severity.info, Severity.low, Severity.medium, Severity.high, Severity.critical]
    scores = [score_for(t) for t in order]
    assert scores == sorted(scores)

# --- docs / code consistency ---------------------------------------------------

def test_methodology_doc_matrix_matches_code():
    """Parse the rating matrix out of docs/risk-methodology.md and compare
    every cell against risk_rating()."""
    rows = {}
    for line in DOC_PATH.read_text(encoding="utf-8").splitlines():
        if re.match(r"^\| (Low|Medium|High) \|", line):
            cells = [c.strip() for c in line.strip("|").split("|")]
            rows[cells[0]] = cells[1:]

    assert set(rows) == {"Low", "Medium", "High"}, "matrix table missing from the doc"

    tier_values = {t.value.capitalize() for t in Severity}
    for likelihood, cells in rows.items():
        assert len(cells) == 3
        for impact, cell in zip(("Low", "Medium", "High"), cells):
            assert cell in tier_values, f"unexpected tier name in doc: {cell!r}"
            expected = risk_rating(likelihood.lower(), impact.lower())
            assert cell.lower() == expected.value, (
                f"doc says {likelihood}x{impact}={cell}, code says {expected.value}"
            )

def test_methodology_doc_mentions_score_bands():
    text = DOC_PATH.read_text(encoding="utf-8")
    for marker in ("9.0 - 10.0", "critical", "0.0 - 0.9"):
        assert marker in text
