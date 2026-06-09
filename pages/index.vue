<script setup lang="ts">
import type { KanaEntry } from '~/data/kana'
import { ALL_KANA } from '~/data/kana'

const { settings, stats, updateSettings, review, resetAll, getCardState, dailyHistory, deleteDaily, renameDaily, masteryScore, resetSessionLapses, importPersist, focusQueue, focusInitialSize, focusCorrectCount, startFocusSession, pickFocusCard, focusAnswer, endFocusSession } = useSRS()

const focusFinished = ref(false)
const focusActive = computed(() => focusQueue.value.length > 0 || focusFinished.value)
const focusProgress = computed(() =>
  focusInitialSize.value > 0
    ? Math.round((focusCorrectCount.value / focusInitialSize.value) * 100)
    : 0,
)

function next_focus_card_or_finish() {
  const card = pickFocusCard()
  if (!card) {
    focusFinished.value = true
    current.value = null
    flushCloud()
    return
  }
  current.value = card
  input.value = ''
  feedback.value = 'idle'
  firstTry.value = true
  wrongCount.value = 0
  showAnswer.value = false
  locked.value = false
  nextTick(() => inputEl.value?.focus())
}

function startFocus() {
  sessionStarted.value = true
  sessionCorrect.value = 0
  sessionWrong.value = 0
  resetSessionLapses()
  focusFinished.value = false
  const n = startFocusSession()
  if (n === 0) {
    alert('還沒有可練習的字 — 請先學一些再來重點練習')
    sessionStarted.value = false
    return
  }
  next_focus_card_or_finish()
}

function finishFocus() {
  endFocusSession()
  focusFinished.value = false
  sessionStarted.value = false
  current.value = null
  input.value = ''
}

const { user: cloudUser, status: syncStatus, signInWithGoogle, signOut: cloudSignOut, init: initCloudSync, flush: flushCloud } = useCloudSync()

const syncLabel = computed(() => {
  switch (syncStatus.value) {
    case 'syncing': return '同步中…'
    case 'synced': return '已同步'
    case 'error': return '同步錯誤'
    default: return ''
  }
})

async function onAccountClick() {
  if (cloudUser.value) {
    if (confirm(`目前登入:${cloudUser.value.email}\n要登出嗎?(本機進度會保留)`)) {
      await cloudSignOut()
    }
  } else {
    await signInWithGoogle()
  }
}

const importInputEl = ref<HTMLInputElement | null>(null)

function triggerImport() {
  importInputEl.value?.click()
}

async function onImportFile(e: Event) {
  const target = e.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return
  try {
    const text = await file.text()
    const data = JSON.parse(text)
    if (importPersist(data)) {
      alert('匯入成功!進度已更新。')
    } else {
      alert('匯入失敗:檔案格式不正確。')
    }
  } catch {
    alert('匯入失敗:無法解析 JSON。')
  } finally {
    target.value = ''
  }
}

const editingDate = ref<string | null>(null)
const editingValue = ref('')

function startEditDate(date: string) {
  editingDate.value = date
  editingValue.value = date
}

function cancelEditDate() {
  editingDate.value = null
  editingValue.value = ''
}

function saveEditDate(oldDate: string) {
  const newDate = editingValue.value
  if (!newDate || !/^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
    alert('請輸入有效日期')
    return
  }
  if (newDate !== oldDate && dailyHistory.value.some((d) => d.date === newDate)) {
    if (!confirm(`${newDate} 已有紀錄，確定要合併兩天的資料嗎？`)) return
  }
  renameDaily(oldDate, newDate)
  cancelEditDate()
}

