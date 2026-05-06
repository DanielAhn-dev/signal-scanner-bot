#!/usr/bin/env python3
import os
from supabase import create_client

url = os.getenv('SUPABASE_URL')
key = os.getenv('SUPABASE_SERVICE_ROLE_KEY')

if not url or not key:
    print('❌ SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set')
    exit(1)

sb = create_client(url, key)

# 1. Check stocks table schema - check if per, pbr, eps, bps columns exist
print('=== STOCKS 테이블 샘플 데이터 (처음 1개) ===')
try:
    stocks_res = sb.table('stocks').select('code, name, per, pbr, eps, bps').limit(1).execute()
    if stocks_res.data:
        row = stocks_res.data[0]
        print(f'code: {row.get("code")}')
        print(f'name: {row.get("name")}')
        print(f'per: {row.get("per")}')
        print(f'pbr: {row.get("pbr")}')
        print(f'eps: {row.get("eps")}')
        print(f'bps: {row.get("bps")}')
    else:
        print('stocks 테이블이 비어있음')
except Exception as e:
    print(f'❌ 에러: {e}')

# 2. Check fundamentals table - check if roe, debt_ratio exist
print('\n=== FUNDAMENTALS 테이블 샘플 데이터 (처음 1개) ===')
try:
    fund_res = sb.table('fundamentals').select('code, as_of, roe, debt_ratio, per, pbr').limit(1).execute()
    if fund_res.data:
        row = fund_res.data[0]
        print(f'code: {row.get("code")}')
        print(f'as_of: {row.get("as_of")}')
        print(f'roe: {row.get("roe")}')
        print(f'debt_ratio: {row.get("debt_ratio")}')
        print(f'per: {row.get("per")}')
        print(f'pbr: {row.get("pbr")}')
    else:
        print('fundamentals 테이블이 비어있음')
except Exception as e:
    print(f'❌ 에러: {e}')

# 3. Count data in each table
print('\n=== 데이터 개수 ===')
try:
    stocks_count = sb.table('stocks').select('code', count='exact').execute()
    print(f'stocks: {stocks_count.count} rows')
except Exception as e:
    print(f'stocks 조회 실패: {e}')

try:
    fund_count = sb.table('fundamentals').select('code', count='exact').execute()
    print(f'fundamentals: {fund_count.count} rows')
except Exception as e:
    print(f'fundamentals 조회 실패: {e}')

# 4. Check a specific stock (if exists)
print('\n=== 특정 종목 상세 조회 ===')
try:
    stock_detail = sb.table('stocks').select('*').limit(1).execute()
    if stock_detail.data:
        row = stock_detail.data[0]
        print(f'code: {row.get("code")}')
        # Show all available columns
        cols = [k for k in row.keys() if row.get(k) is not None]
        print(f'Columns with data: {", ".join(cols)}')
except Exception as e:
    print(f'❌ 에러: {e}')
