-- Syllabus RAG store. Rest of the plan.md schema lands in later migrations.
-- Embeddings are real[] (no pgvector on postgresql@16 via brew); similarity is computed in web/lib/rag.ts.
create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  storage_path text not null unique,           -- re-ingesting the same path replaces it
  created_at timestamptz default now()
);

create table if not exists chunks (
  id bigint generated always as identity primary key,
  document_id uuid not null references documents on delete cascade,
  idx int not null,
  page int not null,                           -- first source page (1-based)
  page_end int not null,                       -- last source page; chunks can span a page break
  content text not null,
  embedding real[] not null check (cardinality(embedding) = 768), -- gemini-embedding-001 @ 768 dims
  unique (document_id, idx)
);
