export type Role = 'admin' | 'student'
export type UserStatus = 'approved' | 'pending' | 'disabled'
export type DraftStatus = 'draft' | 'published' | 'archived'
export type QuizQuestionType = 'multiple_choice' | 'short_answer'
export type AiGenerationStatus = 'queued' | 'running' | 'succeeded' | 'failed'

export type LectureSeed = {
  slug: string
  date: string
  title: string
  subtitle: string
  contentHtml: string
}

export type CourseSeed = {
  code: string
  title: string
  term: string
  active: boolean
  lectures: LectureSeed[]
}

export type Course = CourseSeed & {
  id: string
}

export type PortalUser = {
  id: string
  email: string
  name: string
  role: Role
  status: UserStatus
  courseIds: string[]
  createdAt: string
}

export type Flashcard = {
  id: string
  courseId: string
  lectureSlug: string
  front: string
  back: string
  status: DraftStatus
  difficultySeed: 'intro' | 'core' | 'exam'
  createdByAi: boolean
  createdAt: string
}

export type Quiz = {
  id: string
  courseId: string
  lectureSlug: string
  title: string
  status: DraftStatus
  createdByAi: boolean
  createdAt: string
}

export type QuizQuestion = {
  id: string
  quizId: string
  type: QuizQuestionType
  prompt: string
  options: string[]
  correctAnswer: string
  explanation: string
  status: DraftStatus
  createdByAi: boolean
}

export type LectureTag = {
  id: string
  courseId: string
  lectureSlug: string
  tag: string
  status: DraftStatus
  createdByAi: boolean
}

export type StudyGuide = {
  id: string
  courseId: string
  lectureSlug: string
  title: string
  content: string
  status: DraftStatus
  createdByAi: boolean
  createdAt: string
}

export type AiGenerationJob = {
  id: string
  courseId: string
  lectureSlug: string
  type: 'study_package'
  status: AiGenerationStatus
  promptVersion: string
  error: string | null
  createdAt: string
}

export type PortalState = {
  courses: Course[]
  users: PortalUser[]
  flashcards: Flashcard[]
  quizzes: Quiz[]
  quizQuestions: QuizQuestion[]
  lectureTags: LectureTag[]
  studyGuides: StudyGuide[]
  aiGenerationJobs: AiGenerationJob[]
}