function exportJson() {
  const raw = localStorage.getItem('kana-typing-v1') ?? '{}'
  let pretty: string
  try {
    pretty = JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    pretty = raw
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const blob = new Blob([pretty], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `kana-typing-${stamp}.json`
  a.click()
  URL.revokeObjectURL(url)
  navigator.clipboard?.writeText(pretty).catch(() => {})
}

function confirmDeleteDaily(date: string) {
  if (confirm(`確定要刪除 ${date} 的紀錄嗎？`)) {
    deleteDaily(date)
    if (editingDate.value === date) cancelEditDate()
  }
}

const current = ref<KanaEntry | null>(null)
const input = ref('')
const feedback = ref<'idle' | 'good' | 'bad' | 'revealed'>('idle')
const firstTry = ref(true)
const wrongCount = ref(0)
const showAnswer = ref(false)
const locked = ref(false)
const inputEl = ref<HTMLInputElement | null>(null)
const showSettings = ref(false)
const showHistory = ref(false)
const sessionStarted = ref(false)
const sessionCorrect = ref(0)
const sessionWrong = ref(0)

function checkAnswer(value: string) {
  if (!current.value || locked.value) return
  const cleaned = value.trim().toLowerCase()
  if (!cleaned) return
  const accepts = current.value.accepts
  const exact = accepts.includes(cleaned)
  const partialMatch = accepts.some((a) => a.startsWith(cleaned))

  // === 重點練習模式 ===
  if (focusActive.value && !focusFinished.value) {
    if (exact) {
      feedback.value = 'good'
      locked.value = true
      review(current.value.id, true, firstTry.value)
      if (firstTry.value) sessionCorrect.value += 1
      focusAnswer(current.value.id, true)
      if (settings.value.autoPlaySound) speak(current.value.char)
      setTimeout(() => next_focus_card_or_finish(), 500)
      return
    }
    const longestF = Math.max(...accepts.map((a) => a.length))
    if (!partialMatch || cleaned.length >= longestF) {
      feedback.value = 'bad'
      if (wrongCount.value === 0) {
        firstTry.value = false
        sessionWrong.value += 1
        review(current.value.id, false, false)
      }
      wrongCount.value += 1
      // 重點練習答錯不開「3 次顯示答案」邏輯,而是直接送回隊尾
      focusAnswer(current.value.id, false)
      locked.value = true
      setTimeout(() => next_focus_card_or_finish(), 600)
    }
    return
  }
}

const todayStudyMin = computed(() => Math.floor(stats.value.today.secondsStudied / 60))
const todayStudySec = computed(() => stats.value.today.secondsStudied % 60)
const todayAccuracy = computed(() => {
  const c = stats.value.today.correct
  const w = stats.value.today.wrong
  if (c + w === 0) return 0
  return Math.round((c / (c + w)) * 100)
})

const ttsSupported = ref(false)
const jaVoice = ref<SpeechSynthesisVoice | null>(null)

function loadVoice() {
  if (typeof window === 'undefined' || !window.speechSynthesis) return
  ttsSupported.value = true
  const voices = window.speechSynthesis.getVoices()
  const ja = voices.filter((v) => v.lang.startsWith('ja'))
  if (ja.length === 0) return
  // 優先本地語音 (Kyoko)，避免 Chrome 上不穩定的網路語音 (Google 日本語)
  jaVoice.value = ja.find((v) => v.localService) ?? ja[0]
}

function speak(text: string) {
  if (typeof window === 'undefined' || !window.speechSynthesis) {
    console.warn('[speak] speechSynthesis 不支援')
    return
  }
  const synth = window.speechSynthesis
  if (!jaVoice.value) loadVoice()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'ja-JP'
  u.rate = 0.8
  u.pitch = 1
  if (jaVoice.value) u.voice = jaVoice.value
  u.onerror = (e) => {
    if (e.error === 'canceled' || e.error === 'interrupted') return
    console.warn('[speak] 錯誤:', e.error, '— 文字:', text)
  }
  // 不呼叫 cancel() — Chrome 上 cancel() 緊接 speak() 會讓 utterance 卡死
  // 單一假名很短,重疊無妨
  synth.speak(u)
  if (synth.paused) synth.resume()
}

let speechKeepAlive: number | null = null

onMounted(() => {
  loadVoice()
  initCloudSync()
  // 請求持久化儲存,降低 iOS/瀏覽器在空間吃緊時清掉 localStorage 的機率
  navigator.storage?.persist?.().catch(() => {})
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    const synth = window.speechSynthesis
    window.speechSynthesis.onvoiceschanged = loadVoice
    // 清掉跨頁面殘留、卡死的 utterance (speechSynthesis 是瀏覽器全域單例)
    synth.cancel()
    // Chrome 已知 bug:引擎閒置會自己 pause,定期 resume 保活
    speechKeepAlive = window.setInterval(() => {
      if (synth.speaking && synth.paused) synth.resume()
    }, 5000)
  }
})

onBeforeUnmount(() => {
  if (speechKeepAlive != null) clearInterval(speechKeepAlive)
})

function toggleScript(s: 'hiragana' | 'katakana') {
  const set = new Set(settings.value.scripts)
  if (set.has(s)) set.delete(s)
  else set.add(s)
  if (set.size === 0) set.add(s)
  updateSettings({ scripts: [...set] as ('hiragana' | 'katakana')[] })
}

watch(input, (v) => {
  if (sessionStarted.value && current.value) checkAnswer(v)
})

function confirmReset() {
  if (confirm('確定要清除所有學習進度?')) {
    resetAll()
    finishFocus()
  }
}

interface GridCell {
  entry: KanaEntry | null
  score: number
}

function buildGrid(script: 'hiragana' | 'katakana'): GridCell[][] {
  const cols = ['a', 'i', 'u', 'e', 'o']
  const rows = ['a', 'k', 's', 't', 'n', 'h', 'm', 'y', 'r', 'w', 'n-special']
  const out: GridCell[][] = []
  for (const r of rows) {
    const rowOut: GridCell[] = []
    for (const c of cols) {
      const entry = ALL_KANA.find(
        (k) =>
          k.script === script &&
          k.row === r &&
          (k.romaji === c || k.romaji.endsWith(c) || (r === 'n-special' && c === 'a')),
      )
      if (entry) {
        rowOut.push({ entry, score: masteryScore(entry.id) })
      } else {
        rowOut.push({ entry: null, score: -1 })
      }
    }
    out.push(rowOut)
  }
  return out
}

const hiraganaGrid = computed(() => buildGrid('hiragana'))

type PoolGroup = 'bottom' | 'top' | 'mid' | 'unintroduced'
interface CardStat {
  pool: PoolGroup
  accuracy: number
  reps: number
  lapses: number
  introduced: boolean
}

const cardStatsMap = computed<Map<string, CardStat>>(() => {
  const map = new Map<string, CardStat>()
  const intro = ALL_KANA
    .map((k) => ({ entry: k, state: getCardState(k.id) }))
    .filter((x) => x.state?.introduced)
    .map(({ entry, state }) => ({
      entry,
      state: state!,
      accuracy: state!.reps > 0 ? state!.correctTotal / state!.reps : 0,
    }))

  const bottomIds = new Set(
    [...intro]
      .sort((a, b) => a.accuracy - b.accuracy || b.state.reps - a.state.reps)
      .slice(0, 6)
      .map((x) => x.entry.id),
  )

  for (const k of ALL_KANA) {
    const state = getCardState(k.id)
    if (!state?.introduced) {
      map.set(k.id, { pool: 'unintroduced', accuracy: 0, reps: 0, lapses: 0, introduced: false })
      continue
    }
    const accuracy = state.reps > 0 ? state.correctTotal / state.reps : 0
    const inBottom = bottomIds.has(k.id)
    const inTop = !inBottom && accuracy >= 0.9 && state.reps >= 5
    const pool: PoolGroup = inBottom ? 'bottom' : inTop ? 'top' : 'mid'
    map.set(k.id, { pool, accuracy, reps: state.reps, lapses: state.lapses, introduced: true })
  }
  return map
})

const katakanaGrid = computed(() => buildGrid('katakana'))

function fmtMin(seconds: number) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}
function dailyAccuracy(d: { correct: number; wrong: number }) {
  const t = d.correct + d.wrong
  if (t === 0) return 0
  return Math.round((d.correct / t) * 100)
}

