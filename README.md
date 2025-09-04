# catalogo-libri

## Supabase integration

This app can store scans in Supabase. To enable it:

1) Create a new Supabase project at `https://supabase.com`.

2) Create a table named `books` with these columns:

```
id: bigint or uuid (primary key)
timestamp: timestamp with time zone, not null
box: text, not null
isbn: text, not null
title: text
author: text
year: int2 or int4
genre: text
cover: text
marketPrice: numeric
priceSource: text
plot: text
```

SQL example:

```sql
create table public.books (
  id bigserial primary key,
  "timestamp" timestamptz not null default now(),
  box text not null,
  isbn text not null,
  title text,
  author text,
  year int,
  genre text,
  cover text,
  "marketPrice" numeric,
  "priceSource" text,
  plot text
);

alter table public.books enable row level security;
create policy "Allow inserts from anon" on public.books
  for insert to anon with check (true);
create policy "Allow read from anon" on public.books
  for select to anon using (true);
```

3) In your project settings, copy the Project URL and the `anon` public API key.

4) Create a local env file `.env.local` in the project root with:

```
VITE_SUPABASE_URL=YOUR_SUPABASE_URL
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
# Optional: keep dual-write to Google Apps Script endpoint
# VITE_LEGACY_SHEET_ENDPOINT=YOUR_APPS_SCRIPT_WEBHOOK_URL
```

5) Start the dev server:

```
npm run dev
```

When you scan an ISBN, the app fetches metadata (OpenLibrary/Google Books) and inserts a row into the `books` table with full details.

### Files touched
- `src/supabaseClient.js`: initializes the Supabase client from Vite env vars.
- `src/bookApi.js`: fetches and normalizes metadata from OpenLibrary/Google Books.
- `src/App.jsx`: scanner flow, Home, Books, Boxes, Book Detail; writes to `books`.