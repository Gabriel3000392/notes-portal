#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL
const secretKey =
  process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY
const outputPath = resolve('public/supabase-snapshot.json')

if (!supabaseUrl || !secretKey) {
  console.error('Missing SUPABASE_URL and SUPABASE_SECRET_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, secretKey, {
  auth: { persistSession: false },
})

const [
  courses,
  lectures,
  flashcards,
  quizzes,
  quizQuestions,
  lectureTags,
  studyGuides,
  aiGenerationJobs,
] = await Promise.all([
  selectAll('courses', 'id, code, title, term, active, created_at'),
  selectAll(
    'lectures',
    'id, course_id, slug, lecture_date, title, subtitle, content_html, sort_order, active, created_at',
  ),
  selectAll(
    'flashcards',
    'id, course_id, lecture_id, front, back, status, difficulty_seed, created_by_ai, created_at',
  ),
  selectAll(
    'quizzes',
    'id, course_id, lecture_id, title, status, created_by_ai, created_at',
  ),
  selectAll(
    'quiz_questions',
    'id, quiz_id, type, prompt, options, correct_answer, explanation, status, created_by_ai',
  ),
  selectAll(
    'lecture_tags',
    'id, course_id, lecture_id, tag, status, created_by_ai',
  ),
  selectAll(
    'study_guides',
    'id, course_id, lecture_id, title, content, status, created_by_ai, created_at',
  ),
  selectAll(
    'ai_generation_jobs',
    'id, course_id, lecture_id, type, status, prompt_version, error, created_at',
  ),
])

const lectureById = new Map(lectures.map((lecture) => [lecture.id, lecture]))

const state = {
  courses: courses
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((course) => ({
      id: course.id,
      code: course.code,
      title: course.title,
      term: course.term,
      active: course.active,
      lectures: lectures
        .filter((lecture) => lecture.course_id === course.id)
        .sort(
          (a, b) =>
            String(a.lecture_date ?? '').localeCompare(
              String(b.lecture_date ?? ''),
            ) ||
            Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0) ||
            a.slug.localeCompare(b.slug),
        )
        .map((lecture) => ({
          slug: lecture.slug,
          date: lecture.lecture_date ?? '',
          title: lecture.title,
          subtitle: lecture.subtitle ?? '',
          contentHtml: lecture.content_html,
        })),
    })),
  users: [
    {
      id: 'admin-gabriel',
      email: 'gabriel@example.local',
      name: 'Gabriel',
      role: 'admin',
      status: 'approved',
      courseIds: courses.map((course) => course.id),
      createdAt: new Date().toISOString(),
    },
  ],
  flashcards: flashcards.map((card) => ({
    id: card.id,
    courseId: card.course_id,
    lectureSlug: lectureById.get(card.lecture_id)?.slug ?? '',
    front: card.front,
    back: card.back,
    status: card.status,
    difficultySeed: card.difficulty_seed,
    createdByAi: card.created_by_ai,
    createdAt: card.created_at,
  })),
  quizzes: quizzes.map((quiz) => ({
    id: quiz.id,
    courseId: quiz.course_id,
    lectureSlug: lectureById.get(quiz.lecture_id)?.slug ?? '',
    title: quiz.title,
    status: quiz.status,
    createdByAi: quiz.created_by_ai,
    createdAt: quiz.created_at,
  })),
  quizQuestions: quizQuestions.map((question) => ({
    id: question.id,
    quizId: question.quiz_id,
    type: question.type,
    prompt: question.prompt,
    options: question.options ?? [],
    correctAnswer: question.correct_answer,
    explanation: question.explanation,
    status: question.status,
    createdByAi: question.created_by_ai,
  })),
  lectureTags: lectureTags.map((tag) => ({
    id: tag.id,
    courseId: tag.course_id,
    lectureSlug: lectureById.get(tag.lecture_id)?.slug ?? '',
    tag: tag.tag,
    status: tag.status,
    createdByAi: tag.created_by_ai,
  })),
  studyGuides: studyGuides.map((guide) => ({
    id: guide.id,
    courseId: guide.course_id,
    lectureSlug: lectureById.get(guide.lecture_id)?.slug ?? '',
    title: guide.title,
    content: guide.content,
    status: guide.status,
    createdByAi: guide.created_by_ai,
    createdAt: guide.created_at,
  })),
  aiGenerationJobs: aiGenerationJobs.map((job) => ({
    id: job.id,
    courseId: job.course_id,
    lectureSlug: lectureById.get(job.lecture_id)?.slug ?? '',
    type: 'study_package',
    status: job.status,
    promptVersion: job.prompt_version,
    error: job.error,
    createdAt: job.created_at,
  })),
}

await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, `${JSON.stringify(state)}\n`, 'utf8')

console.log(
  `Wrote ${outputPath}: ${state.courses.length} courses, ${state.courses.reduce(
    (sum, course) => sum + course.lectures.length,
    0,
  )} lectures.`,
)

async function selectAll(table, columns) {
  const pageSize = 1000
  const rows = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .range(from, from + pageSize - 1)
    if (error) throw error
    rows.push(...data)
    if (data.length < pageSize) return rows
  }
}