interface DayCell {
  date: string
  seconds: number
  score: number
  isFuture: boolean
  isToday: boolean
}

function fmtLocalDate(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

function intensityScore(seconds: number): number {
  if (seconds <= 0) return 0
  if (seconds < 5 * 60) return 1
  if (seconds < 15 * 60) return 2
  if (seconds < 30 * 60) return 3
  return 4
}

const CAL_WEEKS = 13

const calendar = computed<{ weeks: DayCell[][]; monthLabels: { col: number; label: string }[] }>(() => {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayStr = fmtLocalDate(today)
  const todayDow = today.getDay()
  const currentWeekStart = new Date(today)
  currentWeekStart.setDate(today.getDate() - todayDow)
  const start = new Date(currentWeekStart)
  start.setDate(currentWeekStart.getDate() - (CAL_WEEKS - 1) * 7)

  const map = new Map(dailyHistory.value.map((d) => [d.date, d]))

  const weeks: DayCell[][] = []
  const cursor = new Date(start)
  const monthLabels: { col: number; label: string }[] = []
  let lastMonth = -1

  for (let w = 0; w < CAL_WEEKS; w++) {
    const days: DayCell[] = []
    for (let d = 0; d < 7; d++) {
      const dateStr = fmtLocalDate(cursor)
      const entry = map.get(dateStr)
      const seconds = entry?.secondsStudied ?? 0
      const isFuture = cursor.getTime() > today.getTime()
      const score = isFuture ? -1 : intensityScore(seconds)
      const isToday = dateStr === todayStr
      days.push({ date: dateStr, seconds, score, isFuture, isToday })
      if (d === 0 && cursor.getMonth() !== lastMonth) {
        lastMonth = cursor.getMonth()
        monthLabels.push({ col: w, label: `${cursor.getMonth() + 1}月` })
      }
      cursor.setDate(cursor.getDate() + 1)
    }
    weeks.push(days)
  }
  return { weeks, monthLabels }
})

function dayTooltip(cell: DayCell): string {
  if (cell.isFuture) return cell.date
  if (cell.seconds === 0) return `${cell.date} · 沒練習`
  return `${cell.date} · ${fmtMin(cell.seconds)}`
}

const examCountdown = computed(() => {
  const d = settings.value.examDate
  if (!d) return null
  const [y, m, dd] = d.split('-').map(Number)
  if (!y || !m || !dd) return null
  const target = new Date(y, m - 1, dd)
  target.setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const days = Math.round((target.getTime() - today.getTime()) / 86400000)
  return { days, label: settings.value.examLabel || '考試' }
})
</script>

<template>
  <div class="page">
    <header class="topbar">
      <div class="brand">五十音 · 打字練習</div>
      <div class="topbar-stats">
        <div class="chip">
          <span class="chip-label">今日</span>
          <span class="chip-val">{{ todayStudyMin }}m {{ todayStudySec }}s</span>
        </div>
        <div class="chip">
          <span class="chip-label">已學</span>
          <span class="chip-val">{{ stats.learned }} / {{ stats.total }}</span>
        </div>
        <div class="chip">
          <span class="chip-label">準確率</span>
          <span class="chip-val">{{ todayAccuracy }}%</span>
        </div>
        <button
          class="btn-icon"
          @click="showHistory = !showHistory; if (showHistory) showSettings = false"
          title="紀錄"
        >📊</button>
        <button
          class="btn-icon"
          @click="showSettings = !showSettings; if (showSettings) showHistory = false"
          title="設定"
        >⚙</button>
        <button
          class="btn-icon account-btn"
          :class="{ 'signed-in': cloudUser }"
          @click="onAccountClick"
          :title="cloudUser ? `${cloudUser.email} · ${syncLabel}` : '用 Google 登入以雲端同步'"
        >{{ cloudUser ? '☁︎' : '登入' }}</button>
      </div>
    </header>

    <main class="main">
      <section v-if="showHistory" class="panel history">
        <div class="history-header">
          <h3>學習紀錄</h3>
          <div class="history-header-actions">
            <button class="btn-ghost small" @click="exportJson">匯出 JSON</button>
            <button class="btn-ghost small" @click="triggerImport">匯入 JSON</button>
            <input
              ref="importInputEl"
              type="file"
              accept="application/json,.json"
              class="hidden-file-input"
              @change="onImportFile"
            />
          </div>
        </div>

        <div class="pool-legend">
          <span class="pool-tag pool-bottom">Bottom 6</span>
          <span class="pool-tag pool-mid">中段</span>
          <span class="pool-tag pool-top">≥90%</span>
          <span class="pool-tag pool-unintroduced">未學</span>
        </div>

        <div class="kana-grids-stack">
          <div class="kana-grid-block">
            <h4>平假名</h4>
            <div class="kana-grid">
              <div v-for="(row, ri) in hiraganaGrid" :key="'h' + ri" class="kana-grid-row">
                <div
                  v-for="(cell, ci) in row"
                  :key="ci"
                  class="kana-grid-cell"
                  :class="cell.entry
                    ? ['pool-' + (cardStatsMap.get(cell.entry.id)?.pool ?? 'unintroduced')]
                    : ['empty']"
                  :title="cell.entry ? cell.entry.char + ' ' + cell.entry.romaji : ''"
                >
                  <template v-if="cell.entry">
                    <div class="cell-main">
                      <span class="cell-char">{{ cell.entry.char }}</span>
                      <span class="cell-romaji">{{ cell.entry.romaji }}</span>
                    </div>
                    <div
                      v-if="cardStatsMap.get(cell.entry.id)?.introduced"
                      class="cell-stats"
                    >
                      <span class="cell-stat">練 {{ cardStatsMap.get(cell.entry.id)!.reps }}</span>
                      <span class="cell-stat">{{ Math.round(cardStatsMap.get(cell.entry.id)!.accuracy * 100) }}%</span>
                      <span class="cell-stat">失 {{ cardStatsMap.get(cell.entry.id)!.lapses }}</span>
                    </div>
                    <div v-else class="cell-stats cell-stats-unintroduced">未學</div>
                  </template>
                </div>
              </div>
            </div>
          </div>

          <div class="kana-grid-block">
            <h4>片假名</h4>
            <div class="kana-grid">
              <div v-for="(row, ri) in katakanaGrid" :key="'k' + ri" class="kana-grid-row">
                <div
                  v-for="(cell, ci) in row"
                  :key="ci"
                  class="kana-grid-cell"
                  :class="cell.entry
                    ? ['pool-' + (cardStatsMap.get(cell.entry.id)?.pool ?? 'unintroduced')]
                    : ['empty']"
                  :title="cell.entry ? cell.entry.char + ' ' + cell.entry.romaji : ''"
                >
                  <template v-if="cell.entry">
                    <div class="cell-main">
                      <span class="cell-char">{{ cell.entry.char }}</span>
                      <span class="cell-romaji">{{ cell.entry.romaji }}</span>
                    </div>
                    <div
                      v-if="cardStatsMap.get(cell.entry.id)?.introduced"
                      class="cell-stats"
                    >
                      <span class="cell-stat">練 {{ cardStatsMap.get(cell.entry.id)!.reps }}</span>
                      <span class="cell-stat">{{ Math.round(cardStatsMap.get(cell.entry.id)!.accuracy * 100) }}%</span>
                      <span class="cell-stat">失 {{ cardStatsMap.get(cell.entry.id)!.lapses }}</span>
                    </div>
                    <div v-else class="cell-stats cell-stats-unintroduced">未學</div>
                  </template>
                </div>
              </div>
            </div>
          </div>
        </div>

        <h4>每日活動</h4>
        <div class="cal-wrap">
          <div class="cal-months" :style="{ gridTemplateColumns: `repeat(${CAL_WEEKS}, 1fr)` }">
            <span
              v-for="m in calendar.monthLabels"
              :key="m.col"
              :style="{ gridColumn: m.col + 1 }"
            >{{ m.label }}</span>
          </div>
          <div class="cal-body">
            <div class="cal-dow">
              <span></span>
              <span>一</span>
              <span></span>
              <span>三</span>
              <span></span>
              <span>五</span>
              <span></span>
            </div>
            <div class="cal-grid">
              <div v-for="(week, wi) in calendar.weeks" :key="wi" class="cal-col">
                <div
                  v-for="(day, di) in week"
                  :key="di"
                  class="cal-cell"
                  :class="[
                    day.isFuture ? 'future' : 's' + day.score,
                    day.isToday ? 'today' : '',
                  ]"
                  :title="dayTooltip(day)"
                ></div>
              </div>
            </div>
          </div>
          <div class="cal-legend">
            <span class="legend-label">少</span>
            <span class="cal-cell s0"></span>
            <span class="cal-cell s1"></span>
            <span class="cal-cell s2"></span>
            <span class="cal-cell s3"></span>
            <span class="cal-cell s4"></span>
            <span class="legend-label">多</span>
          </div>
        </div>

        <h4>每日紀錄</h4>
        <div v-if="dailyHistory.length === 0" class="muted">還沒有紀錄。</div>
        <table v-else class="history-table">
          <thead>
            <tr>
              <th>日期</th>
              <th>練習</th>
              <th>對</th>
              <th>錯</th>
              <th>準確率</th>
              <th>新字</th>
              <th class="actions-col">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="d in dailyHistory" :key="d.date">
              <td>
                <template v-if="editingDate === d.date">
                  <input
                    type="date"
                    v-model="editingValue"
                    class="date-edit-input"
                    @keydown.enter="saveEditDate(d.date)"
                    @keydown.esc="cancelEditDate()"
                  />
                </template>
                <template v-else>{{ d.date }}</template>
              </td>
              <td>{{ fmtMin(d.secondsStudied) }}</td>
              <td class="ok">{{ d.correct }}</td>
              <td class="ng">{{ d.wrong }}</td>
              <td>{{ dailyAccuracy(d) }}%</td>
              <td>{{ d.newIntroduced }}</td>
              <td class="actions-col">
                <template v-if="editingDate === d.date">
                  <button class="btn-ghost small" @click="saveEditDate(d.date)">儲存</button>
                  <button class="btn-ghost small" @click="cancelEditDate()">取消</button>
                </template>
                <template v-else>
                  <button class="btn-ghost small" @click="startEditDate(d.date)">編輯</button>
                  <button class="btn-ghost small danger" @click="confirmDeleteDaily(d.date)">刪除</button>
                </template>
              </td>
            </tr>
          </tbody>
        </table>

      </section>

      <section v-if="showSettings" class="panel settings">
        <h3>設定</h3>
        <div class="setting-row">
          <span class="setting-label">字母</span>
          <div class="toggle-group">
            <button
              class="toggle"
              :class="{ active: settings.scripts.includes('hiragana') }"
              @click="toggleScript('hiragana')"
            >
              平假名
            </button>
            <button
              class="toggle"
              :class="{ active: settings.scripts.includes('katakana') }"
              @click="toggleScript('katakana')"
            >
              片假名
            </button>
          </div>
        </div>
        <div class="setting-row">
          <span class="setting-label">每日新字</span>
          <input
            type="number"
            min="0"
            max="30"
            :value="settings.newPerDay"
            @input="(e) => updateSettings({ newPerDay: Number((e.target as HTMLInputElement).value) })"
          />
        </div>
        <div class="setting-row">
          <span class="setting-label">每次練習分鐘</span>
          <input
            type="number"
            min="1"
            max="60"
            :value="settings.sessionMinutes"
            @input="(e) => updateSettings({ sessionMinutes: Number((e.target as HTMLInputElement).value) })"
          />
        </div>
        <div class="setting-row">
          <span class="setting-label">考試名稱</span>
          <input
            type="text"
            :value="settings.examLabel"
            @input="(e) => updateSettings({ examLabel: (e.target as HTMLInputElement).value })"
          />
        </div>
        <div class="setting-row">
          <span class="setting-label">考試日期</span>
          <input
            type="date"
            :value="settings.examDate"
            @input="(e) => updateSettings({ examDate: (e.target as HTMLInputElement).value })"
          />
        </div>
        <div class="setting-row">
          <span class="setting-label">自動播放讀音</span>
          <button
            class="toggle"
            :class="{ active: settings.autoPlaySound }"
            @click="updateSettings({ autoPlaySound: !settings.autoPlaySound })"
          >
            {{ settings.autoPlaySound ? '開' : '關' }}
          </button>
        </div>
        <div class="setting-row">
          <button class="danger" @click="confirmReset">清除所有進度</button>
        </div>
      </section>

      <section
        v-if="!sessionStarted && examCountdown && examCountdown.days >= 0"
        class="exam-banner"
      >
        <span class="exam-label">{{ examCountdown.label }}</span>
        <span class="exam-days">
          還剩 <b>{{ examCountdown.days }}</b> 天
        </span>
        <span class="exam-date">{{ settings.examDate }}</span>
      </section>

      <section v-if="!sessionStarted" class="panel hero">
        <h1>今天練 {{ settings.sessionMinutes }} 分鐘</h1>
        <p class="muted">
          每天 {{ settings.sessionMinutes }} 分鐘。完全沒背過也沒關係 ——<br />
          <b>學習模式</b>:新字會顯示讀法 + 自動唸出來,看著打就好。<br />
          <b>測驗模式</b>:熟了之後不顯示讀法、不先唸,答完才唸 —— 真正記住字形。
        </p>
        <div class="hero-stats">
          <div class="hero-stat">
            <div class="hero-stat-num">{{ stats.learned }}</div>
            <div class="hero-stat-label">已掌握</div>
          </div>
          <div class="hero-stat">
            <div class="hero-stat-num">{{ stats.introduced - stats.learned }}</div>
            <div class="hero-stat-label">學習中</div>
          </div>
          <div class="hero-stat">
            <div class="hero-stat-num">{{ stats.remaining }}</div>
            <div class="hero-stat-label">未學</div>
          </div>
        </div>
        <button class="primary big" @click="startFocus">重點練習</button>
      </section>

      <section v-else-if="focusActive && !focusFinished" class="panel session focus-panel">
        <div class="session-bar">
          <div class="quiz-title">重點練習</div>
          <div class="session-meta">
            <span class="ok">✓ {{ focusCorrectCount }}</span>
            <span class="muted">{{ focusCorrectCount }} / {{ focusInitialSize }}</span>
          </div>
          <button class="btn-ghost" @click="finishFocus">結束</button>
        </div>
        <div class="focus-progress-bar">
          <div class="focus-progress-fill" :style="{ width: focusProgress + '%' }"></div>
        </div>
        <div v-if="current" class="card" :data-state="feedback">
          <div class="kana-row">
            <div class="kana">{{ current.char }}</div>
          </div>
          <div class="tag-row">
            <span class="script-tag">
              {{ current.script === 'hiragana' ? '平假名' : '片假名' }}
            </span>
            <span class="learn-tag">重點</span>
          </div>
          <input
            ref="inputEl"
            v-model="input"
            class="answer-input"
            :class="{ good: feedback === 'good', bad: feedback === 'bad' }"
            autocomplete="off"
            autocapitalize="off"
            autocorrect="off"
            spellcheck="false"
            placeholder="輸入羅馬字"
            @keydown.enter.prevent="checkAnswer(input)"
          />
        </div>
      </section>

      <section v-else-if="focusFinished" class="panel session focus-done-panel">
        <h3>🎉 重點練習完成</h3>
        <div class="quiz-summary-row">
          <span class="ok">完成 {{ focusInitialSize }} 張</span>
          <span class="muted">對 {{ sessionCorrect }} · 錯 {{ sessionWrong }}</span>
        </div>
        <p class="muted focus-done-note">
          這場練的這 {{ focusInitialSize }} 張的最低準確率組會被推高;
          下次再開時系統會自動挑當下最弱的 6 張 + 全部 ≥90% 的字。
        </p>
        <button class="primary big" @click="finishFocus">回到首頁</button>
      </section>

    </main>
  </div>
