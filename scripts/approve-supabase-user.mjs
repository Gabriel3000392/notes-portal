#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js'

const [emailArg, roleArg = 'admin'] = process.argv.slice(2)
const email = emailArg?.trim().toLowerCase()
const role = roleArg === 'student' ? 'student' : 'admin'
const supabaseUrl = process.env.SUPABASE_URL
const secretKey =
  process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY

if (!email) {
  console.error('Usage: node scripts/approve-supabase-user.mjs user@example.com [admin|student]')
  process.exit(1)
}

if (!supabaseUrl || !secretKey) {
  console.error('Missing SUPABASE_URL and SUPABASE_SECRET_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, secretKey, {
  auth: { persistSession: false },
})

const user = await findAuthUserByEmail(email)
if (!user) {
  throw new Error(`No Supabase auth user found for ${email}`)
}

const name =
  user.user_metadata?.name ??
  user.user_metadata?.full_name ??
  email.split('@')[0]

const { error: profileError } = await supabase.from('profiles').upsert(
  {
    id: user.id,
    email,
    name,
    role,
    status: 'approved',
  },
  { onConflict: 'id' },
)

if (profileError) throw profileError

const { data: courses, error: coursesError } = await supabase
  .from('courses')
  .select('id, code')
  .in('code', ['CHEM114', 'EMTH117', 'ENGR101'])

if (coursesError) throw coursesError

if (courses?.length) {
  const { error: enrolmentError } = await supabase.from('enrolments').upsert(
    courses.map((course) => ({
      user_id: user.id,
      course_id: course.id,
    })),
    { onConflict: 'user_id,course_id' },
  )

  if (enrolmentError) throw enrolmentError
}

console.log(`Approved ${email} as ${role}`)
console.log(`Enrolled in ${courses?.map((course) => course.code).join(', ')}`)

async function findAuthUserByEmail(targetEmail) {
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 100,
    })

    if (error) throw error

    const match = data.users.find(
      (item) => item.email?.toLowerCase() === targetEmail,
    )
    if (match) return match
    if (data.users.length < 100) return null
  }
}
