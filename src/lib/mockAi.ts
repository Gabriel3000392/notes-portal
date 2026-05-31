import type {
  AiGenerationJob,
  Course,
  Flashcard,
  LectureSeed,
  LectureTag,
  Quiz,
  QuizQuestion,
  StudyGuide,
} from './types'

const stripHtml = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()

const sentencesFrom = (text: string) =>
  text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 45)

const makeId = () => crypto.randomUUID()

export function generateMockStudyPackage(course: Course, lecture: LectureSeed) {
  const now = new Date().toISOString()
  const plain = stripHtml(lecture.contentHtml)
  const sentences = sentencesFrom(plain)
  const summarySeeds = sentences.slice(0, 8)
  const titleWords = lecture.title
    .split(/\W+/)
    .filter((word) => word.length > 4)
    .slice(0, 5)

  const job: AiGenerationJob = {
    id: makeId(),
    courseId: course.id,
    lectureSlug: lecture.slug,
    type: 'study_package',
    status: 'succeeded',
    promptVersion: 'mock-study-package-v1',
    error: null,
    createdAt: now,
  }

  const flashcards: Flashcard[] = summarySeeds.slice(0, 6).map((sentence, index) => ({
    id: makeId(),
    courseId: course.id,
    lectureSlug: lecture.slug,
    front: `What is the key idea from this lecture note? (${index + 1})`,
    back: sentence,
    status: 'draft',
    difficultySeed: index < 2 ? 'intro' : index < 5 ? 'core' : 'exam',
    createdByAi: true,
    createdAt: now,
  }))

  const quiz: Quiz = {
    id: makeId(),
    courseId: course.id,
    lectureSlug: lecture.slug,
    title: `${lecture.title} revision quiz`,
    status: 'draft',
    createdByAi: true,
    createdAt: now,
  }

  const quizQuestions: QuizQuestion[] = summarySeeds.slice(0, 4).map((sentence, index) => ({
    id: makeId(),
    quizId: quiz.id,
    type: index % 2 === 0 ? 'short_answer' : 'multiple_choice',
    prompt:
      index % 2 === 0
        ? `Explain this idea in your own words: ${sentence.slice(0, 120)}`
        : `Which statement best matches the lecture's treatment of ${lecture.title}?`,
    options:
      index % 2 === 0
        ? []
        : [
            sentence,
            'A related idea that is not the main point of this lecture.',
            'A definition that should be checked against another course.',
            'An unsupported claim not present in the notes.',
          ],
    correctAnswer: sentence,
    explanation: `This draft question was generated from the cleaned ${course.code} note and should be reviewed before publishing.`,
    status: 'draft',
    createdByAi: true,
  }))

  const lectureTags: LectureTag[] = Array.from(
    new Set([course.code, ...titleWords, ...lecture.title.split(/\s+/).slice(0, 3)]),
  )
    .slice(0, 6)
    .map((tag) => ({
      id: makeId(),
      courseId: course.id,
      lectureSlug: lecture.slug,
      tag,
      status: 'draft',
      createdByAi: true,
    }))

  const studyGuide: StudyGuide = {
    id: makeId(),
    courseId: course.id,
    lectureSlug: lecture.slug,
    title: `${lecture.title} exam checklist`,
    content: [
      'Before moving on, check that you can:',
      ...summarySeeds.slice(0, 6).map((sentence) => `- ${sentence}`),
    ].join('\n'),
    status: 'draft',
    createdByAi: true,
    createdAt: now,
  }

  return { job, flashcards, quiz, quizQuestions, lectureTags, studyGuide }
}