</template>

<style scoped>
.page {
  width: 100%;
  max-width: 720px;
  margin: 0 auto;
  padding: 24px 20px 60px;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;
  flex-wrap: wrap;
  gap: 12px;
}
.brand {
  font-weight: 600;
  font-size: 16px;
  letter-spacing: 0.5px;
}
.topbar-stats {
  display: flex;
  gap: 8px;
  align-items: center;
}
.chip {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 6px 10px;
  display: flex;
  flex-direction: column;
  line-height: 1.1;
}
.chip-label {
  font-size: 10px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.chip-val {
  font-size: 13px;
  font-weight: 600;
}
.btn-icon {
  background: var(--panel);
  border: 1px solid var(--border);
  color: var(--text);
  width: 36px;
  height: 36px;
  border-radius: 10px;
  font-size: 16px;
}
.btn-icon:hover {
  background: var(--panel-2);
}
.account-btn {
  width: auto;
  padding: 0 12px;
  font-size: 13px;
}
.account-btn.signed-in {
  border-color: var(--accent);
  color: var(--accent);
}

.panel {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 28px;
  margin-bottom: 16px;
}

.exam-banner {
  display: flex;
  align-items: center;
  gap: 12px;
  background: linear-gradient(90deg, rgba(248, 113, 113, 0.15), rgba(125, 211, 252, 0.10));
  border: 1px solid rgba(248, 113, 113, 0.35);
  border-radius: 12px;
  padding: 10px 16px;
  margin-bottom: 14px;
  font-size: 14px;
  flex-wrap: wrap;
}
.exam-label {
  font-weight: 700;
  letter-spacing: 0.03em;
}
.exam-days {
  flex: 1;
  color: var(--text);
}
.exam-days b {
  font-size: 18px;
  color: var(--bad);
  font-variant-numeric: tabular-nums;
  margin: 0 2px;
}
.exam-date {
  font-size: 12px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}

.hero h1 {
  margin: 0 0 8px;
  font-size: 26px;
}
.muted {
  color: var(--muted);
  font-size: 14px;
  margin: 0 0 20px;
  line-height: 1.6;
}
.hero-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin: 20px 0 24px;
}
.hero-stat {
  background: var(--panel-2);
  border-radius: 12px;
  padding: 14px;
  text-align: center;
}
.hero-stat-num {
  font-size: 22px;
  font-weight: 700;
}
.hero-stat-label {
  font-size: 12px;
  color: var(--muted);
  margin-top: 4px;
}

