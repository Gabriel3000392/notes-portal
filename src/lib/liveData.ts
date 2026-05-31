import { supabase } from './supabase'
import { sortPortalStateLectures } from './sort'
import type {
  AiGenerationJob,
  DraftStatus,
  Flashcard,
  PortalState,
  PortalUser,
  QuizQuestion,
} from './types'

type DbCourse = {
  id: string
  code: string
  title: string
  term: string
  active: boolean
}

type DbLecture = {
  id: string
  course_id: string
  slug: string
  lecture_date: string | null
  title: string
  subtitle: string
  content_html: string
  sort_order: number
}

type DbProfile = {
  id: string
  email: string
  name: string
  role: PortalUser['role']
  status: PortalUser['status']
  created_at: string
}

type DbEnrolment = {
  user_id: string
  course_id: string
}

export async function fetchLivePortalState(userId: string) {
  if (!supabase) throw new Error('Supabase is not configured')

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, email, name, role, status, created_at')
    .eq('id', userId)
    .maybeSingle<DbProfile>()

  if (profileError) throw profileError

  if (!profile) {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    return {
      currentUser: {
        id: userId,
        email: user?.email ?? '',
        name: user?.user_metadata?.name ?? user?.email ?? 'Pending user',
        role: 'student',
        status: 'pending',
        courseIds: [],
        createdAt: user?.created_at ?? new Date().toISOString(),
      } satisfies PortalUser,
      state: emptyState(),
    }
  }

  const [
    courses,
    lectures,
    profiles,
    enrolments,
    flashcards,
    quizzes,
    quizQuestions,
    lectureTags,
    studyGuides,
    aiGenerationJobs,
  ] = await Promise.all([
    selectAll<DbCourse>('courses', 'id, code, title, term, active'),
    selectAll<DbLecture>(
      'lectures',
      'id, course_id, slug, lecture_date, title, subtitle, content_html, sort_order',
    ),
    selectAll<DbProfile>('profiles', 'id, email, name, role, status, created_at'),
    selectAll<DbEnrolment>('enrolments', 'user_id, course_id'),
    selectAll<{
      id: string
      course_id: string
      lecture_id: string
      front: string
      back: string
      status: DraftStatus
      difficulty_seed: Flashcard['difficultySeed']
      created_by_ai: boolean
      created_at: string
    }>(
      'flashcards',
      'id, course_id, lecture_id, front, back, status, difficulty_seed, created_by_ai, created_at',
    ),
    selectAll<{
      id: string
      course_id: string
      lecture_id: string
      title: string
      status: DraftStatus
      created_by_ai: boolean
      created_at: string
    }>('quizzes', 'id, course_id, lecture_id, title, status, created_by_ai, created_at'),
    selectAll<{
      id: string
      quiz_id: string
      type: QuizQuestion['type']
      prompt: string
      options: string[]
      correct_answer: string
      explanation: string
      status: DraftStatus
      created_by_ai: boolean
    }>(
      'quiz_questions',
      'id, quiz_id, type, prompt, options, correct_answer, explanation, status, created_by_ai',
    ),
    selectAll<{
      id: string
      course_id: string
      lecture_id: string
      tag: string
      status: DraftStatus
      created_by_ai: boolean
    }>('lecture_tags', 'id, course_id, lecture_id, tag, status, created_by_ai'),
    selectAll<{
      id: string
      course_id: string
      lecture_id: string
      title: string
      content: string
      status: DraftStatus
      created_by_ai: boolean
      created_at: string
    }>(
      'study_guides',
      'id, course_id, lecture_id, title, content, status, created_by_ai, created_at',
    ),
    selectAll<{
      id: string
      course_id: string
      lecture_id: string
      type: AiGenerationJob['type']
      status: AiGenerationJob['status']
      prompt_version: string
      error: string | null
      created_at: string
    }>(
      'ai_generation_jobs',
      'id, course_id, lecture_id, type, status, prompt_version, error, created_at',
    ),
  ])

  const lectureById = new Map(lectures.map((lecture) => [lecture.id, lecture]))
  const enrolmentsByUser = new Map<string, string[]>()
  for (const enrolment of enrolments) {
    const existing = enrolmentsByUser.get(enrolment.user_id) ?? []
    existing.push(enrolment.course_id)
    enrolmentsByUser.set(enrolment.user_id, existing)
  }

  const state: PortalState = sortPortalStateLectures({
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
          .sort(compareDbLecturesByDate)
          .map((lecture) => ({
            slug: lecture.slug,
            date: lecture.lecture_date ?? '',
            title: lecture.title,
            subtitle: lecture.subtitle,
            contentHtml: lecture.content_html,
          })),
      })),
    users: profiles.map((item) => ({
      id: item.id,
      email: item.email,
      name: item.name,
      role: item.role,
      status: item.status,
      courseIds: enrolmentsByUser.get(item.id) ?? [],
      createdAt: item.created_at,
    })),
    flashcards: flashcards.map((item) => ({
      id: item.id,
      courseId: item.course_id,
      lectureSlug: lectureById.get(item.lecture_id)?.slug ?? '',
      front: item.front,
      back: item.back,
      status: item.status,
      difficultySeed: item.difficulty_seed,
      createdByAi: item.created_by_ai,
      createdAt: item.created_at,
    })),
    quizzes: quizzes.map((item) => ({
      id: item.id,
      courseId: item.course_id,
      lectureSlug: lectureById.get(item.lecture_id)?.slug ?? '',
      title: item.title,
      status: item.status,
      createdByAi: item.created_by_ai,
      createdAt: item.created_at,
    })),
    quizQuestions: quizQuestions.map((item) => ({
      id: item.id,
      quizId: item.quiz_id,
      type: item.type,
      prompt: item.prompt,
      options: item.options,
      correctAnswer: item.correct_answer,
      explanation: item.explanation,
      status: item.status,
      createdByAi: item.created_by_ai,
    })),
    lectureTags: lectureTags.map((item) => ({
      id: item.id,
      courseId: item.course_id,
      lectureSlug: lectureById.get(item.lecture_id)?.slug ?? '',
      tag: item.tag,
      status: item.status,
      createdByAi: item.created_by_ai,
    })),
    studyGuides: studyGuides.map((item) => ({
      id: item.id,
      courseId: item.course_id,
      lectureSlug: lectureById.get(item.lecture_id)?.slug ?? '',
      title: item.title,
      content: item.content,
      status: item.status,
      createdByAi: item.created_by_ai,
      createdAt: item.created_at,
    })),
    aiGenerationJobs: aiGenerationJobs.map((item) => ({
      id: item.id,
      courseId: item.course_id,
      lectureSlug: lectureById.get(item.lecture_id)?.slug ?? '',
      type: item.type,
      status: item.status,
      promptVersion: item.prompt_version,
      error: item.error,
      createdAt: item.created_at,
    })),
  })

  return {
    currentUser:
      state.users.find((user) => user.id === profile.id) ??
      ({
        id: profile.id,
        email: profile.email,
        name: profile.name,
        role: profile.role,
        status: profile.status,
        courseIds: [],
        createdAt: profile.created_at,
      } satisfies PortalUser),
    state,
  }
}

