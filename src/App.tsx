import {
  BookOpen,
  Brain,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  FileText,
  Library,
  ListChecks,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  RotateCcw,
  Shield,
  UserCheck,
  UserMinus,
  Users,
  XCircle,
} from 'lucide-react'
import type { FormEvent, ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import './App.css'
import {
  isLocalDemoEnabled,
  isMissingProductionSupabaseConfig,
  isSupabaseConfigured,
  supabase,
} from './lib/supabase'
import {
  createPendingProfile,
  fetchLivePortalState,
  saveLiveUserAccess,
} from './lib/liveData'
import {
  loadSessionId,
  loadState,
  saveSessionId,
  saveState,
} from './lib/store'
import type { Course, LectureSeed, PortalState, PortalUser } from './lib/types'

const cleanStudyText = (value: string) =>
  value
    .replace(/\*\*/g, '')
    .replace(/^Flashcard\s*/i, '')
    .replace(/^Quiz\s*/i, '')
    .trim()

const stopWords = new Set([
  'a',
  'an',
  'and',
  'at',
  'be',
  'for',
  'in',
  'is',
  'least',
  'need',
  'needed',
  'on',
  'pass',
  'required',
  'requirement',
  'score',
  'state',
  'the',
  'to',
])

function normaliseQuizAnswer(value: string) {
  return cleanStudyText(value)
    .toLowerCase()
    .replace(/percent/g, '%')
    .replace(/[^a-z0-9%]+/g, ' ')
    .trim()
}

function quizAnswerTokens(value: string) {
  return normaliseQuizAnswer(value)
    .split(/\s+/)
    .filter((token) => token && !stopWords.has(token))
}

function numberTokens(value: string) {
  return (normaliseQuizAnswer(value).match(/\d+(?:\.\d+)?%?/g) ?? []).map((token) =>
    token.replace(/%$/, ''),
  )
}

function isQuizAnswerCorrect(userAnswer: string, correctAnswer: string) {
  const userNormal = normaliseQuizAnswer(userAnswer)
  const correctNormal = normaliseQuizAnswer(correctAnswer)
  if (!userNormal || !correctNormal) return false
  if (userNormal === correctNormal) return true
  if (userNormal.length > 3 && correctNormal.includes(userNormal)) return true
  if (correctNormal.length > 3 && userNormal.includes(correctNormal)) return true

  const userTokens = new Set(quizAnswerTokens(userAnswer))
  const correctTokens = new Set(quizAnswerTokens(correctAnswer))
  if (!userTokens.size || !correctTokens.size) return false

  const overlap = [...userTokens].filter((token) => correctTokens.has(token)).length
  const coverage = overlap / correctTokens.size
  const precision = overlap / userTokens.size
  const correctNumbers = numberTokens(correctAnswer)
  const userNumbers = new Set(numberTokens(userAnswer))
  const matchingNumbers = correctNumbers.filter((token) => userNumbers.has(token))

  if (correctNumbers.length && matchingNumbers.length === correctNumbers.length) {
    return coverage >= 0.25 || precision >= 0.5
  }

  return coverage >= 0.65 || precision >= 0.75
}

function formatAuthError(message: string) {
  const lower = message.toLowerCase()
  if (lower.includes('rate limit') || lower.includes('email rate')) {
    return 'Supabase hit its confirmation-email rate limit. Turn off Auth > Providers > Email > Confirm email in Supabase, then try signing up again.'
  }
  return message
}

type AppView = 'notes' | 'flashcards' | 'quizzes' | 'guides' | 'admin'

function App() {
  const [state, setState] = useState<PortalState>(() => loadState())
  const [snapshotLoaded, setSnapshotLoaded] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(() => loadSessionId())
  const [liveUser, setLiveUser] = useState<PortalUser | null>(null)
  const [authLoading, setAuthLoading] = useState(isSupabaseConfigured)
  const [authError, setAuthError] = useState('')
  const [view, setView] = useState<AppView>('notes')
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null)
  const [selectedLectureSlug, setSelectedLectureSlug] = useState<string | null>(
    null,
  )

  useEffect(() => saveState(state), [state])
  useEffect(() => saveSessionId(sessionId), [sessionId])
  useEffect(() => {
    if (isSupabaseConfigured) return

    let cancelled = false
    fetch('/supabase-snapshot.json', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((snapshot: PortalState | null) => {
        if (!cancelled && snapshot?.courses?.length) {
          setState(snapshot)
          setSnapshotLoaded(true)
        }
      })
      .catch(() => {
        if (!cancelled) setSnapshotLoaded(false)
      })
    return () => {
      cancelled = true
    }
  }, [])
  useEffect(() => {
    if (!supabase) return

    let cancelled = false

    async function loadLiveState(userId: string) {
      setAuthLoading(true)
      setAuthError('')
      try {
        const live = await fetchLivePortalState(userId)
        if (cancelled) return
        setState(live.state)
        setLiveUser(live.currentUser)
        setSnapshotLoaded(false)
      } catch (error) {
        if (cancelled) return
        setAuthError(error instanceof Error ? error.message : 'Live data failed to load')
      } finally {
        if (!cancelled) setAuthLoading(false)
      }
    }

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return
      const userId = data.session?.user.id
      setSessionId(userId ?? null)
      if (userId) void loadLiveState(userId)
      else {
        setLiveUser(null)
        setAuthLoading(false)
      }
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      const userId = session?.user.id ?? null
      setSessionId(userId)
      if (userId) void loadLiveState(userId)
      else {
        setLiveUser(null)
        setAuthLoading(false)
      }
    })

    return () => {
      cancelled = true
      listener.subscription.unsubscribe()
    }
  }, [])

  const currentUser =
    liveUser ??
    (isLocalDemoEnabled
      ? state.users.find((user) => user.id === sessionId) ?? null
      : null)

  const accessibleCourses = useMemo(() => {
    if (!currentUser || currentUser.status !== 'approved') return []
    if (currentUser.role === 'admin') return state.courses
    return state.courses.filter(
      (course) => course.active && currentUser.courseIds.includes(course.id),
    )
  }, [currentUser, state.courses])

  const selectedCourse =
    accessibleCourses.find((course) => course.id === selectedCourseId) ??
    accessibleCourses[0] ??
    null
  const selectedLecture =
    selectedCourse?.lectures.find(
      (lecture) => lecture.slug === selectedLectureSlug,
    ) ??
    selectedCourse?.lectures[0] ??
    null

  if (!currentUser) {
    return (
      <AuthScreen
        state={state}
        setState={setState}
        signIn={(userId) => {
          setSessionId(userId)
          setLiveUser(null)
        }}
        onLiveAuthSuccess={async () => {
          const session = await supabase?.auth.getSession()
          const userId = session?.data.session?.user.id
          if (!userId) return
          const live = await fetchLivePortalState(userId)
          setState(live.state)
          setLiveUser(live.currentUser)
          setSessionId(userId)
        }}
        authLoading={authLoading}
        authError={authError}
        snapshotLoaded={snapshotLoaded}
      />
    )
  }

  if (currentUser.status !== 'approved') {
    return (
      <Shell
        currentUser={currentUser}
        onSignOut={() => {
          void supabase?.auth.signOut()
          setLiveUser(null)
          setSessionId(null)
        }}
      >
        <section className="empty-state">
          <Shield size={34} />
          <h1>Waiting for approval</h1>
          <p>
            Your account exists, but Gabriel needs to approve it before notes are
            visible.
          </p>
          {currentUser.email && (
            <p>
              Tell Donna this email so it can be approved: <strong>{currentUser.email}</strong>
            </p>
          )}
        </section>
      </Shell>
    )
  }

  return (
    <Shell
      currentUser={currentUser}
      onSignOut={() => {
        void supabase?.auth.signOut()
        setLiveUser(null)
        setSessionId(null)
      }}
    >
      <div className="app-tabs">
        <button
          className={view === 'notes' ? 'active' : ''}
          onClick={() => setView('notes')}
          type="button"
        >
          <BookOpen size={17} /> Notes
        </button>
        <button
          className={view === 'flashcards' ? 'active' : ''}
          onClick={() => setView('flashcards')}
          type="button"
        >
          <Brain size={17} /> Flashcards
        </button>
        <button
          className={view === 'quizzes' ? 'active' : ''}
          onClick={() => setView('quizzes')}
          type="button"
        >
          <ListChecks size={17} /> Quizzes
        </button>
        <button
          className={view === 'guides' ? 'active' : ''}
          onClick={() => setView('guides')}
          type="button"
        >
          <FileText size={17} /> Guides
        </button>
        {currentUser.role === 'admin' && (
          <button
            className={view === 'admin' ? 'active' : ''}
            onClick={() => setView('admin')}
            type="button"
          >
            <Shield size={17} /> Admin
          </button>
        )}
      </div>

      {view === 'admin' && currentUser.role === 'admin' ? (
        <AdminPanel state={state} setState={setState} />
      ) : view === 'flashcards' ? (
        <FlashcardsView
          state={state}
          courses={accessibleCourses}
          selectedCourse={selectedCourse}
          setSelectedCourseId={(courseId) => {
            setSelectedCourseId(courseId)
            setSelectedLectureSlug(null)
          }}
        />
      ) : view === 'quizzes' ? (
        <QuizzesView
          state={state}
          courses={accessibleCourses}
          selectedCourse={selectedCourse}
          setSelectedCourseId={(courseId) => {
            setSelectedCourseId(courseId)
            setSelectedLectureSlug(null)
          }}
        />
      ) : view === 'guides' ? (
        <GuidesView
          state={state}
          courses={accessibleCourses}
          selectedCourse={selectedCourse}
          setSelectedCourseId={(courseId) => {
            setSelectedCourseId(courseId)
            setSelectedLectureSlug(null)
          }}
        />
      ) : (
        <NotesView
          courses={accessibleCourses}
          selectedCourse={selectedCourse}
          selectedLecture={selectedLecture}
          setSelectedCourseId={(courseId) => {
            setSelectedCourseId(courseId)
            setSelectedLectureSlug(null)
          }}
          setSelectedLectureSlug={setSelectedLectureSlug}
        />
      )}
    </Shell>
  )
}