.primary {
  background: var(--accent);
  color: #0a1620;
  border: none;
  border-radius: 10px;
  padding: 10px 18px;
  font-weight: 700;
}
.primary.big {
  width: 100%;
  padding: 14px;
  font-size: 16px;
}
.primary.small {
  padding: 6px 10px;
  font-size: 13px;
  margin-left: 10px;
}
.primary:hover { filter: brightness(1.1); }

.danger {
  background: transparent;
  color: var(--bad);
  border: 1px solid var(--bad);
  border-radius: 10px;
  padding: 8px 14px;
}

.btn-ghost {
  background: transparent;
  color: var(--muted);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 6px 12px;
  font-size: 13px;
}
.btn-ghost.small { padding: 4px 10px; font-size: 12px; }
.btn-ghost:hover { color: var(--text); }

.session-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 22px;
}
.timer {
  font-variant-numeric: tabular-nums;
  font-size: 22px;
  font-weight: 700;
}
.timer.low { color: var(--bad); }
.quiz-title {
  font-size: 18px;
  font-weight: 600;
  letter-spacing: 0.5px;
}
.quiz-hint {
  font-size: 12px;
  margin: -10px 0 18px;
}
.quiz-results-panel h3 {
  margin: 0 0 16px;
}
.quiz-summary-row {
  display: flex;
  gap: 16px;
  font-size: 16px;
  font-variant-numeric: tabular-nums;
  margin-bottom: 20px;
}
.quiz-failed-list { margin-bottom: 20px; }
.quiz-failed-label {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 10px;
}
.quiz-failed-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.quiz-failed-chip {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  padding: 6px 10px;
  border: 1px solid var(--bad);
  border-radius: 8px;
  background: rgba(239, 68, 68, 0.08);
  font-size: 18px;
}
.quiz-failed-romaji {
  font-size: 11px;
  color: var(--muted);
}
.quiz-deferred-chip {
  border-color: var(--border);
  background: transparent;
  opacity: 0.7;
}
.quiz-lock-notice {
  padding: 10px 14px;
  border: 1px solid var(--border);
  border-radius: 8px;
  margin-bottom: 20px;
  font-size: 13px;
  color: var(--muted);
}
.session-meta {
  display: flex;
  gap: 12px;
  font-size: 14px;
  font-variant-numeric: tabular-nums;
}
.ok { color: var(--good); }
.ng { color: var(--bad); }

