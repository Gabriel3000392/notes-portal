import {
  BookOpen,
  Brain,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Library,
  LogOut,
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
import { isSupabaseConfigured, supabase } from './lib/supabase'
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

function App() {
  const [state, setState] = useState<PortalState>(() => loadState())
  const [snapshotLoaded, setSnapshotLoaded] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(() => loadSessionId())
  const [liveUser, setLiveUser] = useState<PortalUser | null>(null)
  const [authLoading, setAuthLoading] = useState(isSupabaseConfigured)
  const [authError, setAuthError] = useState('')
  const [view, setView] = useState<'notes' | 'study' | 'admin'>('notes')
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
    (!isSupabaseConfigured
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
          className={view === 'study' ? 'active' : ''}
          onClick={() => setView('study')}
          type="button"
        >
          <Brain size={17} /> Study
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
      ) : view === 'study' ? (
        <StudyView
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
        setMessage(result.error.message)
        return
      }

      if (mode === 'signup' && !result.data.session) {
        setMessage('Account created. Check your email if Supabase asks you to confirm it, then sign in here.')
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
          <span>{isSupabaseConfigured ? 'Supabase connected' : 'Demo mode'}</span>
          {snapshotLoaded && <span>Snapshot loaded</span>}
          <span>{state.courses.length} courses seeded</span>
          <span>{state.courses.reduce((sum, c) => sum + c.lectures.length, 0)} lectures</span>
        </div>
      </section>
      <section className="auth-card">
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
            {authLoading
              ? 'Loading...'
              : mode === 'signin'
                ? 'Continue'
                : isSupabaseConfigured
                  ? 'Create account'
                  : 'Create pending account'}
          </button>
        </form>
        {!isSupabaseConfigured && (
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
    <main className="notes-layout">
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
      <article className="reader">
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

function StudyView({
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
  const [selectedQuizId, setSelectedQuizId] = useState<string | null>(null)
  const [questionIndex, setQuestionIndex] = useState(0)
  const [selectedAnswer, setSelectedAnswer] = useState('')
  const [answerRevealed, setAnswerRevealed] = useState(false)

  const publishedFlashcards = state.flashcards.filter(
    (card) =>
      card.status === 'published' &&
      (!selectedCourse || card.courseId === selectedCourse.id),
  )
  const publishedQuizzes = state.quizzes.filter(
    (quiz) =>
      quiz.status === 'published' &&
      (!selectedCourse || quiz.courseId === selectedCourse.id),
  )
  const publishedGuides = state.studyGuides.filter(
    (guide) =>
      guide.status === 'published' &&
      (!selectedCourse || guide.courseId === selectedCourse.id),
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
  const activeCard = publishedFlashcards[flashcardIndex] ?? null
  const activeQuestion = quizQuestions[questionIndex] ?? null
  const isCorrect =
    activeQuestion &&
    selectedAnswer.trim().toLowerCase() ===
      activeQuestion.correctAnswer.trim().toLowerCase()
  const selectedCourseLectureCount = selectedCourse?.lectures.length ?? 0

  useEffect(() => {
    setFlashcardIndex(0)
    setFlashcardFlipped(false)
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
            <span>Study assets</span>
          </button>
        ))}
      </aside>
      <section className="study-dashboard">
        <div className="section-title">
          <Brain size={20} />
          <h2>{selectedCourse ? `${selectedCourse.code} study` : 'Study'}</h2>
        </div>
        <div className="study-stats">
          <span>{selectedCourseLectureCount} lectures</span>
          <span>{publishedFlashcards.length} flashcards</span>
          <span>{publishedQuizzes.length} quizzes</span>
          <span>{publishedGuides.length} study guides</span>
        </div>
        {publishedFlashcards.length === 0 && publishedQuizzes.length === 0 ? (
          <div className="empty-panel">
            <Brain size={24} />
            <strong>No study assets yet</strong>
            <p>Published flashcards and quizzes from the lecture pipeline will appear here automatically.</p>
          </div>
        ) : (
          <div className="study-tools">
            <section className="study-tool-card flashcard-tool">
              <div className="tool-header">
                <div>
                  <span>Flashcards</span>
                  <h3>
                    {publishedFlashcards.length
                      ? `${flashcardIndex + 1} of ${publishedFlashcards.length}`
                      : 'No cards'}
                  </h3>
                </div>
                <button
                  className="icon-button"
                  disabled={!publishedFlashcards.length}
                  onClick={() => setFlashcardFlipped(false)}
                  title="Reset card"
                  type="button"
                >
                  <RotateCcw size={17} />
                </button>
              </div>

              {activeCard ? (
                <>
                  <button
                    className={`flashcard-stage ${flashcardFlipped ? 'flipped' : ''}`}
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
                  <div className="tool-actions">
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
                </>
              ) : (
                <div className="empty-panel compact">
                  <strong>No flashcards for this course.</strong>
                </div>
              )}
            </section>

            <section className="study-tool-card quiz-tool">
              <div className="tool-header">
                <div>
                  <span>Quizzes</span>
                  <h3>{selectedQuiz?.title ?? 'No quiz selected'}</h3>
                </div>
                {publishedQuizzes.length > 1 && (
                  <select
                    value={selectedQuiz?.id ?? ''}
                    onChange={(event) => setSelectedQuizId(event.target.value)}
                  >
                    {publishedQuizzes.map((quiz) => (
                      <option key={quiz.id} value={quiz.id}>
                        {quiz.title}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {activeQuestion ? (
                <div className="quiz-question">
                  <span>
                    Question {questionIndex + 1} of {quizQuestions.length}
                  </span>
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
                        <p>
                          Answer: {cleanStudyText(activeQuestion.correctAnswer)}
                        </p>
                        {activeQuestion.explanation && (
                          <p>{cleanStudyText(activeQuestion.explanation)}</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="empty-panel compact">
                  <strong>No quiz questions for this course.</strong>
                </div>
              )}
            </section>
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
