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
