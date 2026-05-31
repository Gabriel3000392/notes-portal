drop policy if exists "Users can create their own pending profile"
on public.profiles;

create policy "Users can create their own pending profile"
on public.profiles for insert
with check (
  id = auth.uid()
  and role = 'student'
  and status = 'pending'
);