.card {
  text-align: center;
  padding: 20px 0;
}
.kana-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
}
.kana {
  font-size: 140px;
  line-height: 1;
  margin: 10px 0 4px;
  font-family: 'Hiragino Sans', 'Yu Gothic', 'Meiryo', system-ui, sans-serif;
  transition: color 0.15s, transform 0.15s;
}
.speak-btn {
  background: var(--panel-2);
  border: 1px solid var(--border);
  color: var(--text);
  width: 44px;
  height: 44px;
  border-radius: 50%;
  font-size: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, transform 0.1s;
}
.speak-btn:hover { background: var(--panel); transform: scale(1.06); }
.speak-btn:active { transform: scale(0.94); }
.card[data-state='good'] .kana { color: var(--good); transform: scale(1.05); }
.card[data-state='bad'] .kana { color: var(--bad); }
.tag-row {
  display: flex;
  justify-content: center;
  gap: 6px;
  margin-bottom: 18px;
}
.script-tag {
  font-size: 11px;
  color: var(--muted);
  background: var(--panel-2);
  padding: 3px 10px;
  border-radius: 999px;
}
.learn-tag {
  font-size: 11px;
  color: #0a1620;
  background: var(--accent);
  padding: 3px 10px;
  border-radius: 999px;
  font-weight: 600;
}
.learn-hint {
  background: rgba(125, 211, 252, 0.08);
  border: 1px dashed rgba(125, 211, 252, 0.4);
  border-radius: 12px;
  padding: 12px 16px;
  margin: 0 auto 18px;
  max-width: 320px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.learn-hint-label {
  font-size: 11px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.learn-hint-romaji {
  font-size: 28px;
  font-weight: 700;
  color: var(--accent);
  letter-spacing: 0.1em;
  font-variant: small-caps;
}
.learn-hint-note {
  font-size: 11px;
  color: var(--muted);
}

.answer-input {
  display: block;
  margin: 0 auto;
  width: 100%;
  max-width: 280px;
  font-size: 28px;
  text-align: center;
  background: var(--panel-2);
  border: 2px solid var(--border);
  border-radius: 12px;
  color: var(--text);
  padding: 12px 14px;
  outline: none;
  letter-spacing: 0.15em;
  font-variant: small-caps;
  transition: border-color 0.15s;
}
.answer-input:focus { border-color: var(--accent); }
.answer-input.good { border-color: var(--good); }
.answer-input.bad { border-color: var(--bad); animation: shake 0.3s; }

@keyframes shake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-6px); }
  75% { transform: translateX(6px); }
}

