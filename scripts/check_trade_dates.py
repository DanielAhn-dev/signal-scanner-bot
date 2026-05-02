import os
from collections import Counter
from pprint import pprint

from supabase import create_client

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_ANON_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY/SUPABASE_ANON_KEY in env")
    raise SystemExit(1)

client = create_client(SUPABASE_URL, SUPABASE_KEY)

# select all fields; specific columns may differ across schemas
resp = client.table('pullback_signals').select('*').order('created_at', desc=True).limit(1000).execute()
rows = resp.data or []

dates = [r.get('trade_date') for r in rows if r.get('trade_date')]
cnt = Counter(dates)

print('Fetched', len(rows), 'rows (most recent 1000).')
print('\nTop trade_date counts:')
pprint(cnt.most_common(10))

problem_date = None
for d, c in cnt.most_common():
    if d and d.startswith('2026-05') and d.endswith('02'):
        problem_date = d
        break

if problem_date:
    print(f"\nFound records with trade_date={problem_date}. Showing sample rows:")
    samples = [r for r in rows if r.get('trade_date') == problem_date][:20]
    pprint(samples)
else:
    print('\nNo 2026-05-02 trade_date found in the latest 1000 rows.')

print('\nChecking `stocks` table latest updated_at samples...')
resp2 = client.table('stocks').select('code,updated_at').order('updated_at', desc=True).limit(50).execute()
rows2 = resp2.data or []
print('Fetched', len(rows2), 'stocks (most recently updated).')
dates2 = [r.get('updated_at') for r in rows2 if r.get('updated_at')]
cnt2 = Counter([d.split('T')[0] if 'T' in d else d for d in dates2])
print('\nTop stocks.updated_at dates:')
pprint(cnt2.most_common(10))
print('\nSample rows:')
pprint(rows2[:20])
