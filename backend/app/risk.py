"""Risk model (M4): OWASP Risk Rating mapping and the 0-10 score helper.

Severity on findings is the assessor's judgement, but it must be applied the
same way every time. This module is the single source of truth for:

- the OWASP Risk Rating matrix (likelihood x impact -> severity tier), and
- the mapping between the 4 severity tiers (plus info) and the 0-10 numeric
  score shown in the report's risk table.

The matrix is documented in docs/risk-methodology.md; test_risk_model.py
parses that table back and asserts it matches this code, so doc and code
cannot drift apart silently.
"""

from typing import Literal

from app.models import Severity

Likelihood = Literal["low", "medium", "high"]
Impact = Literal["low", "medium", "high"]

# OWASP Risk Rating Methodology: the qualitative result of likelihood x impact.
# (low, low) is OWASP's "Note" tier, which we express as `info`.
RISK_MATRIX: dict[tuple[str, str], Severity] = {
    ("low", "low"): Severity.info,
    ("low", "medium"): Severity.low,
    ("low", "high"): Severity.medium,
    ("medium", "low"): Severity.low,
    ("medium", "medium"): Severity.medium,
    ("medium", "high"): Severity.high,
    ("high", "low"): Severity.medium,
    ("high", "medium"): Severity.high,
    ("high", "high"): Severity.critical,
}

# 0-10 score bands per tier. `info` is reserved for the near-zero end; the
# bands are the inverse of score_for()'s representative values.
SCORE_BANDS: tuple[tuple[float, Severity], ...] = (
    (1.0, Severity.info),  # score < 1.0
    (4.0, Severity.low),  # 1.0 <= score < 4.0
    (7.0, Severity.medium),  # 4.0 <= score < 7.0
    (9.0, Severity.high),  # 7.0 <= score < 9.0
    (float("inf"), Severity.critical),  # 9.0 <= score <= 10
)

# Representative score per tier (the middle of its band; used when a finding
# has a severity but the assessor did not set an explicit score).
REPRESENTATIVE_SCORES: dict[Severity, float] = {
    Severity.info: 0.0,
    Severity.low: 2.5,
    Severity.medium: 5.5,
    Severity.high: 8.0,
    Severity.critical: 9.5,
}

def risk_rating(likelihood: Likelihood, impact: Impact) -> Severity:
    """Map an OWASP likelihood x impact pair to a severity tier.

    Raises ValueError on anything outside the 3x3 qualitative scale —
    callers classify first, this function never guesses.
    """
    try:
        return RISK_MATRIX[(likelihood.lower(), impact.lower())]
    except KeyError as exc:
        raise ValueError(
            f"Unknown likelihood/impact pair: {likelihood!r} x {impact!r}. "
            "Both must be one of: low, medium, high."
        ) from exc

def severity_for_score(score: float) -> Severity:
    """Map a 0-10 numeric score to its severity tier (values are clamped)."""
    clamped = min(max(score, 0.0), 10.0)
    for upper, tier in SCORE_BANDS:
        if clamped < upper:
            return tier
    return Severity.critical  # unreachable: inf upper bound catches all

def score_for(severity: Severity) -> float:
    """Representative 0-10 score for a severity tier (band midpoint)."""
    return REPRESENTATIVE_SCORES[severity]
