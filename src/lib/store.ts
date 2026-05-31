import { seedCourses } from '../data/seedCourses'
import type { Course, PortalState, PortalUser } from './types'

const stateKey = 'notes-portal-state-v1'
const sessionKey = 'notes-portal-session-v1'

const now = () => new Date().toISOString()

export function makeInitialState(): PortalState {
  const courses: Course[] = seedCourses.map((course) => ({
    ...course,
    id: course.code.toLowerCase(),
  }))

  const admin: PortalUser = {
    id: 'admin-gabriel',
    email: 'gabriel@example.local',
    name: 'Gabriel',
    role: 'admin',
    status: 'approved',
    courseIds: courses.map((course) => course.id),
    createdAt: now(),
  }

  return {
    courses,
    users: [admin],
    flashcards: [],
    quizzes: [],
    quizQuestions: [],
    lectureTags: [],
    studyGuides: [],
    aiGenerationJobs: [],
  }
}

export function loadState(): PortalState {
  const raw = localStorage.getItem(stateKey)
  if (!raw) return makeInitialState()

  try {
    const parsed = JSON.parse(raw) as PortalState
    if (!Array.isArray(parsed.courses) || !Array.isArray(parsed.users)) {
      return makeInitialState()
    }
    return {
      ...parsed,
      flashcards: parsed.flashcards ?? [],
      quizzes: parsed.quizzes ?? [],
      quizQuestions: parsed.quizQuestions ?? [],
      lectureTags: parsed.lectureTags ?? [],
      studyGuides: parsed.studyGuides ?? [],
      aiGenerationJobs: parsed.aiGenerationJobs ?? [],
    }
  } catch {
    return makeInitialState()
  }
}

export function saveState(state: PortalState) {
  localStorage.setItem(stateKey, JSON.stringify(state))
}

export function loadSessionId() {
  return localStorage.getItem(sessionKey)
}

export function saveSessionId(userId: string | null) {
  if (userId) localStorage.setItem(sessionKey, userId)
  else localStorage.removeItem(sessionKey)
}
