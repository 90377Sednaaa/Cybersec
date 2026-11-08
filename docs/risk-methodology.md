# Risk methodology — severity and scoring (M4)

How Aletheia rates the risk of a finding: the assessor picks one of the four
severity tiers (plus info), and the numeric 0-10 score shown in the report's
risk table comes from the mapping in this document. The mapping is implemented
in `backend/app/risk.py` and unit-tested against this file, so the two cannot
drift apart.

## 1. Framework: OWASP Risk Rating Methodology

We apply the [OWASP Risk Rating Methodology](https://owasp.org/www-community/OWASP_Risk_Rating_Methodology)
in its qualitative form. Each finding is judged along two axes:

- **Likelihood** — how probable is it that this weakness gets exploited here?
  Estimated from the OWASP threat-agent factors (skill level, motive,
  opportunity, population) and vulnerability factors (ease of discovery,
  ease of exploit, awareness, intrusion detection).
- **Impact** — how much damage would that exploitation cause?
  Estimated from the OWASP technical-impact factors (loss of confidentiality,
  integrity, availability, accountability) plus business impact
  (financial damage, reputation, non-compliance, privacy loss).

Both axes are rated **Low / Medium / High**; the pair maps onto our severity
tiers through the matrix below. OWASP's lowest cell ("Note") is expressed as
our `info` tier.

## 2. Rating matrix (likelihood x impact -> severity)

This exact table is parsed and verified by `backend/tests/test_risk_model.py`.

| Likelihood \ Impact | Low | Medium | High |
|---|---|---|---|
| Low | Info | Low | Medium |
| Medium | Low | Medium | High |
| High | Medium | High | Critical |

Examples from the demo target (OWASP Juice Shop):

- Missing `Content-Security-Policy` header: likelihood **high** (trivially
  discovered), impact **medium** (defence-in-depth loss) -> **High**.
- Slowloris-resistant but unpatched outdated library: likelihood **medium**,
  impact **high** -> **High**.
- Server banner discloses exact version: likelihood **low**, impact **low**
  -> **Info**.

## 3. Numeric score bands (0-10)

The report shows one numeric score per finding. Bands are:

| Score | Tier |
|---|---|
| 0.0 - 0.9 | info |
| 1.0 - 3.9 | low |
| 4.0 - 6.9 | medium |
| 7.0 - 8.9 | high |
| 9.0 - 10.0 | critical |

`app/risk.py#score_for` returns the representative value of a tier's band
(info 0.0, low 2.5, medium 5.5, high 8.0, critical 9.5) when the assessor has
set a severity but no explicit score; `severity_for_score` is the inverse.
Out-of-range scores are clamped, never wrapped.

## 4. Where ratings come from

- **Tool-informed start:** the normalizer seeds `ai_candidate` findings with
  severities from the tool's own classification (e.g. ZAP alert risk levels)
  via its keyword/category mapping; these are suggestions, not decisions.
- **Human decision:** only the assessor's PATCH (`PATCH /api/findings/{id}`,
  `severity` and optional `score`) is authoritative. The state machine records
  who verified what and when.
- **Report:** the PDF risk table groups findings by tier and shows each
  finding's score (explicit if set, representative otherwise), plus this
  methodology note as the "framework references" section.

## 5. References

- OWASP Risk Rating Methodology — https://owasp.org/www-community/OWASP_Risk_Rating_Methodology
- OWASP Top 10 (category language used in findings) — https://owasp.org/www-project-top-ten/
- OWASP Cheat Sheet Series (remediation text sources) — https://cheatsheetseries.owasp.org/
