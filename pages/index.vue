<script setup lang="ts">
import type { KanaEntry } from '~/data/kana'
import { ALL_KANA } from '~/data/kana'

const { settings, stats, updateSettings, pickNext, review, addStudySeconds, resetAll, getCardState, dailyHistory, deleteDaily, renameDaily, masteryScore, quiz, startQuiz, quizPickNext, quizAnswer, quizSkip, endQuiz, relearnTodayCards, relearnLaterCards, resetSessionLapses, importPersist } = useSRS()

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

function skipQuizCard() {
  if (!current.value) return
  quizSkip(current.value.id)
  nextQuizCard()
}

function skipWholeQuiz() {
  endQuiz()
  lastTickAt = Date.now()
  timerHandle = window.setInterval(tick, 1000)
  next()
}

const inQuiz = computed(() => quiz.value.active && !quiz.value.finished)
const quizFinished = computed(() => quiz.value.active && quiz.value.finished)
const quizTotal = computed(() => quiz.value.order.length)

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
const sessionRemainingSec = ref(0)
const sessionElapsedSec = ref(0)
const sessionCorrect = ref(0)
const sessionWrong = ref(0)

let timerHandle: number | null = null
let lastTickAt = 0

function next() {
  current.value = pickNext()
  input.value = ''
  feedback.value = 'idle'
  firstTry.value = true
  wrongCount.value = 0
  showAnswer.value = false
  locked.value = false
  nextTick(() => {
    inputEl.value?.focus()
    if (!current.value) return
    const c = getCardState(current.value.id)
    const learning = !c || c.correctTotal < 2
    if (settings.value.autoPlaySound && learning) {
      speak(current.value.char)
    }
  })
}

function checkAnswer(value: string) {
  if (!current.value || locked.value) return
  const cleaned = value.trim().toLowerCase()
  if (!cleaned) return
  const accepts = current.value.accepts
  const exact = accepts.includes(cleaned)
  const partialMatch = accepts.some((a) => a.startsWith(cleaned))

  if (inQuiz.value) {
    if (exact) {
      feedback.value = 'good'
      locked.value = true
      quizAnswer(current.value.id, true)
      setTimeout(() => nextQuizCard(), 400)
      return
    }
    const longest = Math.max(...accepts.map((a) => a.length))
    if (!partialMatch || cleaned.length >= longest) {
      feedback.value = 'bad'
      locked.value = true
      const result = quizAnswer(current.value.id, false)
      if (result === 'retry') {
        setTimeout(() => {
          input.value = ''
          feedback.value = 'idle'
          locked.value = false
          inputEl.value?.focus()
        }, 600)
      } else {
        setTimeout(() => nextQuizCard(), 800)
      }
    }
    return
  }

  if (exact) {
    feedback.value = 'good'
    locked.value = true
    review(current.value.id, true, firstTry.value)
    if (firstTry.value) sessionCorrect.value += 1
    if (settings.value.autoPlaySound) speak(current.value.char)
    setTimeout(() => next(), 700)
    return
  }
  const longest = Math.max(...accepts.map((a) => a.length))
  if (!partialMatch || cleaned.length >= longest) {
    feedback.value = 'bad'
    if (wrongCount.value === 0) {
      firstTry.value = false
      sessionWrong.value += 1
      review(current.value.id, false, false)
    }
    wrongCount.value += 1
    if (wrongCount.value >= 3) {
      reveal()
      return
    }
    locked.value = true
    setTimeout(() => {
      input.value = ''
      feedback.value = 'idle'
      locked.value = false
      inputEl.value?.focus()
    }, 500)
  }
}

function reveal() {
  if (!current.value) return
  showAnswer.value = true
  feedback.value = 'revealed'
  locked.value = true
  if (wrongCount.value === 0) {
    firstTry.value = false
    sessionWrong.value += 1
    review(current.value.id, false, false)
  }
  if (settings.value.autoPlaySound) speak(current.value.char)
}

function startSession() {
  sessionStarted.value = true
  sessionElapsedSec.value = 0
  sessionCorrect.value = 0
  sessionWrong.value = 0
  sessionRemainingSec.value = settings.value.sessionMinutes * 60
  resetSessionLapses()
  const quizCards = startQuiz()
  if (quizCards.length > 0) {
    nextQuizCard()
  } else {
    lastTickAt = Date.now()
    timerHandle = window.setInterval(tick, 1000)
    next()
  }
}

function nextQuizCard() {
  current.value = quizPickNext()
  input.value = ''
  feedback.value = 'idle'
  firstTry.value = true
  wrongCount.value = 0
  showAnswer.value = false
  locked.value = false
  nextTick(() => inputEl.value?.focus())
}