function AuthScreen({
  state,
  setState,
  signIn,
  onLiveAuthSuccess,
  authLoading,
  authError,
  snapshotLoaded,
}: {
  state: PortalState
  setState: (state: PortalState) => void
  signIn: (userId: string) => void
  onLiveAuthSuccess: () => Promise<void>
  authLoading: boolean
  authError: string
  snapshotLoaded: boolean
}) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [message, setMessage] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    const normalEmail = email.trim().toLowerCase()
    if (!normalEmail) return

    if (isMissingProductionSupabaseConfig) {
      setMessage('Supabase is not configured for this deployment.')
      return
    }

    if (supabase) {
      if (password.length < 6) {
        setMessage('Use a password with at least 6 characters.')
        return
      }

      const result =
        mode === 'signin'
          ? await supabase.auth.signInWithPassword({
              email: normalEmail,
              password,
            })
          : await supabase.auth.signUp({
              email: normalEmail,
              password,
              options: { data: { name: name.trim() || normalEmail.split('@')[0] } },
            })

      if (result.error) {
        setMessage(formatAuthError(result.error.message))
        return
      }

      if (mode === 'signup' && !result.data.session) {
        setMessage(
          'Account created, but Supabase email confirmation is still enabled. Turn off Auth > Providers > Email > Confirm email so new users go straight to pending approval.',
        )
        return
      }

      if (mode === 'signup' && result.data.user) {
        try {
          await createPendingProfile(
            result.data.user.id,
            normalEmail,
            name.trim() || normalEmail.split('@')[0],
          )
        } catch (error) {
          setMessage(
            error instanceof Error
              ? `Account created, but pending profile was not saved: ${error.message}`
              : 'Account created, but pending profile was not saved.',
          )
          return
        }
      }

      await onLiveAuthSuccess()
      return
    }

    const existing = state.users.find((user) => user.email === normalEmail)
    if (mode === 'signin') {
      if (!existing) {
        setMessage('No account exists yet. Sign up first.')
        return
      }
      signIn(existing.id)
      return
    }

    if (existing) {
      signIn(existing.id)
      return
    }

    const user: PortalUser = {
      id: crypto.randomUUID(),
      email: normalEmail,
      name: name.trim() || normalEmail.split('@')[0],
      role: 'student',
      status: 'pending',
      courseIds: [],
      createdAt: new Date().toISOString(),
    }
    setState({ ...state, users: [...state.users, user] })
    signIn(user.id)
  }

  return (
    <main className="auth-layout">
      <section className="auth-intro">
        <p className="eyebrow">Private study portal</p>
        <h1>Course notes with controlled access.</h1>
        <p>
          A future-proof home for current and future courses: accounts, approval,
          course access, and admin-managed lecture notes.
        </p>
        <div className="status-strip">
          <span>
            {isSupabaseConfigured
              ? 'Supabase connected'
              : isLocalDemoEnabled
                ? 'Demo mode'
                : 'Supabase config missing'}
          </span>
          {snapshotLoaded && <span>Snapshot loaded</span>}
          <span>{state.courses.length} courses seeded</span>
          <span>{state.courses.reduce((sum, c) => sum + c.lectures.length, 0)} lectures</span>
        </div>
      </section>
      <section className="auth-card">
        {isMissingProductionSupabaseConfig && (
          <p className="form-message">
            This deployment is missing Vercel environment variables:
            VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.
          </p>
        )}
        {!isMissingProductionSupabaseConfig && (
          <div className="segmented">
            <button
              className={mode === 'signin' ? 'active' : ''}
              onClick={() => setMode('signin')}
              type="button"
            >
              Sign in
            </button>
            <button
              className={mode === 'signup' ? 'active' : ''}
              onClick={() => setMode('signup')}
              type="button"
            >
              Sign up
            </button>
          </div>
        )}
        <form onSubmit={submit}>
          {mode === 'signup' && (
            <label>
              Name
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
          )}
          <label>
            Email
            <input
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </label>
          {isSupabaseConfigured && (
            <label>
              Password
              <input
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
              />
            </label>
          )}
          {message && <p className="form-message">{message}</p>}
          {authError && <p className="form-message">{authError}</p>}
          <button className="primary-button" type="submit">
            {isMissingProductionSupabaseConfig
              ? 'Deployment not configured'
              : authLoading
              ? 'Loading...'
              : mode === 'signin'
                ? 'Continue'
                : isSupabaseConfigured
                  ? 'Create account'
                  : 'Create pending account'}
          </button>
        </form>
        {isLocalDemoEnabled && (
          <button
            className="link-button"
            onClick={() => signIn('admin-gabriel')}
            type="button"
          >
            Open demo admin
          </button>
        )}
      </section>
    </main>
  )
}

