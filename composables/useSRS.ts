import { ALL_KANA, type KanaEntry, type KanaScript } from '~/data/kana'

export interface CardState {
  id: string
  ease: number
  intervalMin: number
  dueAt: number
  reps: number
  lapses: number
  correctTotal: number
  wrongTotal: number
  introduced: boolean
}

export interface Settings {
  scripts: KanaScript[]
  newPerDay: number
  sessionMinutes: number
  autoPlaySound: boolean
  examDate: string
  examLabel: string
}

export interface DailyStats {
  date: string
  correct: number
  wrong: number
  secondsStudied: number
  newIntroduced: number
}

export interface QuizCardState {
  correctCount: number
  wrongCount: number
  status: 'pending' | 'passed' | 'failed'
}

export interface QuizState {
  active: boolean
  finished: boolean
  cards: Record<string, QuizCardState>
  order: string[]
  passedCount: number
  failedCount: number
  noNewToday: boolean
}

const QUIZ_NEEDED_CORRECT = 3
const QUIZ_ALLOWED_WRONG = 2
const QUIZ_LOCK_NEW_THRESHOLD = 0.3
const RELEARN_PER_SESSION = 3
const MAX_INTERVAL_MIN = 90 * 24 * 60
const SESSION_LAPSE_DEFER_MIN = 24 * 60

const STORAGE_KEY = 'kana-typing-v1'

interface PersistShape {
  cards: Record<string, CardState>
  settings: Settings
  daily: Record<string, DailyStats>
}

const DEFAULTS: Settings = {
  scripts: ['hiragana', 'katakana'],
  newPerDay: 6,
  sessionMinutes: 15,
  autoPlaySound: true,
  examDate: '2026-07-05',
  examLabel: 'JLPT N4',
}

