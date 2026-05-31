import {
  BookOpen,
  Brain,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Library,
  LogOut,
  Plus,
  Shield,
  Sparkles,
  Tags,
  UserMinus,
  Users,
} from 'lucide-react'
import type { FormEvent, ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import './App.css'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import { fetchLivePortalState } from './lib/liveData'
import { generateMockStudyPackage } from './lib/mockAi'
import {
  loadSessionId,
  loadState,
  saveSessionId,
  saveState,
} from './lib/store'
import type { Course, DraftStatus, LectureSeed, PortalState, PortalUser } from './lib/types'

const makeId = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

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
        {currentUser.role === 'admin' && (
          <button
            className={view === 'admin' ? 'active' : ''}
            onClick={() => setView('admin')}
            type="button"
          >
            <Shield size={17} /> Admin
          </button>
        )}
        <button
          className={view === 'study' ? 'active' : ''}
          onClick={() => setView('study')}
          type="button"
        >
          <Brain size={17} /> Study
        </button>
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
          <span>{publishedFlashcards.length} flashcards</span>
          <span>{publishedQuizzes.length} quizzes</span>
          <span>{publishedGuides.length} study guides</span>
        </div>
        {publishedFlashcards.length === 0 && publishedQuizzes.length === 0 ? (
          <div className="empty-panel">
            <Sparkles size={24} />
            <strong>No published AI study assets yet</strong>
            <p>Generate drafts in Admin, review them, then publish.</p>
          </div>
        ) : (
          <div className="study-grid">
            {publishedFlashcards.slice(0, 8).map((card) => (
              <article className="asset-card" key={card.id}>
                <span>Flashcard</span>
                <strong>{card.front}</strong>
                <p>{card.back}</p>
              </article>
            ))}
            {publishedQuizzes.map((quiz) => (
              <article className="asset-card" key={quiz.id}>
                <span>Quiz</span>
                <strong>{quiz.title}</strong>
                <p>
                  {
                    state.quizQuestions.filter(
                      (question) =>
                        question.quizId === quiz.id &&
                        question.status === 'published',
                    ).length
                  }{' '}
                  questions
                </p>
              </article>
            ))}
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
  const [courseDraft, setCourseDraft] = useState({
    code: '',
    title: '',
    term: '2026 S2',
  })
  const [lectureDrafts, setLectureDrafts] = useState<Record<string, LectureSeed>>(
    {},
  )
  const [generationTarget, setGenerationTarget] = useState({
    courseId: state.courses[0]?.id ?? '',
    lectureSlug: state.courses[0]?.lectures[0]?.slug ?? '',
  })

  function updateUser(userId: string, patch: Partial<PortalUser>) {
    setState({
      ...state,
      users: state.users.map((user) =>
        user.id === userId ? { ...user, ...patch } : user,
      ),
    })
  }

  function addCourse(event: FormEvent) {
    event.preventDefault()
    const code = courseDraft.code.trim().toUpperCase()
    const id = makeId(code)
    if (!code || state.courses.some((course) => course.id === id)) return

    setState({
      ...state,
      courses: [
        ...state.courses,
        {
          id,
          code,
          title: courseDraft.title.trim() || code,
          term: courseDraft.term.trim() || 'Unspecified term',
          active: true,
          lectures: [],
        },
      ],
    })
    setCourseDraft({ code: '', title: '', term: '2026 S2' })
  }

  function addLecture(course: Course) {
    const draft = lectureDrafts[course.id]
    if (!draft?.title.trim()) return
    const slug = makeId(`${draft.date || 'undated'}-${draft.title}`)
    const lecture: LectureSeed = {
      ...draft,
      slug,
      contentHtml:
        draft.contentHtml.trim() ||
        '<h2>Notes</h2><p>Add lecture notes from the admin panel.</p>',
    }
    setState({
      ...state,
      courses: state.courses.map((item) =>
        item.id === course.id
          ? { ...item, lectures: [...item.lectures, lecture] }
          : item,
      ),
    })
    setLectureDrafts({ ...lectureDrafts, [course.id]: blankLecture() })
  }

  function setAssetStatus(status: DraftStatus) {
    setState({
      ...state,
      flashcards: state.flashcards.map((item) =>
        item.status === 'draft' ? { ...item, status } : item,
      ),
      quizzes: state.quizzes.map((item) =>
        item.status === 'draft' ? { ...item, status } : item,
      ),
      quizQuestions: state.quizQuestions.map((item) =>
        item.status === 'draft' ? { ...item, status } : item,
      ),
      lectureTags: state.lectureTags.map((item) =>
        item.status === 'draft' ? { ...item, status } : item,
      ),
      studyGuides: state.studyGuides.map((item) =>
        item.status === 'draft' ? { ...item, status } : item,
      ),
    })
  }

  function generateDraftPackage() {
    const course =
      state.courses.find((item) => item.id === generationTarget.courseId) ??
      state.courses[0]
    const lecture =
      course?.lectures.find(
        (item) => item.slug === generationTarget.lectureSlug,
      ) ?? course?.lectures[0]
    if (!course || !lecture) return

    const generated = generateMockStudyPackage(course, lecture)
    setState({
      ...state,
      aiGenerationJobs: [generated.job, ...state.aiGenerationJobs],
      flashcards: [...generated.flashcards, ...state.flashcards],
      quizzes: [generated.quiz, ...state.quizzes],
      quizQuestions: [...generated.quizQuestions, ...state.quizQuestions],
      lectureTags: [...generated.lectureTags, ...state.lectureTags],
      studyGuides: [generated.studyGuide, ...state.studyGuides],
    })
  }

  const activeGenerationCourse =
    state.courses.find((course) => course.id === generationTarget.courseId) ??
    state.courses[0]
  const draftSummary = {
    flashcards: state.flashcards.filter((item) => item.status === 'draft')
      .length,
    quizzes: state.quizzes.filter((item) => item.status === 'draft').length,
    questions: state.quizQuestions.filter((item) => item.status === 'draft')
      .length,
    tags: state.lectureTags.filter((item) => item.status === 'draft').length,
    guides: state.studyGuides.filter((item) => item.status === 'draft').length,
  }
  const draftCount = Object.values(draftSummary).reduce(
    (total, count) => total + count,
    0,
  )

  return (
    <main className="admin-layout">
      <section className="admin-section publish-panel">
        <div className="section-title">
          <Check size={20} />
          <h2>Review & Publish</h2>
        </div>
        <p className="admin-note">
          Publish after spot-checking the imported notes, flashcards, quizzes,
          tags, and study guides.
        </p>
        <div className="study-stats">
          <span>{draftSummary.flashcards} flashcards</span>
          <span>{draftSummary.quizzes} quizzes</span>
          <span>{draftSummary.questions} questions</span>
          <span>{draftSummary.tags} tags</span>
          <span>{draftSummary.guides} study guides</span>
        </div>
        <div className="draft-actions draft-actions-large">
          <span>{draftCount} draft assets waiting</span>
          <button
            className="primary-button"
            disabled={!draftCount}
            onClick={() => setAssetStatus('published')}
            type="button"
          >
            <Check size={18} /> Publish all draft assets
          </button>
          <button
            disabled={!draftCount}
            onClick={() => setAssetStatus('archived')}
            type="button"
          >
            Archive all drafts
          </button>
        </div>
      </section>

      <section className="admin-section">
        <div className="section-title">
          <Users size={20} />
          <h2>People</h2>
        </div>
        <div className="table-list">
          {state.users.map((user) => (
            <div className="person-row" key={user.id}>
              <div>
                <strong>{user.name}</strong>
                <span>{user.email}</span>
              </div>
              <select
                value={user.role}
                onChange={(e) =>
                  updateUser(user.id, {
                    role: e.target.value as PortalUser['role'],
                  })
                }
              >
                <option value="student">student</option>
                <option value="admin">admin</option>
              </select>
              <select
                value={user.status}
                onChange={(e) =>
                  updateUser(user.id, {
                    status: e.target.value as PortalUser['status'],
                  })
                }
              >
                <option value="approved">approved</option>
                <option value="pending">pending</option>
                <option value="disabled">disabled</option>
              </select>
              <button
                className="icon-button"
                onClick={() =>
                  setState({
                    ...state,
                    users: state.users.filter((item) => item.id !== user.id),
                  })
                }
                title="Remove user"
                type="button"
              >
                <UserMinus size={17} />
              </button>
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
                          updateUser(user.id, { courseIds })
                        }}
                        type="checkbox"
                      />
                      {course.code}
                    </label>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="admin-section">
        <div className="section-title">
          <Sparkles size={20} />
          <h2>AI Drafts</h2>
        </div>
        <div className="generation-panel">
          <select
            value={activeGenerationCourse?.id ?? ''}
            onChange={(event) => {
              const nextCourse = state.courses.find(
                (course) => course.id === event.target.value,
              )
              setGenerationTarget({
                courseId: event.target.value,
                lectureSlug: nextCourse?.lectures[0]?.slug ?? '',
              })
            }}
          >
            {state.courses.map((course) => (
              <option key={course.id} value={course.id}>
                {course.code}
              </option>
            ))}
          </select>
          <select
            value={generationTarget.lectureSlug}
            onChange={(event) =>
              setGenerationTarget({
                ...generationTarget,
                lectureSlug: event.target.value,
              })
            }
          >
            {activeGenerationCourse?.lectures.map((lecture) => (
              <option key={lecture.slug} value={lecture.slug}>
                {lecture.date} · {lecture.title}
              </option>
            ))}
          </select>
          <button className="primary-button" onClick={generateDraftPackage} type="button">
            <Sparkles size={17} /> Generate draft package
          </button>
        </div>
        <div className="draft-actions">
          <span>{draftCount} draft assets waiting</span>
          <button disabled={!draftCount} onClick={() => setAssetStatus('published')} type="button">
            <Check size={17} /> Publish drafts
          </button>
          <button disabled={!draftCount} onClick={() => setAssetStatus('archived')} type="button">
            Archive drafts
          </button>
        </div>
        <DraftReview state={state} />
      </section>

      <section className="admin-section">
        <div className="section-title">
          <Library size={20} />
          <h2>Courses</h2>
        </div>
        <form className="course-form" onSubmit={addCourse}>
          <input
            onChange={(e) =>
              setCourseDraft({ ...courseDraft, code: e.target.value })
            }
            placeholder="CODE101"
            value={courseDraft.code}
          />
          <input
            onChange={(e) =>
              setCourseDraft({ ...courseDraft, title: e.target.value })
            }
            placeholder="Course title"
            value={courseDraft.title}
          />
          <input
            onChange={(e) =>
              setCourseDraft({ ...courseDraft, term: e.target.value })
            }
            placeholder="Term"
            value={courseDraft.term}
          />
          <button className="primary-button" type="submit">
            <Plus size={17} /> Add course
          </button>
        </form>

        <div className="course-admin-list">
          {state.courses.map((course) => {
            const draft = lectureDrafts[course.id] ?? blankLecture()
            return (
              <details key={course.id}>
                <summary>
                  <span>
                    <strong>{course.code}</strong> {course.title}
                  </span>
                  <span>{course.lectures.length} lectures</span>
                </summary>
                <div className="course-editor">
                  <label>
                    Published
                    <input
                      checked={course.active}
                      onChange={(e) =>
                        setState({
                          ...state,
                          courses: state.courses.map((item) =>
                            item.id === course.id
                              ? { ...item, active: e.target.checked }
                              : item,
                          ),
                        })
                      }
                      type="checkbox"
                    />
                  </label>
                  <div className="lecture-form">
                    <input
                      onChange={(e) =>
                        setLectureDrafts({
                          ...lectureDrafts,
                          [course.id]: { ...draft, date: e.target.value },
                        })
                      }
                      placeholder="YYYY-MM-DD"
                      value={draft.date}
                    />
                    <input
                      onChange={(e) =>
                        setLectureDrafts({
                          ...lectureDrafts,
                          [course.id]: { ...draft, title: e.target.value },
                        })
                      }
                      placeholder="Lecture title"
                      value={draft.title}
                    />
                    <textarea
                      onChange={(e) =>
                        setLectureDrafts({
                          ...lectureDrafts,
                          [course.id]: {
                            ...draft,
                            contentHtml: e.target.value,
                          },
                        })
                      }
                      placeholder="<h2>Topic</h2><p>Notes...</p>"
                      value={draft.contentHtml}
                    />
                    <button onClick={() => addLecture(course)} type="button">
                      <Check size={17} /> Add lecture
                    </button>
                  </div>
                </div>
              </details>
            )
          })}
        </div>
      </section>
    </main>
  )
}

function DraftReview({ state }: { state: PortalState }) {
  const draftFlashcards = state.flashcards.filter((item) => item.status === 'draft')
  const draftQuizzes = state.quizzes.filter((item) => item.status === 'draft')
  const draftTags = state.lectureTags.filter((item) => item.status === 'draft')
  const draftGuides = state.studyGuides.filter((item) => item.status === 'draft')
  const latestJobs = state.aiGenerationJobs.slice(0, 4)

  return (
    <div className="draft-review">
      <div className="draft-column">
        <h3>
          <Brain size={17} /> Flashcards
        </h3>
        {draftFlashcards.slice(0, 4).map((card) => (
          <article className="draft-card" key={card.id}>
            <strong>{card.front}</strong>
            <p>{card.back}</p>
          </article>
        ))}
      </div>
      <div className="draft-column">
        <h3>
          <ClipboardCheck size={17} /> Quizzes
        </h3>
        {draftQuizzes.slice(0, 3).map((quiz) => (
          <article className="draft-card" key={quiz.id}>
            <strong>{quiz.title}</strong>
            <p>
              {
                state.quizQuestions.filter(
                  (question) => question.quizId === quiz.id,
                ).length
              }{' '}
              draft questions
            </p>
          </article>
        ))}
      </div>
      <div className="draft-column">
        <h3>
          <Tags size={17} /> Tags & guides
        </h3>
        <div className="tag-list">
          {draftTags.slice(0, 10).map((tag) => (
            <span key={tag.id}>{tag.tag}</span>
          ))}
        </div>
        {draftGuides.slice(0, 2).map((guide) => (
          <article className="draft-card" key={guide.id}>
            <strong>{guide.title}</strong>
            <p>{guide.content.split('\n').slice(0, 2).join(' ')}</p>
          </article>
        ))}
      </div>
      <div className="draft-column">
        <h3>
          <Sparkles size={17} /> Jobs
        </h3>
        {latestJobs.map((job) => (
          <article className="draft-card" key={job.id}>
            <strong>{job.status}</strong>
            <p>{job.promptVersion}</p>
          </article>
        ))}
      </div>
    </div>
  )
}

function blankLecture(): LectureSeed {
  return {
    slug: '',
    date: '',
    title: '',
    subtitle: '',
    contentHtml: '',
  }
}

export default App