.hint-row {
  margin-top: 18px;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.answer-shown {
  font-size: 14px;
  color: var(--muted);
}
.answer-shown :deep(button) { vertical-align: middle; }

.empty {
  text-align: center;
  color: var(--muted);
  padding: 40px 0;
}

.settings h3 { margin: 0 0 16px; font-size: 16px; }
.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
  gap: 12px;
}
.setting-label { color: var(--muted); font-size: 14px; }
.setting-row input[type='number'],
.setting-row input[type='text'],
.setting-row input[type='date'] {
  background: var(--panel-2);
  border: 1px solid var(--border);
  color: var(--text);
  border-radius: 8px;
  padding: 6px 10px;
  font-size: 14px;
  color-scheme: dark;
}
.setting-row input[type='number'] { width: 80px; text-align: right; }
.setting-row input[type='text'] { width: 140px; }
.setting-row input[type='date'] { width: 150px; }
.toggle-group { display: flex; gap: 8px; }
.toggle {
  background: var(--panel-2);
  border: 1px solid var(--border);
  color: var(--muted);
  padding: 6px 14px;
  border-radius: 8px;
  font-size: 13px;
}
.toggle.active {
  background: var(--accent);
  color: #0a1620;
  border-color: var(--accent);
  font-weight: 600;
}

.history h3 { margin: 0 0 14px; font-size: 16px; }
.history-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.history-header h3 { margin: 0; }
.history-header-actions {
  display: flex;
  gap: 8px;
}
.hidden-file-input { display: none; }
.history h4 {
  margin: 18px 0 10px;
  font-size: 13px;
  color: var(--muted);
  font-weight: 600;
  letter-spacing: 0.05em;
}
.cal-legend {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--muted);
  flex-wrap: wrap;
  margin: 8px 0 4px;
}
.legend-label { padding: 0 4px; }
.cal-cell {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  display: inline-block;
  flex-shrink: 0;
}
.cal-cell.s0 { background: rgba(255, 255, 255, 0.05); }
.cal-cell.s1 { background: rgba(125, 211, 252, 0.22); }
.cal-cell.s2 { background: rgba(125, 211, 252, 0.42); }
.cal-cell.s3 { background: rgba(125, 211, 252, 0.66); }
.cal-cell.s4 { background: var(--accent); }

.pool-legend {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin: 8px 0 12px;
}

