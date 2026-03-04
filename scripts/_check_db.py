"""Quick DB status check"""
import os, sys
os.chdir(os.path.join(os.path.dirname(__file__), ".."))

with open(".env") as f:
    for line in f:
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" in line:
            k, v = line.split("=", 1)
            os.environ[k.strip()] = v.strip().strip('"').strip("'")

from supabase import create_client
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

# Stocks count
r = sb.table("stocks").select("code", count="exact").execute()
print(f"Total stocks: {r.count}")

for lvl in ["core", "extended", "tail"]:
    r2 = sb.table("stocks").select("code", count="exact").eq("universe_level", lvl).execute()
    print(f"  {lvl}: {r2.count}")

# Latest dates
r3 = sb.table("stock_daily").select("date").order("date", desc=True).limit(1).execute()
print(f"Latest stock_daily: {r3.data[0]['date'] if r3.data else 'none'}")

r4 = sb.table("daily_indicators").select("trade_date").order("trade_date", desc=True).limit(1).execute()
print(f"Latest indicators: {r4.data[0]['trade_date'] if r4.data else 'none'}")

r5 = sb.table("scores").select("asof").order("asof", desc=True).limit(1).execute()
print(f"Latest scores: {r5.data[0]['asof'] if r5.data else 'none'}")

r6 = sb.table("sectors").select("id, name", count="exact").execute()
print(f"Total sectors: {r6.count}")
if r6.data:
    for s in r6.data[:5]:
        print(f"  {s['id']}: {s['name']}")
    if len(r6.data) > 5:
        print(f"  ... and {len(r6.data)-5} more")
