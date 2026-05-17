# Known Issues / To Revisit

## ~~1. Scoring: precipitation probability is decoupled from amount~~ RESOLVED

**Fix applied:** `scoreHour` now uses *expected precipitation*:
`effectivePrecip = precip × (precipProb / 100)` when `precipProb > 0`.
When no probability is available (MET Norway only), raw precip amount is used directly.
The separate `scorePrecipProb` function has been removed.

Result: 0.1mm at 100% → 0.1mm expected → amber. 5mm at 100% → 5mm expected → red.

## ~~2. Score colour with no visible explanation~~ RESOLVED

**Fix applied:** Row colour now reflects expected precipitation (see #1 fix).
Precipitation probability is visible in the Model Comparison panel with a note explaining
that probability comes from Open-Meteo only.

## 3. MET Norway provides no precipitation probability

MET Norway Locationforecast compact does not include `precipitation_probability`. When combining
sources, the prob field always reflects Open-Meteo alone. This asymmetry is hidden from the user.
