# Known Issues / To Revisit

## 1. Scoring: precipitation probability is decoupled from amount

**Problem:** The scoring algorithm treats `precipProb` and `precip` (mm) as fully independent
parameters. Both can independently turn a cell amber or red. This means:
- 100% probability of 0.1mm → scores **red** (because prob > 60%)
- A light drizzle at absolute certainty is rated worse than heavier rain at lower probability

This doesn't reflect climbing reality. 0.1mm at 100% probability is a trace of drizzle;
it should not score the same as 5mm at 100%.

**Root cause:** Open-Meteo's `precipitation_probability` is the probability that *any* precipitation
falls in that hour — even a trace. MET Norway doesn't provide a probability field at all (null → 0).
So the combined precipProb is effectively just Open-Meteo's value, unweighted by amount.

**Possible fixes to explore:**
- Use an *expected precipitation* metric: `expectedPrecip = precip * (precipProb / 100)` and score
  that single number instead of scoring amount and probability separately.
- Drop precipProb from hourly scoring entirely and rely only on forecast amounts.
- Only apply prob-based scoring when `precipProb > 70% AND precip > 0.5mm`.

## 2. Score colour with no visible explanation

**Problem:** A row turns red but the user sees e.g. 0.0mm precip and doesn't understand why.
Before we removed the Prob column, the contradiction was visible (confusing). Now it's invisible
(more confusing). Either the scoring needs fixing (see #1) or enough context needs to be shown
so users can understand what parameter triggered the score.

## 3. MET Norway provides no precipitation probability

MET Norway Locationforecast compact does not include `precipitation_probability`. When combining
sources, the prob field always reflects Open-Meteo alone. This asymmetry is hidden from the user.