export async function saveLiveUserAccess(user: PortalUser) {
  if (!supabase) throw new Error('Supabase is not configured')

  const { error: profileError } = await supabase
    .from('profiles')
    .update({
      name: user.name,
      role: user.role,
      status: user.status,
    })
    .eq('id', user.id)

  if (profileError) throw profileError

  const { error: deleteError } = await supabase
    .from('enrolments')
    .delete()
    .eq('user_id', user.id)

  if (deleteError) throw deleteError

  if (user.courseIds.length) {
    const { error: insertError } = await supabase.from('enrolments').insert(
      user.courseIds.map((courseId) => ({
        user_id: user.id,
        course_id: courseId,
      })),
    )

    if (insertError) throw insertError
  }
}

export async function createPendingProfile(userId: string, email: string, name: string) {
  if (!supabase) throw new Error('Supabase is not configured')

  const { error } = await supabase
    .from('profiles')
    .upsert(
      {
        id: userId,
        email,
        name,
        role: 'student',
        status: 'pending',
      },
      { ignoreDuplicates: true, onConflict: 'id' },
    )

  if (error) throw error
}

async function selectAll<T>(table: string, columns: string): Promise<T[]> {
  if (!supabase) throw new Error('Supabase is not configured')

  const rows: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .range(from, from + 999)

    if (error) throw error
    rows.push(...((data ?? []) as T[]))
    if (!data || data.length < 1000) break
  }

  return rows
}

function emptyState(): PortalState {
  return {
    courses: [],
    users: [],
    flashcards: [],
    quizzes: [],
    quizQuestions: [],
    lectureTags: [],
    studyGuides: [],
    aiGenerationJobs: [],
  }
}

function compareDbLecturesByDate(a: DbLecture, b: DbLecture) {
  const dateCompare = (a.lecture_date ?? '').localeCompare(b.lecture_date ?? '')
  if (dateCompare !== 0) return dateCompare
  const orderCompare = a.sort_order - b.sort_order
  if (orderCompare !== 0) return orderCompare
  return a.title.localeCompare(b.title)
}