.kana-grids-stack {
  display: flex;
  flex-direction: column;
  gap: 24px;
}
.kana-grid-block {
  min-width: 0;
}
.kana-grid {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.kana-grid-row {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 6px;
}
.kana-grid-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--panel);
  font-family: 'Hiragino Sans', 'Yu Gothic', 'Meiryo', system-ui, sans-serif;
  color: var(--text);
  padding: 8px 4px;
  min-height: 78px;
  line-height: 1.1;
  gap: 6px;
}
.kana-grid-cell .cell-main {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}
.kana-grid-cell .cell-char { font-size: 22px; font-weight: 600; }
.kana-grid-cell .cell-romaji { font-size: 10px; color: var(--muted); }
.kana-grid-cell .cell-stats {
  display: flex;
  gap: 4px;
  font-size: 9px;
  font-variant-numeric: tabular-nums;
  color: var(--muted);
  white-space: nowrap;
}
.kana-grid-cell .cell-stat { opacity: 0.95; }
.kana-grid-cell.empty {
  background: transparent;
  border-color: transparent;
}
.kana-grid-cell.pool-bottom {
  background: rgba(239, 68, 68, 0.22);
  border-color: rgba(239, 68, 68, 0.55);
}
.kana-grid-cell.pool-bottom .cell-stats { color: rgba(255, 200, 200, 0.95); }
.kana-grid-cell.pool-top {
  background: rgba(34, 197, 94, 0.22);
  border-color: rgba(34, 197, 94, 0.55);
}
.kana-grid-cell.pool-top .cell-stats { color: rgba(200, 240, 210, 0.95); }
.kana-grid-cell.pool-mid {
  background: rgba(255, 255, 255, 0.04);
}
.kana-grid-cell.pool-unintroduced {
  background: transparent;
  border-style: dashed;
  opacity: 0.45;
}
.kana-grid-cell.pool-unintroduced .cell-stats-unintroduced {
  font-size: 10px;
  color: var(--muted);
}

.cal-wrap { margin-bottom: 8px; }
.cal-months {
  display: grid;
  gap: 3px;
  margin-left: 18px;
  margin-bottom: 4px;
  font-size: 10px;
  color: var(--muted);
}
.cal-months span { white-space: nowrap; }
.cal-body { display: flex; gap: 4px; }
.cal-dow {
  display: grid;
  grid-template-rows: repeat(7, 14px);
  gap: 3px;
  font-size: 9px;
  color: var(--muted);
  align-items: center;
  padding-right: 2px;
  width: 14px;
}
.cal-grid {
  display: flex;
  gap: 3px;
  flex: 1;
}
.cal-col {
  display: grid;
  grid-template-rows: repeat(7, 14px);
  gap: 3px;
  flex: 1;
  min-width: 0;
}
.cal-cell {
  width: 100%;
  height: 14px;
  border-radius: 3px;
  transition: transform 0.1s;
  cursor: default;
}
.cal-cell.future { background: transparent; }
.cal-cell.today {
  outline: 1.5px solid var(--accent);
  outline-offset: -1.5px;
}
.cal-cell:hover { transform: scale(1.25); }

.history-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
.history-table th,
.history-table td {
  text-align: left;
  padding: 8px 6px;
  border-bottom: 1px solid var(--border);
}
.history-table th {
  color: var(--muted);
  font-weight: 500;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.history-table td.ok { color: var(--good); }
.history-table td.ng { color: var(--bad); }
.history-table .actions-col {
  text-align: right;
  white-space: nowrap;
}
.history-table .actions-col .btn-ghost + .btn-ghost { margin-left: 6px; }
.history-table .btn-ghost.danger { color: var(--bad); }
.history-table .btn-ghost.danger:hover { border-color: var(--bad); }
.date-edit-input {
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px 6px;
  font: inherit;
  font-variant-numeric: tabular-nums;
}

.pool-tag {
  display: inline-block;
  padding: 1px 8px;
  border-radius: 4px;
  font-size: 11px;
  border: 1px solid var(--border);
}
.pool-tag.pool-bottom { color: var(--bad); border-color: var(--bad); }
.pool-tag.pool-top { color: var(--good); border-color: var(--good); }
.pool-tag.pool-mid { color: var(--muted); }
.pool-tag.pool-unintroduced { color: var(--muted); opacity: 0.5; }

.hero-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
.btn-ghost.big {
  padding: 14px 28px;
  font-size: 16px;
  border-radius: 12px;
}
.focus-progress-bar {
  height: 6px;
  background: var(--border);
  border-radius: 3px;
  overflow: hidden;
  margin: -10px 0 18px;
}
.focus-progress-fill {
  height: 100%;
  background: var(--accent);
  transition: width 0.3s ease;
}
.focus-done-panel h3 { margin: 0 0 16px; }
.focus-done-note {
  font-size: 13px;
  margin: 16px 0 24px;
  line-height: 1.6;
}

@media (max-width: 560px) {
  .kana { font-size: 110px; }
  .topbar-stats { gap: 6px; }
  .chip { padding: 4px 8px; }
  .chip-val { font-size: 12px; }
  .kana-grid-cell { padding: 6px 2px; min-height: 64px; }
  .kana-grid-cell .cell-char { font-size: 18px; }
  .kana-grid-cell .cell-romaji { font-size: 9px; }
  .kana-grid-cell .cell-stats { font-size: 8px; gap: 3px; }
  .history-table { font-size: 12px; }
  .history-table th,
  .history-table td { padding: 6px 4px; }
}
</style>