function Shell({
  currentUser,
  children,
  onSignOut,
}: {
  currentUser: PortalUser
  children: ReactNode
  onSignOut: () => void
}) {
  return (
    <div className="portal-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Notes portal</p>
          <h1>Study Notes</h1>
        </div>
        <div className="user-chip">
          <span>{currentUser.name}</span>
          <small>{currentUser.role}</small>
          <button onClick={onSignOut} type="button" title="Sign out">
            <LogOut size={18} />
          </button>
        </div>
      </header>
      {children}
    </div>
  )
}

function NotesView({
  courses,
  selectedCourse,
  selectedLecture,
  setSelectedCourseId,
  setSelectedLectureSlug,
}: {
  courses: Course[]
  selectedCourse: Course | null
  selectedLecture: LectureSeed | null
  setSelectedCourseId: (courseId: string) => void
  setSelectedLectureSlug: (slug: string) => void
}) {
  const [showCourses, setShowCourses] = useState(true)
  const [showLectures, setShowLectures] = useState(true)
  const lectureIndex = selectedCourse?.lectures.findIndex(
    (lecture) => lecture.slug === selectedLecture?.slug,
  )
  const previous =
    lectureIndex !== undefined && lectureIndex > 0
      ? selectedCourse?.lectures[lectureIndex - 1]
      : null
  const next =
    lectureIndex !== undefined &&
    selectedCourse &&
    lectureIndex < selectedCourse.lectures.length - 1
      ? selectedCourse.lectures[lectureIndex + 1]
      : null

  if (!selectedCourse || !selectedLecture) {
    return (
      <section className="empty-state">
        <Library size={34} />
        <h1>No courses yet</h1>
        <p>An admin can add a course and grant you access.</p>
      </section>
    )
  }

  return (
    <main
      className={`notes-layout ${!showCourses ? 'hide-courses' : ''} ${
        !showLectures ? 'hide-lectures' : ''
      }`}
    >
      {showCourses && (
        <aside className="course-rail">
          <h2>Courses</h2>
          {courses.map((course) => (
            <button
              className={course.id === selectedCourse.id ? 'active' : ''}
              key={course.id}
              onClick={() => setSelectedCourseId(course.id)}
              type="button"
            >
              <strong>{course.code}</strong>
              <span>{course.lectures.length} lectures</span>
            </button>
          ))}
        </aside>
      )}
      {showLectures && (
        <aside className="lecture-rail">
          <h2>{selectedCourse.code}</h2>
          {selectedCourse.lectures.map((lecture) => (
            <button
              className={lecture.slug === selectedLecture.slug ? 'active' : ''}
              key={lecture.slug}
              onClick={() => setSelectedLectureSlug(lecture.slug)}
              type="button"
            >
              <span>{lecture.date}</span>
              <strong>{lecture.title}</strong>
            </button>
          ))}
        </aside>
      )}
      <article className="reader">
        <div className="reader-toolbar">
          <button onClick={() => setShowCourses((current) => !current)} type="button">
            {showCourses ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}
            {showCourses ? 'Hide courses' : 'Show courses'}
          </button>
          <button onClick={() => setShowLectures((current) => !current)} type="button">
            {showLectures ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}
            {showLectures ? 'Hide lectures' : 'Show lectures'}
          </button>
          <button
            onClick={() => {
              setShowCourses(false)
              setShowLectures(false)
            }}
            type="button"
          >
            Full reader
          </button>
        </div>
        <div className="reader-header">
          <div>
            <p className="eyebrow">
              {selectedCourse.code} · {selectedLecture.date}
            </p>
            <h1>{selectedLecture.title}</h1>
            {selectedLecture.subtitle && <p>{selectedLecture.subtitle}</p>}
          </div>
        </div>
        <nav className="reader-nav">
          <button
            disabled={!previous}
            onClick={() => previous && setSelectedLectureSlug(previous.slug)}
            type="button"
          >
            <ChevronLeft size={17} /> Previous
          </button>
          <button
            disabled={!next}
            onClick={() => next && setSelectedLectureSlug(next.slug)}
            type="button"
          >
            Next <ChevronRight size={17} />
          </button>
        </nav>
        <div
          className="note-content"
          dangerouslySetInnerHTML={{ __html: selectedLecture.contentHtml }}
        />
      </article>
    </main>
  )
}

