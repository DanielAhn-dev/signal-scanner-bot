-- Migration: create fundamentals table
-- Run this in Supabase SQL Editor or via your migration tool

CREATE TABLE IF NOT EXISTS public.fundamentals (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code text NOT NULL,
  as_of timestamptz NOT NULL,
  period_type text,
  period_end date,
  sales numeric,
  operating_income numeric,
  net_income numeric,
  cashflow_oper numeric,
  cashflow_free numeric,
  per numeric,
  pbr numeric,
  roe numeric,
  debt_ratio numeric,
  computed jsonb,
  raw_rows jsonb,
  source text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.fundamentals
  ADD CONSTRAINT IF NOT EXISTS fundamentals_code_asof_unique UNIQUE (code, as_of);

CREATE INDEX IF NOT EXISTS idx_fundamentals_code ON public.fundamentals(code);