function continueToLearning() {
  endQuiz()
  flushCloud() // 測驗結束 → 同步雲端
  lastTickAt = Date.now()
  timerHandle = window.setInterval(tick, 1000)
  next()
}

function tick() {
  const now = Date.now()
  const delta = Math.round((now - lastTickAt) / 1000)
  lastTickAt = now
  sessionElapsedSec.value += delta
  sessionRemainingSec.value = Math.max(0, sessionRemainingSec.value - delta)
  addStudySeconds(delta)
  if (sessionRemainingSec.value === 0) endSession()
}

function endSession() {
  if (timerHandle != null) {
    clearInterval(timerHandle)
    timerHandle = null
  }
  sessionStarted.value = false
  current.value = null
  input.value = ''
  flushCloud() // 結束練習 → 同步雲端
}

onUnmounted(() => {
  if (timerHandle != null) clearInterval(timerHandle)
})

const fmtTime = (s: number) => {
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`
}

const todayStudyMin = computed(() => Math.floor(stats.value.today.secondsStudied / 60))
const todayStudySec = computed(() => stats.value.today.secondsStudied % 60)
const todayAccuracy = computed(() => {
  const c = stats.value.today.correct
  const w = stats.value.today.wrong
  if (c + w === 0) return 0
  return Math.round((c / (c + w)) * 100)
})

const sessionAccuracy = computed(() => {
  const t = sessionCorrect.value + sessionWrong.value
  if (t === 0) return 0
  return Math.round((sessionCorrect.value / t) * 100)
})

const isLearning = computed(() => {
  if (!current.value) return false
  const c = getCardState(current.value.id)
  if (!c) return true
  return c.correctTotal < 2
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

function playCurrent() {
  if (current.value) speak(current.value.char)
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
    endSession()
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

        <div class="heat-legend">
          <span class="legend-label">不熟</span>
          <span class="heat-cell s0"></span>
          <span class="heat-cell s1"></span>
          <span class="heat-cell s2"></span>
          <span class="heat-cell s3"></span>
          <span class="heat-cell s4"></span>
          <span class="legend-label">熟練</span>
        </div>

        <div class="kana-grids-row">
          <div class="kana-grid-block">
            <h4>平假名</h4>
            <div class="kana-grid">
              <div v-for="(row, ri) in hiraganaGrid" :key="'h' + ri" class="kana-grid-row">
                <div
                  v-for="(cell, ci) in row"
                  :key="ci"
                  class="kana-grid-cell"
                  :class="cell.entry ? 's' + cell.score : 'empty'"
                  :title="cell.entry ? cell.entry.char + ' ' + cell.entry.romaji : ''"
                >
                  <template v-if="cell.entry">{{ cell.entry.char }}</template>
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
                  :class="cell.entry ? 's' + cell.score : 'empty'"
                  :title="cell.entry ? cell.entry.char + ' ' + cell.entry.romaji : ''"
                >
                  <template v-if="cell.entry">{{ cell.entry.char }}</template>
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
        <button class="primary big" @click="startSession">開始</button>
      </section>

      <section v-else-if="inQuiz" class="panel session quiz-panel">
        <div class="session-bar">
          <div class="quiz-title">今日測驗</div>
          <div class="session-meta">
            <span class="ok">✓ {{ quiz.passedCount }}</span>
            <span class="ng">✗ {{ quiz.failedCount }}</span>
            <span class="muted">{{ quiz.passedCount + quiz.failedCount }} / {{ quizTotal }}</span>
          </div>
          <button class="btn-ghost" @click="skipWholeQuiz">跳過測驗</button>
        </div>
        <div class="quiz-hint muted">
          每張需答對 {{ 3 }} 次才算通過,答錯一次就算忘記。
        </div>

        <div v-if="current" class="card" :data-state="feedback">
          <div class="kana-row">
            <div class="kana">{{ current.char }}</div>
          </div>
          <div class="tag-row">
            <span class="script-tag">
              {{ current.script === 'hiragana' ? '平假名' : '片假名' }}
            </span>
            <span class="learn-tag">測驗中</span>
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
          <div class="hint-row">
            <button class="btn-ghost small" @click="skipQuizCard">
              跳過 (算忘記)
            </button>
          </div>
        </div>
      </section>

      <section v-else-if="quizFinished" class="panel session quiz-results-panel">
        <h3>測驗結果</h3>
        <div class="quiz-summary">
          <div class="quiz-summary-row">
            <span class="ok">答對 {{ quiz.passedCount }}</span>
            <span class="ng">忘記 {{ quiz.failedCount }}</span>
            <span class="muted">共 {{ quizTotal }} 張</span>
          </div>
        </div>
        <div v-if="relearnTodayCards().length > 0" class="quiz-failed-list">
          <div class="quiz-failed-label muted">今天先重學這 {{ relearnTodayCards().length }} 張</div>
          <div class="quiz-failed-chips">
            <span v-for="k in relearnTodayCards()" :key="k.id" class="quiz-failed-chip">
              {{ k.char }}
              <span class="quiz-failed-romaji">{{ k.romaji }}</span>
            </span>
          </div>
        </div>
        <div v-if="relearnLaterCards().length > 0" class="quiz-failed-list">
          <div class="quiz-failed-label muted">明天再排這 {{ relearnLaterCards().length }} 張</div>
          <div class="quiz-failed-chips">
            <span v-for="k in relearnLaterCards()" :key="k.id" class="quiz-failed-chip quiz-deferred-chip">
              {{ k.char }}
              <span class="quiz-failed-romaji">{{ k.romaji }}</span>
            </span>
          </div>
        </div>
        <div v-if="quiz.noNewToday" class="quiz-lock-notice">
          忘記的字較多,今天暫停介紹新字,先把舊的鞏固。
        </div>
        <button class="primary big" @click="continueToLearning">繼續學習</button>
      </section>

      <section v-else class="panel session">
        <div class="session-bar">
          <div class="timer" :class="{ low: sessionRemainingSec <= 60 }">
            {{ fmtTime(sessionRemainingSec) }}
          </div>
          <div class="session-meta">
            <span class="ok">✓ {{ sessionCorrect }}</span>
            <span class="ng">✗ {{ sessionWrong }}</span>
            <span class="muted">{{ sessionAccuracy }}%</span>
          </div>
          <button class="btn-ghost" @click="endSession">結束</button>
        </div>

        <div v-if="current" class="card" :data-state="feedback">
          <div class="kana-row">
            <div class="kana">{{ current.char }}</div>
            <button
              v-if="ttsSupported"
              class="speak-btn"
              :title="settings.autoPlaySound ? '播放讀音' : '播放讀音 (自動播放已關)'"
              @click="playCurrent"
            >
              🔊
            </button>
          </div>
          <div class="tag-row">
            <span class="script-tag">
              {{ current.script === 'hiragana' ? '平假名' : '片假名' }}
            </span>
            <span v-if="isLearning" class="learn-tag">學習中</span>
          </div>
          <div v-if="isLearning" class="learn-hint">
            <span class="learn-hint-label">讀法</span>
            <span class="learn-hint-romaji">{{ current.romaji }}</span>
            <span class="learn-hint-note">看著打,熟了就會消失</span>
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
          <div class="hint-row">
            <button class="btn-ghost small" @click="reveal" :disabled="showAnswer">
              不會 (顯示答案)
            </button>
            <span v-if="showAnswer" class="answer-shown">
              答案:{{ current.romaji }}
              <button class="primary small" @click="next">下一個</button>
            </span>
          </div>
        </div>
        <div v-else class="empty">
          <p>沒有可練習的字了 — 請開啟某個字母系統或重設進度。</p>
        </div>
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
.heat-legend,
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
.heat-cell,
.cal-cell {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  display: inline-block;
  flex-shrink: 0;
}

.s0 { background: rgba(255, 255, 255, 0.05); }
.s1 { background: rgba(125, 211, 252, 0.22); }
.s2 { background: rgba(125, 211, 252, 0.42); }
.s3 { background: rgba(125, 211, 252, 0.66); }
.s4 { background: var(--accent); }

.kana-grids-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  align-items: start;
}
.kana-grid-block {
  min-width: 0;
}
.kana-grid {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.kana-grid-row {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 4px;
}
.kana-grid-cell {
  aspect-ratio: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  font-size: 22px;
  font-family: 'Hiragino Sans', 'Yu Gothic', 'Meiryo', system-ui, sans-serif;
  color: var(--text);
}
.kana-grid-cell.empty { background: transparent; }
.kana-grid-cell.s0 { color: var(--muted); }
.kana-grid-cell.s4 { color: #0a1620; font-weight: 700; }

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

@media (max-width: 560px) {
  .kana { font-size: 110px; }
  .topbar-stats { gap: 6px; }
  .chip { padding: 4px 8px; }
  .chip-val { font-size: 12px; }
  .kana-grid-cell { font-size: 16px; }
  .kana-grids-row { grid-template-columns: 1fr; }
  .history-table { font-size: 12px; }
  .history-table th,
  .history-table td { padding: 6px 4px; }
}
</style>
