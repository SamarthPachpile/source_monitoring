-- ====================================================================
-- REGULATORY CHANGE IMPACT AGENT: DATABASE SCHEMA FOR SUPABASE (POSTGRESQL)
-- ====================================================================
-- Tables:
--   1. public.reg_documents  - Top-level regulatory document metadata
--   2. public.reg_sections   - Chapters / Major Headings (cp1)
--   3. public.reg_paragraphs - Individual clause text blocks (cp2) with ref_path
--
-- Notes:
--   - pgvector is deliberately omitted: change management requires deterministic
--     exact text-to-text matching (Mode A alignment / Mode B patch replacement).
--   - RLS is enabled with public read access and full service-role management.
-- ====================================================================

-- 1. Regulatory Documents Metadata Table
create table if not exists public.reg_documents (
  id text primary key,
  title text not null,
  authority text not null,
  jurisdiction text not null,
  region text,
  source_url text,
  document_url text,
  publication_date timestamptz,
  effective_date timestamptz,
  reference_number text,
  document_type text,
  content_hash text,
  raw_html text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes for reg_documents
create index if not exists idx_reg_docs_authority on public.reg_documents(authority);
create index if not exists idx_reg_docs_jurisdiction on public.reg_documents(jurisdiction);
create index if not exists idx_reg_docs_ref_num on public.reg_documents(reference_number);
create index if not exists idx_reg_docs_pub_date on public.reg_documents(publication_date desc);

-- 2. Regulatory Sections Table (Chapters / Headings - cp1)
create table if not exists public.reg_sections (
  id text primary key,
  doc_id text not null references public.reg_documents(id) on delete cascade,
  section_number text,
  heading text not null,
  order_index integer not null default 0,
  ref_path text not null,
  created_at timestamptz not null default now()
);

-- Indexes for reg_sections
create index if not exists idx_reg_sections_doc_id on public.reg_sections(doc_id);
create index if not exists idx_reg_sections_ref_path on public.reg_sections(doc_id, ref_path);
create index if not exists idx_reg_sections_order on public.reg_sections(doc_id, order_index);

-- 3. Regulatory Paragraphs / Clauses Table (cp2 with ref_path)
create table if not exists public.reg_paragraphs (
  id text primary key,
  doc_id text not null references public.reg_documents(id) on delete cascade,
  section_id text references public.reg_sections(id) on delete set null,
  ref_path text not null,
  text text not null,
  clause_number text,
  order_index integer not null default 0,
  created_at timestamptz not null default now()
);

-- Indexes for deterministic exact lookup, diff alignment, and Ollama context retrieval
create index if not exists idx_reg_paragraphs_doc_id on public.reg_paragraphs(doc_id);
create index if not exists idx_reg_paragraphs_ref_path on public.reg_paragraphs(doc_id, ref_path);
create index if not exists idx_reg_paragraphs_order on public.reg_paragraphs(doc_id, order_index);
create index if not exists idx_reg_paragraphs_doc_ref on public.reg_paragraphs(doc_id, ref_path, order_index);

-- 4. Enable Row Level Security (RLS) on all exposed tables
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

-- Service Role full access policies (for backend ingestion)
create policy "Allow full service_role access on reg_documents"
  on public.reg_documents for all to service_role using (true) with check (true);

create policy "Allow full service_role access on reg_sections"
  on public.reg_sections for all to service_role using (true) with check (true);

create policy "Allow full service_role access on reg_paragraphs"
  on public.reg_paragraphs for all to service_role using (true) with check (true);
