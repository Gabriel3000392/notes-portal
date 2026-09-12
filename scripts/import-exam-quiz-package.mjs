#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'

const filePath = process.argv[2]

if (!filePath) {
  console.error('Usage: node scripts/import-exam-quiz-package.mjs package.json')
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

const status = process.env.IMPORT_ASSET_STATUS ?? 'draft'
if (!['draft', 'published', 'archived'].includes(status)) {
  console.error('IMPORT_ASSET_STATUS must be draft, published, or archived')
  process.exit(1)
}

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

const contentHtml = [
  `<h2>${escapeHtml(pkg.exam.title)}</h2>`,
  '<p>Imported exam-practice quiz package. Source papers remain private.</p>',
  pkg.audit?.warnings?.length
    ? `<h3>Import warnings</h3><ul>${pkg.audit.warnings
        .map((warning) => `<li>${escapeHtml(warning)}</li>`)
        .join('')}</ul>`
    : '',
].join('')

const { data: lecture, error: lectureError } = await supabase
  .from('lectures')
  .upsert(
    {
      course_id: course.id,
      slug: pkg.exam.slug,
      lecture_date: null,
      title: pkg.exam.title,
      subtitle: `${pkg.course.code} exam practice`,
      content_html: contentHtml,
      active: true,
    },
    { onConflict: 'course_id,slug' },
  )
  .select()
  .single()

if (lectureError) throw lectureError

const { data: existingQuizzes, error: existingQuizError } = await supabase
  .from('quizzes')
  .select('id')
  .eq('lecture_id', lecture.id)

if (existingQuizError) throw existingQuizError

if (existingQuizzes.length) {
  const { error } = await supabase
    .from('quizzes')
    .delete()
    .in(
      'id',
      existingQuizzes.map((quiz) => quiz.id),
    )
  if (error) throw error
}

await supabase.from('ai_generation_jobs').insert({
  course_id: course.id,
  lecture_id: lecture.id,
  type: 'exam_quiz_package_import',
  status: 'succeeded',
  prompt_version: pkg.promptVersion ?? 'exam-quiz-package-v1',
  source_echo360_id: null,
})

const { data: insertedQuiz, error: quizError } = await supabase
  .from('quizzes')
  .insert({
    course_id: course.id,
    lecture_id: lecture.id,
    title: pkg.quiz.title,
    status,
    created_by_ai: true,
  })
  .select()
  .single()

if (quizError) throw quizError

const questions = pkg.quiz.questions.map((question) => ({
  quiz_id: insertedQuiz.id,
  type: 'multiple_choice',
  original_type: question.originalType ?? 'multiple_choice',
  prompt: question.prompt,
  options: question.options ?? [],
  correct_answer: question.correctAnswer,
  explanation: question.explanation,
  marks: question.marks ?? null,
  topics: question.topics ?? [],
  assets: question.assets ?? [],
  source_ref: question.sourceRef ?? null,
  answer_source: question.answerSource ?? '',
  converted_to_multiple_choice: question.convertedToMultipleChoice ?? false,
  confidence: question.confidence ?? 'needs_review',
  status,
  created_by_ai: true,
}))

if (questions.length) {
  const { error: questionError } = await supabase
    .from('quiz_questions')
    .insert(questions)
  if (questionError) throw questionError
}

console.log(
  `Imported ${pkg.course.code} ${pkg.exam.slug}: ${questions.length} exam questions as ${status}.`,
)

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

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}