function today(): string {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function fuzzInterval(min: number): number {
  const capped = Math.min(min, MAX_INTERVAL_MIN)
  if (capped < 60 * 24) return capped
  const factor = 1 + (Math.random() * 0.1 - 0.05)
  return Math.min(MAX_INTERVAL_MIN, Math.max(60 * 24, Math.round(capped * factor)))
}

function sanitizeCard(c: CardState, now: number): CardState {
  const maxDue = now + MAX_INTERVAL_MIN * 60 * 1000
  if (c.intervalMin > MAX_INTERVAL_MIN || !isFinite(c.intervalMin)) {
    c.intervalMin = MAX_INTERVAL_MIN
  }
  if (c.dueAt > maxDue || !isFinite(c.dueAt)) {
    c.dueAt = maxDue
  }
  return c
}

function freshCard(id: string): CardState {
  return {
    id,
    ease: 2.5,
    intervalMin: 0,
    dueAt: 0,
    reps: 0,
    lapses: 0,
    correctTotal: 0,
    wrongTotal: 0,
    introduced: false,
  }
}

function loadPersist(): PersistShape {
  if (typeof window === 'undefined') {
    return { cards: {}, settings: { ...DEFAULTS }, daily: {} }
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { cards: {}, settings: { ...DEFAULTS }, daily: {} }
    const parsed = JSON.parse(raw) as Partial<PersistShape>
    const cards = parsed.cards ?? {}
    const now = Date.now()
    for (const c of Object.values(cards)) sanitizeCard(c, now)
    return {
      cards,
      settings: { ...DEFAULTS, ...(parsed.settings ?? {}) },
      daily: parsed.daily ?? {},
    }
  } catch {
    return { cards: {}, settings: { ...DEFAULTS }, daily: {} }
  }
}

function ensureCard(cards: Record<string, CardState>, id: string): CardState {
  if (!cards[id]) cards[id] = freshCard(id)
  return cards[id]
}

function ensureDaily(daily: Record<string, DailyStats>, date: string): DailyStats {
  if (!daily[date]) {
    daily[date] = {
      date,
      correct: 0,
      wrong: 0,
      secondsStudied: 0,
      newIntroduced: 0,
    }
  }
  return daily[date]
}

const RECENT_WINDOW = 3

function emptyQuiz(): QuizState {
  return {
    active: false,
    finished: false,
    cards: {},
    order: [],
    passedCount: 0,
    failedCount: 0,
    noNewToday: false,
  }
}

export const useSRS = () => {
  const persist = useState<PersistShape>('srs-persist', () => loadPersist())
  const recent = useState<string[]>('srs-recent', () => [])
  const quiz = useState<QuizState>('srs-quiz', () => emptyQuiz())
  const sessionLapses = useState<Record<string, number>>('srs-session-lapses', () => ({}))

  function save() {
    if (typeof window === 'undefined') return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(persist.value))
    } catch {
      /* quota exceeded — ignore */
    }
  }

  const settings = computed(() => persist.value.settings)

  function updateSettings(patch: Partial<Settings>) {
    persist.value.settings = { ...persist.value.settings, ...patch }
    save()
  }

  function activePool(): KanaEntry[] {
    const scripts = new Set(persist.value.settings.scripts)
    return ALL_KANA.filter((k) => scripts.has(k.script))
  }

  function dueNow(): KanaEntry[] {
    const now = Date.now()
    return activePool().filter((k) => {
      const c = persist.value.cards[k.id]
      return c && c.introduced && c.dueAt <= now
    })
  }

  function newIntroducedToday(): number {
    return persist.value.daily[today()]?.newIntroduced ?? 0
  }

  function canIntroduceNew(): boolean {
    if (quiz.value.noNewToday) return false
    return newIntroducedToday() < persist.value.settings.newPerDay
  }

  function startQuiz(): KanaEntry[] {
    const intro = activePool().filter(
      (k) => persist.value.cards[k.id]?.introduced,
    )
    if (intro.length === 0) {
      quiz.value = emptyQuiz()
      return []
    }
    const shuffled = [...intro].sort(() => Math.random() - 0.5)
    const cards: Record<string, QuizCardState> = {}
    for (const k of shuffled) {
      cards[k.id] = { correctCount: 0, wrongCount: 0, status: 'pending' }
    }
    quiz.value = {
      active: true,
      finished: false,
      cards,
      order: shuffled.map((k) => k.id),
      passedCount: 0,
      failedCount: 0,
      noNewToday: false,
    }
    return shuffled
  }

  function quizPickNext(): KanaEntry | null {
    if (!quiz.value.active || quiz.value.finished) return null
    const pending = quiz.value.order.filter(
      (id) => quiz.value.cards[id]?.status === 'pending',
    )
    if (pending.length === 0) return null
    const minCorrect = Math.min(
      ...pending.map((id) => quiz.value.cards[id]!.correctCount),
    )
    const tier = pending.filter(
      (id) => quiz.value.cards[id]!.correctCount === minCorrect,
    )
    const id = tier[Math.floor(Math.random() * tier.length)]
    return ALL_KANA.find((k) => k.id === id) ?? null
  }

  function markQuizFailed(id: string) {
    const c = quiz.value.cards[id]
    if (!c || c.status !== 'pending') return
    c.status = 'failed'
    quiz.value.failedCount += 1
    const card = ensureCard(persist.value.cards, id)
    card.lapses += 1
    card.intervalMin = 1
    card.ease = Math.max(1.3, card.ease - 0.2)
    if (quiz.value.failedCount <= RELEARN_PER_SESSION) {
      card.dueAt = Date.now() + 60 * 1000
    } else {
      card.dueAt = Date.now() + 24 * 60 * 60 * 1000
    }
  }

  function checkQuizFinished() {
    const stillPending = quiz.value.order.some(
      (id) => quiz.value.cards[id]?.status === 'pending',
    )
    if (!stillPending) {
      quiz.value.finished = true
      const total = quiz.value.passedCount + quiz.value.failedCount
      if (total > 0 && quiz.value.failedCount / total > QUIZ_LOCK_NEW_THRESHOLD) {
        quiz.value.noNewToday = true
      }
    }
  }

  function quizAnswer(id: string, correct: boolean): 'retry' | 'advance' {
    const c = quiz.value.cards[id]
    if (!c || c.status !== 'pending') return 'advance'
    if (correct) {
      c.correctCount += 1
      if (c.correctCount >= QUIZ_NEEDED_CORRECT) {
        c.status = 'passed'
        quiz.value.passedCount += 1
      }
    } else {
      c.wrongCount += 1
      if (c.wrongCount < QUIZ_ALLOWED_WRONG) {
        save()
        return 'retry'
      }
      markQuizFailed(id)
    }
    checkQuizFinished()
    save()
    return 'advance'
  }

  function quizSkip(id: string) {
    markQuizFailed(id)
    checkQuizFinished()
    save()
  }

  function endQuiz() {
    quiz.value = { ...quiz.value, active: false }
  }

  function failedQuizCards(): KanaEntry[] {
    return quiz.value.order
      .filter((id) => quiz.value.cards[id]?.status === 'failed')
      .map((id) => ALL_KANA.find((k) => k.id === id)!)
      .filter(Boolean)
  }

  function relearnTodayCards(): KanaEntry[] {
    return failedQuizCards().slice(0, RELEARN_PER_SESSION)
  }

  function relearnLaterCards(): KanaEntry[] {
    return failedQuizCards().slice(RELEARN_PER_SESSION)
  }

  function excludeRecent(list: KanaEntry[]): KanaEntry[] {
    if (list.length === 0) return list
    const recentSet = new Set(recent.value)
    const filtered = list.filter((k) => !recentSet.has(k.id))
    return filtered.length > 0 ? filtered : list
  }

  function trackShown(id: string) {
    const next = [...recent.value, id]
    while (next.length > RECENT_WINDOW) next.shift()
    recent.value = next
  }

  function pickNext(): KanaEntry | null {
    const now = Date.now()
    const pool = activePool()
    const intro = pool.filter((k) => persist.value.cards[k.id]?.introduced)
    const due = intro.filter((k) => persist.value.cards[k.id]!.dueAt <= now)
    const notYetDue = intro
      .filter((k) => persist.value.cards[k.id]!.dueAt > now)
      .sort((a, b) => persist.value.cards[a.id]!.dueAt - persist.value.cards[b.id]!.dueAt)
    const fresh = canIntroduceNew()
      ? pool.filter((k) => !persist.value.cards[k.id]?.introduced)
      : []

    let candidates: KanaEntry[] = []
    if (due.length > 0) {
      candidates = [...due]
      if (candidates.length < RECENT_WINDOW + 1) {
        if (fresh.length > 0) {
          candidates.push(fresh[Math.floor(Math.random() * fresh.length)])
        }
        const need = RECENT_WINDOW + 1 - candidates.length
        if (need > 0) candidates.push(...notYetDue.slice(0, need))
      }
    } else if (fresh.length > 0) {
      candidates = [...fresh]
    } else if (notYetDue.length > 0) {
      candidates = [...notYetDue]
    }

    if (candidates.length === 0) return null

    const filtered = excludeRecent(candidates)

    filtered.sort((a, b) => {
      const ca = persist.value.cards[a.id]
      const cb = persist.value.cards[b.id]
      const aDue = ca?.introduced ? ca.dueAt : Number.POSITIVE_INFINITY
      const bDue = cb?.introduced ? cb.dueAt : Number.POSITIVE_INFINITY
      if (aDue === bDue) return Math.random() - 0.5
      return aDue - bDue
    })

    const chosen = filtered[0]
    trackShown(chosen.id)
    return chosen
  }

  function review(id: string, correct: boolean, firstTry: boolean) {
    const c = ensureCard(persist.value.cards, id)
    const d = ensureDaily(persist.value.daily, today())
    const now = Date.now()

    if (!c.introduced) {
      c.introduced = true
      d.newIntroduced += 1
    }

    c.reps += 1
    if (correct && firstTry) {
      c.correctTotal += 1
      d.correct += 1
      if (c.intervalMin < 1) {
        c.intervalMin = 1
      } else if (c.intervalMin < 10) {
        c.intervalMin = 10
      } else if (c.intervalMin < 60 * 24) {
        c.intervalMin = 60 * 24
      } else {
        c.intervalMin = fuzzInterval(Math.round(c.intervalMin * c.ease))
      }
      c.ease = Math.min(3.0, c.ease + 0.05)
    } else {
      c.wrongTotal += 1
      d.wrong += 1
      c.lapses += 1
      c.ease = Math.max(1.3, c.ease - 0.2)
      const sessionCount = (sessionLapses.value[id] ?? 0) + 1
      sessionLapses.value = { ...sessionLapses.value, [id]: sessionCount }
      if (sessionCount >= 3) {
        c.intervalMin = SESSION_LAPSE_DEFER_MIN
      } else if (sessionCount === 2) {
        c.intervalMin = 10
      } else {
        c.intervalMin = 1
      }
    }
    c.dueAt = now + c.intervalMin * 60 * 1000
    save()
  }

  function resetSessionLapses() {
    sessionLapses.value = {}
  }

  function addStudySeconds(seconds: number) {
    if (seconds <= 0) return
    const d = ensureDaily(persist.value.daily, today())
    d.secondsStudied += seconds
    save()
  }

  const stats = computed(() => {
    const pool = activePool()
    let introduced = 0
    let learned = 0
    for (const k of pool) {
      const c = persist.value.cards[k.id]
      if (!c || !c.introduced) continue
      introduced += 1
      if (c.intervalMin >= 60 * 24) learned += 1
    }
    const todayKey = today()
    return {
      total: pool.length,
      introduced,
      learned,
      remaining: pool.length - introduced,
      today: persist.value.daily[todayKey] ?? {
        date: todayKey,
        correct: 0,
        wrong: 0,
        secondsStudied: 0,
        newIntroduced: 0,
      },
    }
  })

  function getCardState(id: string): CardState | undefined {
    return persist.value.cards[id]
  }

  const dailyHistory = computed<DailyStats[]>(() => {
    return Object.values(persist.value.daily).sort((a, b) =>
      b.date.localeCompare(a.date),
    )
  })

  function masteryLevel(id: string): 'new' | 'learning' | 'mastered' {
    const c = persist.value.cards[id]
    if (!c || !c.introduced) return 'new'
    if (c.intervalMin >= 60 * 24) return 'mastered'
    return 'learning'
  }

  function masteryScore(id: string): number {
    const c = persist.value.cards[id]
    if (!c || !c.introduced) return 0
    if (c.intervalMin < 60) return 1
    if (c.correctTotal < 3) return 2
    if (c.correctTotal < 5) return 3
    return 4
  }

  function resetAll() {
    persist.value = { cards: {}, settings: { ...DEFAULTS }, daily: {} }
    save()
  }

  function importPersist(data: unknown): boolean {
    if (!data || typeof data !== 'object') return false
    const d = data as Partial<PersistShape>
    if (!d.cards || typeof d.cards !== 'object') return false
    const now = Date.now()
    const cards = d.cards as Record<string, CardState>
    for (const c of Object.values(cards)) sanitizeCard(c, now)
    persist.value = {
      cards,
      settings: { ...DEFAULTS, ...(d.settings ?? {}) },
      daily: (d.daily as Record<string, DailyStats>) ?? {},
    }
    save()
    return true
  }

  function deleteDaily(date: string) {
    if (!persist.value.daily[date]) return
    delete persist.value.daily[date]
    save()
  }

  function renameDaily(oldDate: string, newDate: string): 'ok' | 'merged' | 'noop' {
    if (oldDate === newDate) return 'noop'
    const src = persist.value.daily[oldDate]
    if (!src) return 'noop'
    const target = persist.value.daily[newDate]
    if (target) {
      persist.value.daily[newDate] = {
        date: newDate,
        correct: target.correct + src.correct,
        wrong: target.wrong + src.wrong,
        secondsStudied: target.secondsStudied + src.secondsStudied,
        newIntroduced: target.newIntroduced + src.newIntroduced,
      }
      delete persist.value.daily[oldDate]
      save()
      return 'merged'
    }
    persist.value.daily[newDate] = { ...src, date: newDate }
    delete persist.value.daily[oldDate]
    save()
    return 'ok'
  }

  return {
    settings,
    stats,
    updateSettings,
    pickNext,
    review,
    addStudySeconds,
    resetAll,
    dueNow,
    canIntroduceNew,
    getCardState,
    dailyHistory,
    deleteDaily,
    renameDaily,
    masteryLevel,
    masteryScore,
    quiz,
    startQuiz,
    quizPickNext,
    quizAnswer,
    quizSkip,
    endQuiz,
    failedQuizCards,
    relearnTodayCards,
    relearnLaterCards,
    resetSessionLapses,
    importPersist,
  }
}
