#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL
const secretKey =
  process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY
const courseCodes = process.argv.slice(2)
const targetCourseCodes = courseCodes.length
  ? courseCodes.map((code) => code.toUpperCase())
  : ['CHEM114', 'EMTH117', 'ENGR101']

if (!supabaseUrl || !secretKey) {
  console.error('Missing SUPABASE_URL and SUPABASE_SECRET_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, secretKey, {
  auth: { persistSession: false },
})

const { data: courses, error: coursesError } = await supabase
  .from('courses')
  .select('id, code')
  .in('code', targetCourseCodes)

if (coursesError) throw coursesError

const missingCourses = targetCourseCodes.filter(
  (code) => !courses.some((course) => course.code === code),
)

if (missingCourses.length) {
  throw new Error(`Missing courses: ${missingCourses.join(', ')}`)
}

const courseIds = courses.map((course) => course.id)

const { data: quizzes, error: quizzesError } = await supabase
  .from('quizzes')
  .select('id')
  .in('course_id', courseIds)

if (quizzesError) throw quizzesError

const quizIds = quizzes.map((quiz) => quiz.id)

const before = await draftCounts(courseIds, quizIds)

await publishCourseScoped('flashcards', courseIds)
await publishCourseScoped('quizzes', courseIds)
await publishCourseScoped('lecture_tags', courseIds)
await publishCourseScoped('study_guides', courseIds)

if (quizIds.length) {
  await publishQuizQuestions(quizIds)
}

const after = await draftCounts(courseIds, quizIds)

console.log('Published Supabase draft assets')
console.log(`Courses: ${targetCourseCodes.join(', ')}`)
console.log(`Flashcards: ${before.flashcards} -> ${after.flashcards} drafts`)
console.log(`Quizzes: ${before.quizzes} -> ${after.quizzes} drafts`)
console.log(`Quiz questions: ${before.quizQuestions} -> ${after.quizQuestions} drafts`)
console.log(`Lecture tags: ${before.lectureTags} -> ${after.lectureTags} drafts`)
console.log(`Study guides: ${before.studyGuides} -> ${after.studyGuides} drafts`)

async function publishCourseScoped(table, ids) {
  const { error } = await supabase
    .from(table)
    .update({ status: 'published' })
    .eq('status', 'draft')
    .in('course_id', ids)

  if (error) throw error
}

async function publishQuizQuestions(ids) {
  for (const chunk of chunks(ids, 100)) {
    const { error } = await supabase
      .from('quiz_questions')
      .update({ status: 'published' })
      .eq('status', 'draft')
      .in('quiz_id', chunk)

    if (error) throw error
  }
}

async function draftCounts(ids, questionQuizIds) {
  const [
    flashcards,
    quizzesCount,
    quizQuestions,
    lectureTags,
    studyGuides,
  ] = await Promise.all([
    countCourseScoped('flashcards', ids),
    countCourseScoped('quizzes', ids),
    countQuizQuestions(questionQuizIds),
    countCourseScoped('lecture_tags', ids),
    countCourseScoped('study_guides', ids),
  ])

  return {
    flashcards,
    quizzes: quizzesCount,
    quizQuestions,
    lectureTags,
    studyGuides,
  }
}

async function countCourseScoped(table, ids) {
  const { count, error } = await supabase
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('status', 'draft')
    .in('course_id', ids)

  if (error) throw error
  return count ?? 0
}

async function countQuizQuestions(ids) {
  if (!ids.length) return 0

  let total = 0
  for (const chunk of chunks(ids, 100)) {
    const { count, error } = await supabase
      .from('quiz_questions')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'draft')
      .in('quiz_id', chunk)

    if (error) throw error
    total += count ?? 0
  }
  return total
}

function chunks(items, size) {
  const result = []
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size))
  }
  return result
}
