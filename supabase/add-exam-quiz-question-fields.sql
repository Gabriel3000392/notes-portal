alter table public.quiz_questions
  add column if not exists original_type text,
  add column if not exists marks numeric,
  add column if not exists topics jsonb not null default '[]'::jsonb,
  add column if not exists assets jsonb not null default '[]'::jsonb,
  add column if not exists source_ref jsonb,
  add column if not exists answer_source text not null default '',
  add column if not exists converted_to_multiple_choice boolean not null default false,
  add column if not exists confidence text not null default 'verified';