function StudyCourseRail({
  courses,
  selectedCourse,
  setSelectedCourseId,
}: {
  courses: Course[]
  selectedCourse: Course | null
  setSelectedCourseId: (courseId: string) => void
}) {
  return (
    <aside className="course-rail">
      <h2>Courses</h2>
      {courses.map((course) => (
        <button
          className={course.id === selectedCourse?.id ? 'active' : ''}
          key={course.id}
          onClick={() => setSelectedCourseId(course.id)}
          type="button"
        >
          <strong>{course.code}</strong>
          <span>{course.lectures.length} lectures</span>
        </button>
      ))}
    </aside>
  )
}

function lectureTitle(course: Course | null, lectureSlug: string) {
  return (
    course?.lectures.find((lecture) => lecture.slug === lectureSlug)?.title ??
    'Lecture'
  )
}

function FlashcardsView({
  state,
  courses,
  selectedCourse,
  setSelectedCourseId,
}: {
  state: PortalState
  courses: Course[]
  selectedCourse: Course | null
  setSelectedCourseId: (courseId: string) => void
}) {
  const [flashcardIndex, setFlashcardIndex] = useState(0)
  const [flashcardFlipped, setFlashcardFlipped] = useState(false)
  const publishedFlashcards = state.flashcards.filter(
    (card) =>
      card.status === 'published' &&
      (!selectedCourse || card.courseId === selectedCourse.id),
  )
  const activeCard = publishedFlashcards[flashcardIndex] ?? null

  useEffect(() => {
    setFlashcardIndex(0)
    setFlashcardFlipped(false)
  }, [selectedCourse?.id])

  function moveFlashcard(direction: -1 | 1) {
    if (!publishedFlashcards.length) return
    setFlashcardIndex((current) => {
      const next = current + direction
      if (next < 0) return publishedFlashcards.length - 1
      if (next >= publishedFlashcards.length) return 0
      return next
    })
    setFlashcardFlipped(false)
  }

  return (
    <main className="study-layout">
      <StudyCourseRail
        courses={courses}
        selectedCourse={selectedCourse}
        setSelectedCourseId={setSelectedCourseId}
      />
      <section className="study-dashboard study-workspace flashcards-workspace">
        <div className="workspace-hero">
          <div>
            <p className="eyebrow">Flashcards</p>
            <h2>
              {selectedCourse
                ? `${selectedCourse.code} active recall`
                : 'Flashcards'}
            </h2>
            <p>One card at a time, with the answer hidden until you flip it.</p>
          </div>
          <div className="study-stats">
            <span>{publishedFlashcards.length} cards</span>
            <span>
              {activeCard
                ? lectureTitle(selectedCourse, activeCard.lectureSlug)
                : 'No lecture'}
            </span>
          </div>
        </div>

        {activeCard ? (
          <section className="study-tool-card full-tool">
            <div className="tool-header">
              <div>
                <span>
                  Card {flashcardIndex + 1} of {publishedFlashcards.length}
                </span>
                <h3>{lectureTitle(selectedCourse, activeCard.lectureSlug)}</h3>
              </div>
              <button
                className="icon-button"
                onClick={() => setFlashcardFlipped(false)}
                title="Reset card"
                type="button"
              >
                <RotateCcw size={17} />
              </button>
            </div>
            <button
              className={`flashcard-stage large ${
                flashcardFlipped ? 'flipped' : ''
              }`}
              onClick={() => setFlashcardFlipped(!flashcardFlipped)}
              type="button"
            >
              <span>{flashcardFlipped ? 'Answer' : 'Question'}</span>
              <strong>
                {cleanStudyText(
                  flashcardFlipped ? activeCard.back : activeCard.front,
                )}
              </strong>
              <small>Click to flip</small>
            </button>
            <div className="tool-actions deck-actions">
              <button onClick={() => moveFlashcard(-1)} type="button">
                <ChevronLeft size={17} /> Previous
              </button>
              <button
                className="primary-button"
                onClick={() => setFlashcardFlipped(!flashcardFlipped)}
                type="button"
              >
                {flashcardFlipped ? 'Show question' : 'Show answer'}
              </button>
              <button onClick={() => moveFlashcard(1)} type="button">
                Next <ChevronRight size={17} />
              </button>
            </div>
          </section>
        ) : (
          <div className="empty-panel">
            <Brain size={24} />
            <strong>No flashcards for this course yet</strong>
            <p>Published lecture flashcards will appear here automatically.</p>
          </div>
        )}
      </section>
    </main>
  )
}

