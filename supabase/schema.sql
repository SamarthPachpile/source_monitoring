-- ====================================================================
-- REGULATORY CHANGE IMPACT AGENT: DATABASE SCHEMA FOR SUPABASE (POSTGRESQL)
-- ====================================================================
-- This script safely handles existing tables by:
--   1. Creating the tables if they don't exist.
--   2. Adding any missing columns (e.g., 'authority', 'jurisdiction') with ADD COLUMN IF NOT EXISTS.
--   3. Creating indexes for fast relational context retrieval.
--   4. Configuring Row Level Security (RLS).
-- ====================================================================

-- --------------------------------------------------------------------
-- OPTION A: If you want a clean fresh start (recommended for hackathons):
-- Uncomment the next 3 lines to drop old tables if needed:
-- --------------------------------------------------------------------
-- drop table if exists public.reg_paragraphs cascade;
-- drop table if exists public.reg_sections cascade;
-- drop table if exists public.reg_documents cascade;

-- 1. Regulatory Documents Metadata Table
create table if not exists public.reg_documents (
  id text primary key,
  title text not null
);

-- Ensure all columns exist even if the table was created earlier with fewer columns
alter table public.reg_documents add column if not exists title text;
alter table public.reg_documents add column if not exists authority text;
alter table public.reg_documents add column if not exists jurisdiction text;
alter table public.reg_documents add column if not exists region text;
alter table public.reg_documents add column if not exists source_url text;
alter table public.reg_documents add column if not exists document_url text;
alter table public.reg_documents add column if not exists publication_date timestamptz;
alter table public.reg_documents add column if not exists effective_date timestamptz;
alter table public.reg_documents add column if not exists reference_number text;
alter table public.reg_documents add column if not exists document_type text;
alter table public.reg_documents add column if not exists content_hash text;
alter table public.reg_documents add column if not exists raw_html text;
alter table public.reg_documents add column if not exists created_at timestamptz not null default now();
alter table public.reg_documents add column if not exists updated_at timestamptz not null default now();

-- Indexes for reg_documents
create index if not exists idx_reg_docs_authority on public.reg_documents(authority);
create index if not exists idx_reg_docs_jurisdiction on public.reg_documents(jurisdiction);
create index if not exists idx_reg_docs_ref_num on public.reg_documents(reference_number);
create index if not exists idx_reg_docs_pub_date on public.reg_documents(publication_date desc);

-- 2. Regulatory Sections Table (Chapters / Headings - cp1)
create table if not exists public.reg_sections (
  id text primary key,
  doc_id text not null references public.reg_documents(id) on delete cascade,
  heading text not null,
  ref_path text not null
);

-- Ensure all columns exist on reg_sections
alter table public.reg_sections add column if not exists section_number text;
alter table public.reg_sections add column if not exists heading text;
alter table public.reg_sections add column if not exists order_index integer not null default 0;
alter table public.reg_sections add column if not exists ref_path text;
alter table public.reg_sections add column if not exists created_at timestamptz not null default now();

-- Indexes for reg_sections
create index if not exists idx_reg_sections_doc_id on public.reg_sections(doc_id);
create index if not exists idx_reg_sections_ref_path on public.reg_sections(doc_id, ref_path);
create index if not exists idx_reg_sections_order on public.reg_sections(doc_id, order_index);

-- 3. Regulatory Paragraphs / Clauses Table (cp2 with ref_path)
create table if not exists public.reg_paragraphs (
  id text primary key,
  doc_id text not null references public.reg_documents(id) on delete cascade,
  ref_path text not null,
  text text not null
);

-- Ensure all columns exist on reg_paragraphs
alter table public.reg_paragraphs add column if not exists section_id text references public.reg_sections(id) on delete set null;
alter table public.reg_paragraphs add column if not exists ref_path text;
alter table public.reg_paragraphs add column if not exists text text;
alter table public.reg_paragraphs add column if not exists clause_number text;
alter table public.reg_paragraphs add column if not exists order_index integer not null default 0;
alter table public.reg_paragraphs add column if not exists created_at timestamptz not null default now();

-- Indexes for deterministic exact lookup and relational context retrieval
create index if not exists idx_reg_paragraphs_doc_id on public.reg_paragraphs(doc_id);
create index if not exists idx_reg_paragraphs_ref_path on public.reg_paragraphs(doc_id, ref_path);
create index if not exists idx_reg_paragraphs_order on public.reg_paragraphs(doc_id, order_index);
create index if not exists idx_reg_paragraphs_doc_ref on public.reg_paragraphs(doc_id, ref_path, order_index);

-- 4. Enable Row Level Security (RLS)
alter table public.reg_documents enable row level security;
alter table public.reg_sections enable row level security;
alter table public.reg_paragraphs enable row level security;

-- Drop existing policies if re-running
drop policy if exists "Allow read access to public on reg_documents" on public.reg_documents;
drop policy if exists "Allow read access to public on reg_sections" on public.reg_sections;
drop policy if exists "Allow read access to public on reg_paragraphs" on public.reg_paragraphs;
drop policy if exists "Allow full service_role access on reg_documents" on public.reg_documents;
drop policy if exists "Allow full service_role access on reg_sections" on public.reg_sections;
drop policy if exists "Allow full service_role access on reg_paragraphs" on public.reg_paragraphs;

-- Public / Authenticated read policies
create policy "Allow read access to public on reg_documents"
  on public.reg_documents for select to anon, authenticated using (true);

create policy "Allow read access to public on reg_sections"
  on public.reg_sections for select to anon, authenticated using (true);

create policy "Allow read access to public on reg_paragraphs"
  on public.reg_paragraphs for select to anon, authenticated using (true);

-- Service Role full access policies
create policy "Allow full service_role access on reg_documents"
  on public.reg_documents for all to service_role using (true) with check (true);

create policy "Allow full service_role access on reg_sections"
  on public.reg_sections for all to service_role using (true) with check (true);

create policy "Allow full service_role access on reg_paragraphs"
  on public.reg_paragraphs for all to service_role using (true) with check (true);
