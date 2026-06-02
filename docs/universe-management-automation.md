# Universe Membership Automation

## Goal
Automate `stocks.universe_level` and `stocks.is_active` updates so core/extended membership changes are explicit and traceable.

## Rule Set (default)
- `core`: market-cap rank <= 200 and close >= 1000
- `extended`: market-cap rank <= 500 and close >= 1000
- `tail`: all other listed stocks
- listed stocks are set to `is_active=true`

Phase 2 policy (S&P-like hard filters):
- minimum market cap: `UNIVERSE_MIN_MARKET_CAP` (default: 300,000,000,000)
- minimum liquidity: `UNIVERSE_MIN_LIQUIDITY` (default: 5,000,000,000)
- allowed markets: `UNIVERSE_ALLOWED_MARKETS` (default: `KOSPI,KOSDAQ`)
- excluded name patterns: SPAC/REIT/ETF/ETN/우선주/레버리지/인버스 등은 자동 `tail`

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

Missing grace (Phase 2):
- missing codes are not inactivated immediately.
- `UNIVERSE_MISSING_GRACE_RUNS` (default: 3) consecutive missing runs after guard pass.
- guard: `UNIVERSE_MIN_LISTED_COUNT_GUARD` (default: 1000) below this count, inactivation is blocked.

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
- `UNIVERSE_MIN_MARKET_CAP` (default: 300000000000)
- `UNIVERSE_MIN_LIQUIDITY` (default: 5000000000)
- `UNIVERSE_ALLOWED_MARKETS` (default: KOSPI,KOSDAQ)
- `UNIVERSE_MARK_MISSING_INACTIVE` (default: false)
- `UNIVERSE_MISSING_GRACE_RUNS` (default: 3)
- `UNIVERSE_MIN_LISTED_COUNT_GUARD` (default: 1000)
- `UNIVERSE_ALERT_ALWAYS` (default: false)

## Artifacts
- `logs/universe_membership_status.json` (latest run)
- `logs/universe_membership_history.ndjson` (append-only history)
- `logs/universe_missing_tracker.json` (missing-run grace tracker)

## Alerts
- Telegram summary alert is sent when membership changes occur (or always when `UNIVERSE_ALERT_ALWAYS=true`).
- env priority for chat id:
	- `UNIVERSE_ALERT_CHAT_ID`
	- `AUTO_TRADE_ALERT_CHAT_ID`
	- `TELEGRAM_ADMIN_CHAT_ID`
- required token: `TELEGRAM_BOT_TOKEN`

## Notes
- This is rank-based membership automation, not index committee logic.
- If you need S&P500-like governance, add additional constraints (profitability, liquidity floor, tenure, sector balancing) and a review step.
