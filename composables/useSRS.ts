import {
  ALL_KANA,
  STAGES,
  buildStages,
  LEGACY_PART_ORDER,
  type KanaEntry,
  type KanaScript,
  type Stage,
  type StageMode,
} from '~/data/kana'

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
  // 最近連續答對次數 (lapse / 答錯歸零) —— 給重點池用,
  // 避免終身準確率因為過去太爛而被永久鎖在 bottom 6
  correctStreak?: number
  // 最近 N 次答題結果 (true = 對, false = 錯),用來算「最近準確率」
  // 終身準確率有歷史包袱,recent window 才能反映「現在會不會」
  recentResults?: boolean[]
}

export interface Settings {
  scripts: KanaScript[]
  newPerDay: number
  sessionMinutes: number
  autoPlaySound: boolean
  // 兩種假名都選時的學習順序:separate = 先平假名再片假名;mixed = 同一行一起背
  stageMode: StageMode
  sfx: boolean
  bgm: boolean
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
// 終身準確率不夠的卡片不該被拉到長間隔,避免「靠運氣連對 → 被藏在 90 天後」
const ACC_CAP_MIN_REPS = 10                  // 樣本太少不套用
const LOW_ACC_THRESHOLD = 0.6                // <60% 視為嚴重不熟
const MEDIUM_ACC_THRESHOLD = 0.7             // <70% 視為不夠穩
const LOW_ACC_CAP_MIN = 2 * 24 * 60          // 2 天上限
const MEDIUM_ACC_CAP_MIN = 7 * 24 * 60       // 7 天上限
const SESSION_LAPSE_DEFER_MIN = 24 * 60

const STORAGE_KEY = 'kana-typing-v1'

export interface PersistShape {
  cards: Record<string, CardState>
  settings: Settings
  daily: Record<string, DailyStats>
  // 舊欄位:已通過的關卡數(照「平假名 10 關 → 片假名 10 關」計算),保留給遷移
  passedStages: number
  // 已通過的「腳本:行序」。用穩定鍵值記錄,切換學習順序後進度不會歸零
  passedParts: string[]
}

const DEFAULTS: Settings = {
  scripts: ['hiragana', 'katakana'],
  newPerDay: 6,
  sessionMinutes: 15,
  autoPlaySound: true,
  stageMode: 'separate',
  sfx: true,
  bgm: true,
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

const RECENT_RESULTS_WINDOW = 15
const RECENT_MIN_SAMPLES = 8

function sanitizeCard(c: CardState, now: number): CardState {
  const maxDue = now + MAX_INTERVAL_MIN * 60 * 1000
  if (c.intervalMin > MAX_INTERVAL_MIN || !isFinite(c.intervalMin)) {
    c.intervalMin = MAX_INTERVAL_MIN
  }
  if (c.dueAt > maxDue || !isFinite(c.dueAt)) {
    c.dueAt = maxDue
  }
  if (typeof c.correctStreak !== 'number' || !isFinite(c.correctStreak)) {
    c.correctStreak = 0
  }
  if (!Array.isArray(c.recentResults)) {
    c.recentResults = []
  } else if (c.recentResults.length > RECENT_RESULTS_WINDOW) {
    c.recentResults = c.recentResults.slice(-RECENT_RESULTS_WINDOW)
  }
  return c
}

// 有足夠最近樣本就用最近準確率,否則用終身。recent window 反映「現在會不會」
function effectiveAccuracy(c: CardState): number {
  const recent = c.recentResults ?? []
  if (recent.length >= RECENT_MIN_SAMPLES) {
    return recent.filter((r) => r).length / recent.length
  }
  return c.reps > 0 ? c.correctTotal / c.reps : 1
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
    correctStreak: 0,
    recentResults: [],
  }
}

function loadPersist(): PersistShape {
  if (typeof window === 'undefined') {
    return { cards: {}, settings: { ...DEFAULTS }, daily: {}, passedStages: 0, passedParts: [] }
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { cards: {}, settings: { ...DEFAULTS }, daily: {}, passedStages: 0 }
    const parsed = JSON.parse(raw) as Partial<PersistShape>
    const cards = parsed.cards ?? {}
    const now = Date.now()
    for (const c of Object.values(cards)) sanitizeCard(c, now)
    return {
      cards,
      settings: { ...DEFAULTS, ...(parsed.settings ?? {}) },
      daily: parsed.daily ?? {},
      passedStages: 0,
      passedParts: normalizePassedParts(parsed.passedParts, parsed.passedStages, cards),
    }
  } catch {
    return { cards: {}, settings: { ...DEFAULTS }, daily: {}, passedStages: 0, passedParts: [] }
  }
}

// 更舊的資料連 passedStages 都沒有 → 依「已學過的字落在哪一關」推算,
// 讓既有使用者不會被鎖回第一關。
function inferPassedStages(cards: Record<string, CardState>): number {
  let highest = -1
  for (const st of STAGES) {
    if (st.cardIds.some((id) => cards[id]?.introduced)) highest = st.index
  }
  // 最高有學過的關算「已解鎖」,所以通過數 = 該關 index
  return Math.max(0, highest)
}

// 通過紀錄一律換算成 parts;舊的數字欄位照 LEGACY_PART_ORDER 展開
function normalizePassedParts(
  rawParts: unknown,
  rawCount: unknown,
  cards: Record<string, CardState>,
): string[] {
  if (Array.isArray(rawParts)) {
    const valid = new Set(LEGACY_PART_ORDER)
    return [...new Set(rawParts.filter((x): x is string => typeof x === 'string' && valid.has(x)))]
  }
  const n = typeof rawCount === 'number' && isFinite(rawCount)
    ? Math.max(0, Math.min(LEGACY_PART_ORDER.length, Math.floor(rawCount)))
    : inferPassedStages(cards)
  return LEGACY_PART_ORDER.slice(0, n)
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
  const focusQueue = useState<string[]>('srs-focus-queue', () => [])
  const focusInitialSize = useState<number>('srs-focus-initial', () => 0)
  const focusCorrectCount = useState<number>('srs-focus-correct', () => 0)
  // 每張卡需累計幾次答對才出隊
  const focusCorrectMap = useState<Record<string, number>>('srs-focus-correct-map', () => ({}))

  // === 測驗(diagnostic) ===
  // 一輪過,每張只問一次,結束顯示對 / 錯清單
  const testQueue = useState<string[]>('srs-test-queue', () => [])
  const testTotal = useState<number>('srs-test-total', () => 0)
  const testCorrectIds = useState<string[]>('srs-test-correct-ids', () => [])
  const testWrongIds = useState<string[]>('srs-test-wrong-ids', () => [])

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

  // === 關卡 ===
  // 關卡清單跟著「要練哪些假名」與「學習順序」走
  const stages = computed(() =>
    buildStages(persist.value.settings.scripts, persist.value.settings.stageMode ?? 'separate'),
  )

  const passedParts = computed(() => new Set(persist.value.passedParts ?? []))

  const stageInfo = computed(() => {
    const list = stages.value
    const done = passedParts.value
    // 只算「從第一關開始連續通過」的數量,切換順序後也不會跳關
    let passed = 0
    for (const st of list) {
      if (st.parts.every((k) => done.has(k))) passed += 1
      else break
    }
    const total = list.length
    const unlocked = Math.min(total, passed + 1)
    const allPassed = passed >= total
    const current: Stage | null = allPassed ? null : list[unlocked - 1] ?? null
    return { total, passed, unlocked, allPassed, current }
  })

  const unlockedCardIds = computed(() => {
    const set = new Set<string>()
    const list = stages.value
    for (let i = 0; i < stageInfo.value.unlocked; i++) {
      for (const id of list[i]?.cardIds ?? []) set.add(id)
    }
    // 已經學過的字永遠保持解鎖:換學習順序時不會把讀過的字收回去
    for (const [id, c] of Object.entries(persist.value.cards)) {
      if (c?.introduced) set.add(id)
    }
    return set
  })

  function isUnlocked(id: string): boolean {
    return unlockedCardIds.value.has(id)
  }

  // 只有「已解鎖 + 字母設定有勾」的字才進池子
  function activePool(): KanaEntry[] {
    const scripts = new Set(persist.value.settings.scripts)
    const unlocked = unlockedCardIds.value
    return ALL_KANA.filter((k) => scripts.has(k.script) && unlocked.has(k.id))
  }

  // 最近一次測驗的關卡判定結果,給結果頁顯示
  const lastStageResult = useState<
    { passed: boolean; stage: Stage; next: Stage | null; wrongInStage: string[] } | null
  >('srs-stage-result', () => null)

  // 測驗跑完整輪後呼叫:目前關卡的字全部一次答對 → 解鎖下一關
  function evaluateStageUnlock(correctIds: string[]): void {
    const stage = stageInfo.value.current
    if (!stage) {
      lastStageResult.value = null
      return
    }
    const correct = new Set(correctIds)
    const wrongInStage = stage.cardIds.filter((id) => !correct.has(id))
    const passed = wrongInStage.length === 0
    const list = stages.value
    const next = passed && stage.index + 1 < list.length ? list[stage.index + 1] : null
    lastStageResult.value = { passed, stage, next, wrongInStage }
    if (passed) {
      const done = new Set(persist.value.passedParts ?? [])
      for (const k of stage.parts) done.add(k)
      persist.value.passedParts = [...done]
      save()
    }
  }

  // 第一次看著讀法打的字:只標成「已學」,不算對錯
  function introduceCard(id: string) {
    const c = ensureCard(persist.value.cards, id)
    if (c.introduced) return
    const d = ensureDaily(persist.value.daily, today())
    c.introduced = true
    c.dueAt = Date.now()
    d.newIntroduced += 1
    save()
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
    if (newIntroducedToday() >= persist.value.settings.newPerDay) return false
    // 只在有「真正慢性問題」的卡片堆積時暫停 —— 練了夠多次但準確率還是低。
    // 剛介紹、答對但還不熟的卡片 (高 acc 低 reps) 不算進去,不該卡新字。
    const cap = persist.value.settings.newPerDay
    let chronic = 0
    for (const k of activePool()) {
      const c = persist.value.cards[k.id]
      if (!c?.introduced) continue
      if (c.reps >= 10 && c.correctTotal / c.reps < 0.7) {
        chronic++
        if (chronic >= cap) return false
      }
    }
    return true
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
    // 把這次結果推進 recent window
    const result = correct && firstTry
    const recent = [...(c.recentResults ?? []), result]
    c.recentResults = recent.length > RECENT_RESULTS_WINDOW
      ? recent.slice(-RECENT_RESULTS_WINDOW)
      : recent
    if (correct && firstTry) {
      c.correctTotal += 1
      d.correct += 1
      c.correctStreak = (c.correctStreak ?? 0) + 1
      if (c.intervalMin < 1) {
        c.intervalMin = 1
      } else if (c.intervalMin < 10) {
        c.intervalMin = 10
      } else if (c.intervalMin < 60 * 24) {
        c.intervalMin = 60 * 24
      } else {
        // 終身準確率不夠時降低間隔上限,避免有問題的卡被藏在 90 天後
        let accuracyCap = MAX_INTERVAL_MIN
        if (c.reps >= ACC_CAP_MIN_REPS) {
          const lifetimeAcc = c.correctTotal / c.reps
          if (lifetimeAcc < LOW_ACC_THRESHOLD) accuracyCap = LOW_ACC_CAP_MIN
          else if (lifetimeAcc < MEDIUM_ACC_THRESHOLD) accuracyCap = MEDIUM_ACC_CAP_MIN
        }
        c.intervalMin = fuzzInterval(
          Math.min(Math.round(c.intervalMin * c.ease), accuracyCap),
        )
      }
      c.ease = Math.min(3.0, c.ease + 0.05)
    } else {
      c.wrongTotal += 1
      d.wrong += 1
      c.lapses += 1
      c.correctStreak = 0
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
    persist.value = { cards: {}, settings: { ...DEFAULTS }, daily: {}, passedStages: 0, passedParts: [] }
    lastStageResult.value = null
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
      passedStages: 0,
      passedParts: normalizePassedParts(d.passedParts, d.passedStages, cards),
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

  // streak 仍當作「快速恢復」的逃生門 —— 不夠最近樣本時 (window < 8) 靠它判斷
  const FOCUS_STREAK_GRADUATE = 3

  // === 重點練習 ===
  // 取「最近準確率」最低的 N 張 + 全部 ≥90% 的卡當這場的固定池。
  // 改用 effectiveAcc (最近 15 次裡的對的比例,不夠就用終身)
  // 避免歷史包袱重的卡 (如 ヲ) 永遠被當「最差」,實際上已經會了。
  function buildFocusPool(bottomN = 6, topMinReps = 5): string[] {
    const intro = activePool()
      .map((k) => {
        const c = persist.value.cards[k.id]
        if (!c?.introduced) return null
        const eff = effectiveAccuracy(c)
        return { id: k.id, acc: eff, reps: c.reps, streak: c.correctStreak ?? 0 }
      })
      .filter(
        (x): x is { id: string; acc: number; reps: number; streak: number } => x !== null,
      )

    // 還沒學過的字(目前關卡的新字)也進池,第一次出現會顯示讀法
    const fresh = activePool()
      .filter((k) => !persist.value.cards[k.id]?.introduced)
      .map((k) => k.id)
      .slice(0, Math.max(0, persist.value.settings.newPerDay))

    if (intro.length === 0 && fresh.length === 0) return []
    const stillStuck = intro.filter(
      (x) => x.streak < FOCUS_STREAK_GRADUATE && x.acc < 0.9,
    )
    const sortedByAccAsc = [...stillStuck].sort(
      (a, b) => a.acc - b.acc || b.reps - a.reps,
    )
    const bottom = sortedByAccAsc.slice(0, bottomN).map((x) => x.id)
    const bottomSet = new Set(bottom)
    const top = intro
      .filter((x) => x.acc >= 0.9 && x.reps >= topMinReps && !bottomSet.has(x.id))
      .map((x) => x.id)

    // 目前關卡(還沒通過的那關)的字永遠在池子裡,直到測驗過關為止
    const current = stageInfo.value.current
    const currentIds = current
      ? current.cardIds.filter((id) => persist.value.cards[id]?.introduced)
      : []

    const seen = new Set<string>()
    const pool: string[] = []
    for (const id of [...fresh, ...currentIds, ...bottom, ...top]) {
      if (!seen.has(id)) {
        seen.add(id)
        pool.push(id)
      }
    }
    // 保險:全部條件都不符合(例如每張都剛好連對 3 次但還沒練滿 5 次)→ 複習全部已學的字
    if (pool.length === 0) pool.push(...intro.map((x) => x.id))
    // Fisher-Yates 洗牌,讓出題順序隨機
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[pool[i], pool[j]] = [pool[j], pool[i]]
    }
    return pool
  }

  const FOCUS_NEEDED_CORRECT = 3

  function startFocusSession(): number {
    const pool = buildFocusPool()
    focusQueue.value = pool
    focusInitialSize.value = pool.length
    focusCorrectCount.value = 0
    focusCorrectMap.value = {}
    return pool.length
  }

  function pickFocusCard(): KanaEntry | null {
    const id = focusQueue.value[0]
    if (!id) return null
    return ALL_KANA.find((k) => k.id === id) ?? null
  }

  // 答對 → 累計次數,達 FOCUS_NEEDED_CORRECT 才出隊;答錯 → 送回隊尾(進度不歸零)
  function focusAnswer(id: string, correct: boolean) {
    if (focusQueue.value[0] !== id) return
    if (correct) {
      const next = (focusCorrectMap.value[id] ?? 0) + 1
      focusCorrectMap.value = { ...focusCorrectMap.value, [id]: next }
      if (next >= FOCUS_NEEDED_CORRECT) {
        focusQueue.value = focusQueue.value.slice(1)
        focusCorrectCount.value += 1
      } else {
        focusQueue.value = [...focusQueue.value.slice(1), id]
      }
    } else {
      focusQueue.value = [...focusQueue.value.slice(1), id]
    }
  }

  function focusProgressFor(id: string): { done: number; needed: number } {
    return { done: focusCorrectMap.value[id] ?? 0, needed: FOCUS_NEEDED_CORRECT }
  }

  function endFocusSession() {
    focusQueue.value = []
    focusInitialSize.value = 0
    focusCorrectCount.value = 0
    focusCorrectMap.value = {}
  }

  // === 測驗 ===
  // 測驗範圍 = 所有已解鎖的字(含還沒學過的),這樣才能靠測驗通關
  function startTestSession(): number {
    lastStageResult.value = null
    const ids = activePool().map((k) => k.id)
    // 洗牌出題
    const queue = [...ids]
    for (let i = queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[queue[i], queue[j]] = [queue[j], queue[i]]
    }
    testQueue.value = queue
    testTotal.value = queue.length
    testCorrectIds.value = []
    testWrongIds.value = []
    return queue.length
  }

  function pickTestCard(): KanaEntry | null {
    const id = testQueue.value[0]
    if (!id) return null
    return ALL_KANA.find((k) => k.id === id) ?? null
  }

  function testAnswer(id: string, correct: boolean) {
    if (testQueue.value[0] !== id) return
    testQueue.value = testQueue.value.slice(1)
    if (correct) {
      testCorrectIds.value = [...testCorrectIds.value, id]
    } else {
      testWrongIds.value = [...testWrongIds.value, id]
    }
  }

  function endTestSession() {
    testQueue.value = []
    testTotal.value = 0
    testCorrectIds.value = []
    testWrongIds.value = []
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
    focusQueue,
    focusInitialSize,
    focusCorrectCount,
    startFocusSession,
    pickFocusCard,
    focusAnswer,
    endFocusSession,
    focusProgressFor,
    testQueue,
    testTotal,
    testCorrectIds,
    testWrongIds,
    startTestSession,
    pickTestCard,
    testAnswer,
    endTestSession,
    effectiveAccuracy,
    stages,
    stageInfo,
    isUnlocked,
    lastStageResult,
    evaluateStageUnlock,
    introduceCard,
  }
}