function QuizzesView({
  state,
  courses,
  selectedCourse,
  setSelectedCourseId,
}: {
  state: PortalState
  courses: Course[]
  selectedCourse: Course | null
  setSelectedCourseId: (courseId: string) => void
}) {
  const [selectedQuizId, setSelectedQuizId] = useState<string | null>(null)
  const [questionIndex, setQuestionIndex] = useState(0)
  const [selectedAnswer, setSelectedAnswer] = useState('')
  const [answerRevealed, setAnswerRevealed] = useState(false)
  const publishedQuizzes = state.quizzes.filter(
    (quiz) =>
      quiz.status === 'published' &&
      (!selectedCourse || quiz.courseId === selectedCourse.id),
  )
  const selectedQuiz =
    publishedQuizzes.find((quiz) => quiz.id === selectedQuizId) ??
    publishedQuizzes[0] ??
    null
  const quizQuestions = selectedQuiz
    ? state.quizQuestions.filter(
        (question) =>
          question.quizId === selectedQuiz.id && question.status === 'published',
      )
    : []
  const activeQuestion = quizQuestions[questionIndex] ?? null
  const isCorrect =
    activeQuestion &&
    isQuizAnswerCorrect(selectedAnswer, activeQuestion.correctAnswer)

  useEffect(() => {
    setSelectedQuizId(null)
    setQuestionIndex(0)
    setSelectedAnswer('')
    setAnswerRevealed(false)
  }, [selectedCourse?.id])

  useEffect(() => {
    setQuestionIndex(0)
    setSelectedAnswer('')
    setAnswerRevealed(false)
  }, [selectedQuiz?.id])

  function moveQuestion(direction: -1 | 1) {
    if (!quizQuestions.length) return
    setQuestionIndex((current) => {
      const next = current + direction
      if (next < 0) return quizQuestions.length - 1
      if (next >= quizQuestions.length) return 0
      return next
    })
    setSelectedAnswer('')
    setAnswerRevealed(false)
  }

  return (
    <main className="study-layout">
      <StudyCourseRail
        courses={courses}
        selectedCourse={selectedCourse}
        setSelectedCourseId={setSelectedCourseId}
      />
      <section className="study-dashboard study-workspace quizzes-workspace">
        <div className="workspace-hero">
          <div>
            <p className="eyebrow">Quizzes</p>
            <h2>
              {selectedCourse ? `${selectedCourse.code} practice` : 'Quizzes'}
            </h2>
            <p>Pick a quiz, answer each question, then review the explanation.</p>
          </div>
          <div className="study-stats">
            <span>{publishedQuizzes.length} quizzes</span>
            <span>{quizQuestions.length} questions</span>
          </div>
        </div>
        {publishedQuizzes.length > 1 && (
          <div className="quiz-picker">
            <label htmlFor="quiz-picker">Quiz</label>
            <select
              id="quiz-picker"
              value={selectedQuiz?.id ?? ''}
              onChange={(event) => setSelectedQuizId(event.target.value)}
            >
              {publishedQuizzes.map((quiz) => (
                <option key={quiz.id} value={quiz.id}>
                  {quiz.title}
                </option>
              ))}
            </select>
          </div>
        )}
        {activeQuestion ? (
          <section className="study-tool-card full-tool quiz-focus">
            <div className="tool-header">
              <div>
                <span>
                  Question {questionIndex + 1} of {quizQuestions.length}
                </span>
                <h3>{selectedQuiz?.title ?? 'Quiz'}</h3>
              </div>
            </div>
            <div className="quiz-question">
              <strong>{cleanStudyText(activeQuestion.prompt)}</strong>
              {activeQuestion.options.length ? (
                <div className="quiz-options">
                  {activeQuestion.options.map((option) => (
                    <button
                      className={selectedAnswer === option ? 'selected' : ''}
                      key={option}
                      onClick={() => {
                        setSelectedAnswer(option)
                        setAnswerRevealed(false)
                      }}
                      type="button"
                    >
                      {cleanStudyText(option)}
                    </button>
                  ))}
                </div>
              ) : (
                <input
                  onChange={(event) => {
                    setSelectedAnswer(event.target.value)
                    setAnswerRevealed(false)
                  }}
                  placeholder="Type your answer"
                  value={selectedAnswer}
                />
              )}
              <div className="tool-actions">
                <button onClick={() => moveQuestion(-1)} type="button">
                  <ChevronLeft size={17} /> Previous
                </button>
                <button
                  className="primary-button"
                  disabled={!selectedAnswer.trim()}
                  onClick={() => setAnswerRevealed(true)}
                  type="button"
                >
                  Check answer
                </button>
                <button onClick={() => moveQuestion(1)} type="button">
                  Next <ChevronRight size={17} />
                </button>
              </div>
              {answerRevealed && (
                <div className={`answer-panel ${isCorrect ? 'correct' : 'incorrect'}`}>
                  {isCorrect ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
                  <div>
                    <strong>{isCorrect ? 'Correct' : 'Review this one'}</strong>
                    <p>Answer: {cleanStudyText(activeQuestion.correctAnswer)}</p>
                    {activeQuestion.explanation && (
                      <p>{cleanStudyText(activeQuestion.explanation)}</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </section>
        ) : (
          <div className="empty-panel">
            <ListChecks size={24} />
            <strong>No quizzes for this course yet</strong>
            <p>Published lecture quizzes will appear here automatically.</p>
          </div>
        )}
      </section>
    </main>
  )
}

function GuidesView({
  state,
  courses,
  selectedCourse,
  setSelectedCourseId,
}: {
  state: PortalState
  courses: Course[]
  selectedCourse: Course | null
  setSelectedCourseId: (courseId: string) => void
}) {
  const [selectedGuideId, setSelectedGuideId] = useState<string | null>(null)
  const publishedGuides = state.studyGuides.filter(
    (guide) =>
      guide.status === 'published' &&
      (!selectedCourse || guide.courseId === selectedCourse.id),
  )
  const activeGuide =
    publishedGuides.find((guide) => guide.id === selectedGuideId) ??
    publishedGuides[0] ??
    null

  useEffect(() => {
    setSelectedGuideId(null)
  }, [selectedCourse?.id])

  return (
    <main className="study-layout">
      <StudyCourseRail
        courses={courses}
        selectedCourse={selectedCourse}
        setSelectedCourseId={setSelectedCourseId}
      />
      <section className="study-dashboard study-workspace guides-workspace">
        <div className="workspace-hero">
          <div>
            <p className="eyebrow">Guides</p>
            <h2>
              {selectedCourse ? `${selectedCourse.code} study guides` : 'Guides'}
            </h2>
            <p>Lecture summaries and concept guides in a dedicated reading space.</p>
          </div>
          <div className="study-stats">
            <span>{publishedGuides.length} guides</span>
          </div>
        </div>
        {activeGuide ? (
          <div className="guides-grid">
            <aside className="guide-list">
              {publishedGuides.map((guide) => (
                <button
                  className={guide.id === activeGuide.id ? 'active' : ''}
                  key={guide.id}
                  onClick={() => setSelectedGuideId(guide.id)}
                  type="button"
                >
                  <span>{lectureTitle(selectedCourse, guide.lectureSlug)}</span>
                  <strong>{cleanStudyText(guide.title)}</strong>
                </button>
              ))}
            </aside>
            <article className="guide-reader">
              <p className="eyebrow">
                {selectedCourse?.code} ·{' '}
                {lectureTitle(selectedCourse, activeGuide.lectureSlug)}
              </p>
              <h3>{cleanStudyText(activeGuide.title)}</h3>
              {activeGuide.content
                .split(/\n{2,}/)
                .map((paragraph) => paragraph.trim())
                .filter(Boolean)
                .map((paragraph) => (
                  <p key={paragraph}>{cleanStudyText(paragraph)}</p>
                ))}
            </article>
          </div>
        ) : (
          <div className="empty-panel">
            <FileText size={24} />
            <strong>No study guides for this course yet</strong>
            <p>Published lecture guides will appear here automatically.</p>
          </div>
        )}
      </section>
    </main>
  )
}

function AdminPanel({
  state,
  setState,
}: {
  state: PortalState
  setState: (state: PortalState) => void
}) {
  const [savingUserId, setSavingUserId] = useState<string | null>(null)
  const [saveMessage, setSaveMessage] = useState('')

  async function updateUser(userId: string, patch: Partial<PortalUser>) {
    const current = state.users.find((user) => user.id === userId)
    if (!current) return

    const nextUser = { ...current, ...patch }
    setState({
      ...state,
      users: state.users.map((user) => (user.id === userId ? nextUser : user)),
    })

    if (!isSupabaseConfigured) return

    setSavingUserId(userId)
    setSaveMessage('')
    try {
      await saveLiveUserAccess(nextUser)
      setSaveMessage(`Saved ${nextUser.email}`)
    } catch (error) {
      setSaveMessage(
        error instanceof Error ? error.message : 'Could not save user access',
      )
    } finally {
      setSavingUserId(null)
    }
  }

  const pendingUsers = state.users.filter((user) => user.status === 'pending')
  const approvedUsers = state.users.filter((user) => user.status === 'approved')
  const disabledUsers = state.users.filter((user) => user.status === 'disabled')
  const publishedAssetCount =
    state.flashcards.filter((item) => item.status === 'published').length +
    state.quizzes.filter((item) => item.status === 'published').length +
    state.quizQuestions.filter((item) => item.status === 'published').length +
    state.lectureTags.filter((item) => item.status === 'published').length +
    state.studyGuides.filter((item) => item.status === 'published').length

  return (
    <main className="admin-layout">
      <section className="admin-hero">
        <div className="section-title">
          <Shield size={22} />
          <h2>Admin</h2>
        </div>
        <p>
          Approve new accounts, disable access, and choose which courses each
          student can see.
        </p>
        <div className="admin-metrics">
          <span>
            <strong>{pendingUsers.length}</strong>
            Pending
          </span>
          <span>
            <strong>{approvedUsers.length}</strong>
            Approved
          </span>
          <span>
            <strong>{disabledUsers.length}</strong>
            Disabled
          </span>
          <span>
            <strong>{publishedAssetCount}</strong>
            Published study assets
          </span>
        </div>
        {saveMessage && <p className="save-message">{saveMessage}</p>}
      </section>

      <section className="admin-section">
        <div className="section-title">
          <Users size={20} />
          <h2>Accounts</h2>
        </div>
        <div className="people-list">
          {state.users.map((user) => (
            <article className={`person-row ${user.status}`} key={user.id}>
              <div className="person-main">
                <div className="person-avatar">
                  {user.name.slice(0, 1).toUpperCase()}
                </div>
                <div>
                  <strong>{user.name}</strong>
                  <span>{user.email}</span>
                  <small>
                    {user.status} · {user.role}
                  </small>
                </div>
              </div>
              <div className="person-controls">
                <select
                  value={user.role}
                  onChange={(e) =>
                    void updateUser(user.id, {
                      role: e.target.value as PortalUser['role'],
                      courseIds:
                        e.target.value === 'admin'
                          ? state.courses.map((course) => course.id)
                          : user.courseIds,
                    })
                  }
                >
                  <option value="student">student</option>
                  <option value="admin">admin</option>
                </select>
                <select
                  value={user.status}
                  onChange={(e) =>
                    void updateUser(user.id, {
                      status: e.target.value as PortalUser['status'],
                    })
                  }
                >
                  <option value="approved">approved</option>
                  <option value="pending">pending</option>
                  <option value="disabled">disabled</option>
                </select>
                {user.status === 'pending' && (
                  <button
                    className="primary-button"
                    disabled={savingUserId === user.id}
                    onClick={() =>
                      void updateUser(user.id, {
                        status: 'approved',
                        courseIds: user.courseIds.length
                          ? user.courseIds
                          : state.courses.map((course) => course.id),
                      })
                    }
                    type="button"
                  >
                    <UserCheck size={17} /> Approve
                  </button>
                )}
                <button
                  className="icon-button"
                  disabled={savingUserId === user.id}
                  onClick={() => void updateUser(user.id, { status: 'disabled' })}
                  title="Disable user"
                  type="button"
                >
                  <UserMinus size={17} />
                </button>
              </div>
              <div className="course-access">
                {state.courses.map((course) => {
                  const checked =
                    user.role === 'admin' || user.courseIds.includes(course.id)
                  return (
                    <label key={course.id}>
                      <input
                        checked={checked}
                        disabled={user.role === 'admin'}
                        onChange={(event) => {
                          const courseIds = event.target.checked
                            ? [...user.courseIds, course.id]
                            : user.courseIds.filter((id) => id !== course.id)
                          void updateUser(user.id, { courseIds })
                        }}
                        type="checkbox"
                      />
                      <span>
                        <strong>{course.code}</strong>
                        {course.title}
                      </span>
                    </label>
                  )
                })}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="admin-section">
        <div className="section-title">
          <Library size={20} />
          <h2>Course access</h2>
        </div>
        <div className="course-overview-grid">
          {state.courses.map((course) => (
            <article className="course-overview-card" key={course.id}>
              <div>
                <strong>{course.code}</strong>
                <span>{course.title}</span>
              </div>
              <p>{course.lectures.length} lectures</p>
              <p>
                {
                  state.users.filter(
                    (user) =>
                      user.status === 'approved' &&
                      (user.role === 'admin' || user.courseIds.includes(course.id)),
                  ).length
                }{' '}
                approved users
              </p>
            </article>
          ))}
        </div>
      </section>
    </main>
  )
}

export default App
