# Universe Membership Automation

## Goal
Automate `stocks.universe_level` and `stocks.is_active` updates so core/extended membership changes are explicit and traceable.

## Rule Set (default)
- `core`: market-cap rank <= 200 and close >= 1000
- `extended`: market-cap rank <= 500 and close >= 1000
- `tail`: all other listed stocks
- listed stocks are set to `is_active=true`

## New Script
- `scripts/refresh_universe_membership.py`

### Dry run
```bash
python scripts/refresh_universe_membership.py --dry-run
```

### Apply
```bash
python scripts/refresh_universe_membership.py
```

### With explicit date
```bash
python scripts/refresh_universe_membership.py --date 20260602
```

### Optional delisting-like handling
Mark currently active DB codes as inactive if not in today's listed set:
```bash
python scripts/refresh_universe_membership.py --mark-missing-inactive
```

## Daily Batch Integration
`daily_batch.py` can run universe refresh before step 0.

Environment variables:
- `BATCH_AUTO_REFRESH_UNIVERSE=true|false` (default: false)
- `BATCH_REQUIRE_UNIVERSE_REFRESH=true|false` (default: false)

When enabled:
- Stage name: `UniverseRefresh`
- If `BATCH_REQUIRE_UNIVERSE_REFRESH=true`, batch fails when refresh fails.

## Tuning Variables
- `UNIVERSE_CORE_TOP_N` (default: 200)
- `UNIVERSE_EXTENDED_TOP_N` (default: 500)
- `UNIVERSE_MIN_PRICE` (default: 1000)
- `UNIVERSE_MARK_MISSING_INACTIVE` (default: false)

## Artifacts
- `logs/universe_membership_status.json` (latest run)
- `logs/universe_membership_history.ndjson` (append-only history)

## Notes
- This is rank-based membership automation, not index committee logic.
- If you need S&P500-like governance, add additional constraints (profitability, liquidity floor, tenure, sector balancing) and a review step.
