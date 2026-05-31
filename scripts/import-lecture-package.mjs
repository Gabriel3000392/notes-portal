#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'

const filePath = process.argv[2]

if (!filePath) {
  console.error('Usage: node scripts/import-lecture-package.mjs package.json')
  process.exit(1)
}

const supabaseUrl = process.env.SUPABASE_URL
const secretKey =
  process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !secretKey) {
  console.error('Missing SUPABASE_URL and SUPABASE_SECRET_KEY')
  process.exit(1)
}

const pkg = sanitizeForPostgres(JSON.parse(await readFile(filePath, 'utf8')))
const supabase = createClient(supabaseUrl, secretKey, {
  auth: { persistSession: false },
})

const status = process.env.IMPORT_ASSET_STATUS ?? 'published'
if (!['draft', 'published', 'archived'].includes(status)) {
  console.error('IMPORT_ASSET_STATUS must be draft, published, or archived')
  process.exit(1)
}
const lectureSlug = withSourceSuffix(pkg.lecture.slug, pkg.source?.id)

const { data: course, error: courseError } = await supabase
  .from('courses')
  .upsert(
    {
      code: pkg.course.code,
      title: pkg.course.title,
      term: pkg.course.term,
      active: true,
    },
    { onConflict: 'code' },
  )
  .select()
  .single()

if (courseError) throw courseError

const { data: lecture, error: lectureError } = await supabase
  .from('lectures')
  .upsert(
    {
      course_id: course.id,
      slug: lectureSlug,
      lecture_date: pkg.lecture.date || null,
      title: pkg.lecture.title,
      subtitle: pkg.lecture.subtitle ?? '',
      content_html: pkg.notes.contentHtml,
      active: true,
    },
    { onConflict: 'course_id,slug' },
  )
  .select()
  .single()

if (lectureError) throw lectureError

for (const table of [
  'flashcards',
  'quizzes',
  'lecture_tags',
  'study_guides',
  'ai_generation_jobs',
]) {
  const { error } = await supabase
    .from(table)
    .delete()
    .eq('lecture_id', lecture.id)
  if (error) throw error
}

await supabase.from('ai_generation_jobs').insert({
  course_id: course.id,
  lecture_id: lecture.id,
  type: 'study_package_import',
  status: 'succeeded',
  prompt_version: pkg.promptVersion ?? 'external-package-v1',
  source_echo360_id: pkg.source?.id ?? null,
})

const flashcards = (pkg.studyAssets.flashcards ?? []).map((card) => ({
  course_id: course.id,
  lecture_id: lecture.id,
  front: card.front,
  back: card.back,
  status,
  difficulty_seed: card.difficultySeed ?? 'core',
  created_by_ai: true,
}))

if (flashcards.length) {
  const { error } = await supabase.from('flashcards').insert(flashcards)
  if (error) throw error
}

for (const quiz of pkg.studyAssets.quizzes ?? []) {
  const { data: insertedQuiz, error } = await supabase
    .from('quizzes')
    .insert({
      course_id: course.id,
      lecture_id: lecture.id,
      title: quiz.title,
      status,
      created_by_ai: true,
    })
    .select()
    .single()
  if (error) throw error

  const questions = quiz.questions.map((question) => ({
    quiz_id: insertedQuiz.id,
    type: question.type,
    prompt: question.prompt,
    options: question.options ?? [],
    correct_answer: question.correctAnswer,
    explanation: question.explanation,
    status,
    created_by_ai: true,
  }))
  if (questions.length) {
    const { error: questionError } = await supabase
      .from('quiz_questions')
      .insert(questions)
    if (questionError) throw questionError
  }
}

const tags = (pkg.studyAssets.tags ?? []).map((tag) => ({
  course_id: course.id,
  lecture_id: lecture.id,
  tag,
  status,
  created_by_ai: true,
}))

if (tags.length) {
  const { error } = await supabase.from('lecture_tags').upsert(tags, {
    onConflict: 'lecture_id,tag',
  })
  if (error) throw error
}

const guides = (pkg.studyAssets.studyGuides ?? []).map((guide) => ({
  course_id: course.id,
  lecture_id: lecture.id,
  title: guide.title,
  content: guide.content,
  status,
  created_by_ai: true,
}))

if (guides.length) {
  const { error } = await supabase.from('study_guides').insert(guides)
  if (error) throw error
}

console.log(
  `Imported ${pkg.course.code} ${lectureSlug}: ${flashcards.length} cards, ${(pkg.studyAssets.quizzes ?? []).length} quizzes, ${tags.length} tags, ${guides.length} guides.`,
)

function withSourceSuffix(slug, sourceId) {
  if (!sourceId) return slug
  const suffix = sourceId.slice(0, 8).toLowerCase()
  return slug.endsWith(`--${suffix}`) ? slug : `${slug}--${suffix}`
}

function sanitizeForPostgres(value) {
  if (typeof value === 'string') return value.replaceAll('\u0000', '')
  if (Array.isArray(value)) return value.map(sanitizeForPostgres)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        sanitizeForPostgres(nestedValue),
      ]),
    )
  }
  return value
}
