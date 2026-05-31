create type public.portal_role as enum ('admin', 'student');
create type public.user_status as enum ('approved', 'pending', 'disabled');
create type public.asset_status as enum ('draft', 'published', 'archived');
create type public.quiz_question_type as enum ('multiple_choice', 'short_answer');
create type public.ai_generation_status as enum ('queued', 'running', 'succeeded', 'failed');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text not null,
  role public.portal_role not null default 'student',
  status public.user_status not null default 'pending',
  created_at timestamptz not null default now()
);

create table public.courses (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  title text not null,
  term text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.lectures (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  slug text not null,
  lecture_date date,
  title text not null,
  subtitle text not null default '',
  content_html text not null,
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (course_id, slug)
);

create table public.enrolments (
  user_id uuid not null references public.profiles(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, course_id)
);

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  email text,
  role public.portal_role not null default 'student',
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.ai_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  course_id uuid references public.courses(id) on delete cascade,
  lecture_id uuid references public.lectures(id) on delete cascade,
  type text not null,
  status public.ai_generation_status not null default 'queued',
  prompt_version text not null,
  error text,
  source_echo360_id text,
  created_at timestamptz not null default now()
);

create table public.flashcards (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  lecture_id uuid not null references public.lectures(id) on delete cascade,
  front text not null,
  back text not null,
  status public.asset_status not null default 'draft',
  difficulty_seed text not null default 'core',
  created_by_ai boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.quizzes (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  lecture_id uuid not null references public.lectures(id) on delete cascade,
  title text not null,
  status public.asset_status not null default 'draft',
  created_by_ai boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.quiz_questions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  type public.quiz_question_type not null,
  prompt text not null,
  options jsonb not null default '[]'::jsonb,
  correct_answer text not null,
  explanation text not null,
  status public.asset_status not null default 'draft',
  created_by_ai boolean not null default true
);

create table public.lecture_tags (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  lecture_id uuid not null references public.lectures(id) on delete cascade,
  tag text not null,
  status public.asset_status not null default 'draft',
  created_by_ai boolean not null default true,
  unique (lecture_id, tag)
);

create table public.study_guides (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  lecture_id uuid not null references public.lectures(id) on delete cascade,
  title text not null,
  content text not null,
  status public.asset_status not null default 'draft',
  created_by_ai boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.courses enable row level security;
alter table public.lectures enable row level security;
alter table public.enrolments enable row level security;
alter table public.invites enable row level security;
alter table public.ai_generation_jobs enable row level security;
alter table public.flashcards enable row level security;
alter table public.quizzes enable row level security;
alter table public.quiz_questions enable row level security;
alter table public.lecture_tags enable row level security;
alter table public.study_guides enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
      and status = 'approved'
  );
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, name, role, status)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(
      new.raw_user_meta_data ->> 'name',
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Pending user'
    ),
    'student',
    'pending'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

insert into public.profiles (id, email, name, role, status)
select
  users.id,
  coalesce(users.email, ''),
  coalesce(
    users.raw_user_meta_data ->> 'name',
    nullif(split_part(coalesce(users.email, ''), '@', 1), ''),
    'Pending user'
  ),
  'student',
  'pending'
from auth.users
left join public.profiles on profiles.id = users.id
where profiles.id is null
on conflict (id) do nothing;

create policy "Users can read their own profile"
on public.profiles for select
using (id = auth.uid() or public.is_admin());

create policy "Admins can manage profiles"
on public.profiles for all
using (public.is_admin())
with check (public.is_admin());

create policy "Users can create their own pending profile"
on public.profiles for insert
with check (
  id = auth.uid()
  and role = 'student'
  and status = 'pending'
);

create policy "Approved users can read active courses they are enrolled in"
on public.courses for select
using (
  public.is_admin()
  or (
    active
    and exists (
      select 1
      from public.profiles p
      join public.enrolments e on e.user_id = p.id
      where p.id = auth.uid()
        and p.status = 'approved'
        and e.course_id = courses.id
    )
  )
);

create policy "Admins can manage courses"
on public.courses for all
using (public.is_admin())
with check (public.is_admin());

create policy "Approved users can read enrolled active lectures"
on public.lectures for select
using (
  public.is_admin()
  or (
    active
    and exists (
      select 1
      from public.profiles p
      join public.enrolments e on e.user_id = p.id
      join public.courses c on c.id = e.course_id
      where p.id = auth.uid()
        and p.status = 'approved'
        and c.active
        and e.course_id = lectures.course_id
    )
  )
);

create policy "Admins can manage lectures"
on public.lectures for all
using (public.is_admin())
with check (public.is_admin());

create policy "Users can read their own enrolments"
on public.enrolments for select
using (user_id = auth.uid() or public.is_admin());

create policy "Admins can manage enrolments"
on public.enrolments for all
using (public.is_admin())
with check (public.is_admin());

create policy "Admins can manage invites"
on public.invites for all
using (public.is_admin())
with check (public.is_admin());

create policy "Admins can manage ai generation jobs"
on public.ai_generation_jobs for all
using (public.is_admin())
with check (public.is_admin());

create policy "Users can read published flashcards for enrolled courses"
on public.flashcards for select
using (
  public.is_admin()
  or (
    status = 'published'
    and exists (
      select 1
      from public.profiles p
      join public.enrolments e on e.user_id = p.id
      where p.id = auth.uid()
        and p.status = 'approved'
        and e.course_id = flashcards.course_id
    )
  )
);

create policy "Admins can manage flashcards"
on public.flashcards for all
using (public.is_admin())
with check (public.is_admin());

create policy "Users can read published quizzes for enrolled courses"
on public.quizzes for select
using (
  public.is_admin()
  or (
    status = 'published'
    and exists (
      select 1
      from public.profiles p
      join public.enrolments e on e.user_id = p.id
      where p.id = auth.uid()
        and p.status = 'approved'
        and e.course_id = quizzes.course_id
    )
  )
);

create policy "Admins can manage quizzes"
on public.quizzes for all
using (public.is_admin())
with check (public.is_admin());

create policy "Users can read published quiz questions"
on public.quiz_questions for select
using (
  public.is_admin()
  or (
    status = 'published'
    and exists (
      select 1
      from public.quizzes q
      join public.profiles p on p.id = auth.uid()
      join public.enrolments e on e.user_id = p.id and e.course_id = q.course_id
      where q.id = quiz_questions.quiz_id
        and q.status = 'published'
        and p.status = 'approved'
    )
  )
);

create policy "Admins can manage quiz questions"
on public.quiz_questions for all
using (public.is_admin())
with check (public.is_admin());

create policy "Users can read published lecture tags"
on public.lecture_tags for select
using (
  public.is_admin()
  or (
    status = 'published'
    and exists (
      select 1
      from public.profiles p
      join public.enrolments e on e.user_id = p.id
      where p.id = auth.uid()
        and p.status = 'approved'
        and e.course_id = lecture_tags.course_id
    )
  )
);

create policy "Admins can manage lecture tags"
on public.lecture_tags for all
using (public.is_admin())
with check (public.is_admin());

create policy "Users can read published study guides"
on public.study_guides for select
using (
  public.is_admin()
  or (
    status = 'published'
    and exists (
      select 1
      from public.profiles p
      join public.enrolments e on e.user_id = p.id
      where p.id = auth.uid()
        and p.status = 'approved'
        and e.course_id = study_guides.course_id
    )
  )
);

create policy "Admins can manage study guides"
on public.study_guides for all
using (public.is_admin())
with check (public.is_admin());
