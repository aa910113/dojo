<script setup lang="ts">
import type { KanaEntry, Stage } from '~/data/kana'
import { ALL_KANA } from '~/data/kana'

const { settings, stats, updateSettings, review, resetAll, addStudySeconds, getCardState, dailyHistory, deleteDaily, renameDaily, masteryScore, resetSessionLapses, importPersist, focusQueue, focusInitialSize, focusCorrectCount, startFocusSession, pickFocusCard, focusAnswer, endFocusSession, focusProgressFor, testQueue, testTotal, testCorrectIds, testWrongIds, startTestSession, pickTestCard, testAnswer, endTestSession, effectiveAccuracy, stages, stageInfo, isUnlocked, lastStageResult, evaluateStageUnlock, introduceCard } = useSRS()

const focusFinished = ref(false)
const focusActive = computed(() => focusQueue.value.length > 0 || focusFinished.value)
// 目前這張是「還沒學過的新字」→ 顯示讀法、自動唸,答完只標成已學不記分
const isNewCard = ref(false)
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
  locked.value = false
  isNewCard.value = !getCardState(card.id)?.introduced
  showAnswer.value = isNewCard.value
  nextTick(() => inputEl.value?.focus())
}

function startFocus() {
  sfx('ka')
  sessionStarted.value = true
  sessionCorrect.value = 0
  sessionWrong.value = 0
  combo.value = 0
  comboBest.value = 0
  resetSessionLapses()
  focusFinished.value = false
  const n = startFocusSession()
  if (n === 0) {
    alert('目前沒有可練習的字 — 請確認設定裡有勾選目前關卡的字母')
    sessionStarted.value = false
    return
  }
  next_focus_card_or_finish()
}

function finishFocus() {
  endFocusSession()
  focusFinished.value = false
  sessionStarted.value = false
  isNewCard.value = false
  current.value = null
  input.value = ''
}

const testFinished = ref(false)
// 依作答順序記錄對錯,給量表上色
const testResults = ref<('ok' | 'ng')[]>([])
const testActive = computed(() => testQueue.value.length > 0 || testFinished.value)
const testAnswered = computed(() => testCorrectIds.value.length + testWrongIds.value.length)

function next_test_card_or_finish() {
  const card = pickTestCard()
  if (!card) {
    // 整輪跑完才判定關卡(中途按「結束」不算)
    evaluateStageUnlock(testCorrectIds.value)
    if (lastStageResult.value?.passed) sfx('clear')
    testFinished.value = true
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

function startTest() {
  sfx('ka')
  sessionStarted.value = true
  sessionCorrect.value = 0
  sessionWrong.value = 0
  combo.value = 0
  comboBest.value = 0
  resetSessionLapses()
  testFinished.value = false
  testResults.value = []
  const n = startTestSession()
  if (n === 0) {
    alert('目前沒有可測驗的字 — 請確認設定裡有勾選目前關卡的字母')
    sessionStarted.value = false
    return
  }
  next_test_card_or_finish()
}

function finishTest() {
  endTestSession()
  testFinished.value = false
  sessionStarted.value = false
  current.value = null
  input.value = ''
}

function skipTestCard() {
  if (!current.value) return
  // 點「我不會」= 直接記錯,送下一張
  feedback.value = 'bad'
  sfx('fail')
  review(current.value.id, false, false)
  sessionWrong.value += 1
  resetCombo()
  testResults.value.push('ng')
  testAnswer(current.value.id, false)
  locked.value = true
  setTimeout(() => next_test_card_or_finish(), 500)
}

const testWrongCards = computed(() =>
  testWrongIds.value
    .map((id) => ALL_KANA.find((k) => k.id === id))
    .filter((k): k is KanaEntry => !!k),
)
const testCorrectCards = computed(() =>
  testCorrectIds.value
    .map((id) => ALL_KANA.find((k) => k.id === id))
    .filter((k): k is KanaEntry => !!k),
)

// === 首頁關卡列表(選曲畫面風) ===
type StageStatus = 'passed' | 'current' | 'locked'
interface StageRow {
  stage: Stage
  status: StageStatus
  introduced: number
  total: number
  accuracy: number
  stars: number
  prevLabel: string
}

const stageRows = computed<StageRow[]>(() => {
  const { passed, unlocked, allPassed } = stageInfo.value
  return stages.value.map((stage, i) => {
    const status: StageStatus = i < passed ? 'passed' : (!allPassed && i === unlocked - 1) ? 'current' : 'locked'
    let introduced = 0
    let accSum = 0
    for (const id of stage.cardIds) {
      const c = getCardState(id)
      if (c?.introduced) {
        introduced += 1
        accSum += effectiveAccuracy(c)
      }
    }
    const accuracy = introduced > 0 ? accSum / introduced : 0
    let stars = 0
    if (status === 'passed') stars = accuracy >= 0.95 ? 3 : accuracy >= 0.85 ? 2 : 1
    else if (status === 'current') stars = Math.floor((introduced / stage.cardIds.length) * 3)
    return {
      stage,
      status,
      introduced,
      total: stage.cardIds.length,
      accuracy: Math.round(accuracy * 100),
      stars,
      prevLabel: i > 0 ? stages.value[i - 1].label : '',
    }
  })
})

// 目前關卡的字全部學過 → 可以去測驗解鎖
const stageReadyToTest = computed(() => {
  const cur = stageInfo.value.current
  if (!cur) return false
  const row = stageRows.value[cur.index]
  return !!row && row.introduced >= row.total
})

const showAllStages = ref(false)
// 預設只列到目前關卡 + 後面兩關,其餘摺疊
const visibleStageRows = computed(() => {
  if (showAllStages.value) return stageRows.value
  const cut = Math.min(stages.value.length, stageInfo.value.unlocked + 2)
  return stageRows.value.slice(0, cut)
})
const hiddenStageCount = computed(() => stageRows.value.length - visibleStageRows.value.length)

function scriptName(script: string) {
  if (script === 'both') return '平假名 + 片假名'
  return script === 'hiragana' ? '平假名' : '片假名'
}
// 鼓面圓圈裡空間有限,用短標示
function scriptShort(script: string) {
  if (script === 'both') return '平・片'
  return script === 'hiragana' ? '平假名' : '片假名'
}

// === 手寫測驗(看羅馬字寫假名,隨機出題,每題自評)===
const traceBoard = ref<{ clear: () => void; undo: () => void; hasInk: boolean } | null>(null)
const writeQueue = ref<string[]>([])
const writeTotal = ref(0)
const writeCorrectIds = ref<string[]>([])
const writeWrongIds = ref<string[]>([])
const writeResults = ref<('ok' | 'ng')[]>([])
// 寫完按「對答案」才把正確字形疊上來,接著自評
const writeRevealed = ref(false)
const writeFinished = ref(false)

const traceActive = computed(() => writeQueue.value.length > 0 || writeFinished.value)
const traceCard = computed<KanaEntry | null>(
  () => ALL_KANA.find((k) => k.id === writeQueue.value[0]) ?? null,
)
const writeAnswered = computed(() => writeCorrectIds.value.length + writeWrongIds.value.length)
const writeWrongCards = computed(() =>
  writeWrongIds.value
    .map((id) => ALL_KANA.find((k) => k.id === id))
    .filter((k): k is KanaEntry => !!k),
)

function startTrace() {
  sfx('ka')
  const list = stages.value
  const stage = stageInfo.value.current ?? list[list.length - 1]
  const ids = (stage?.cardIds ?? []).filter((id) => isUnlocked(id))
  if (ids.length === 0) {
    alert('目前沒有可測驗的字 — 請確認設定裡有勾選目前關卡的字母')
    return
  }
  // 洗牌出題,每張只問一次
  const queue = [...ids]
  for (let i = queue.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[queue[i], queue[j]] = [queue[j], queue[i]]
  }
  writeQueue.value = queue
  writeTotal.value = queue.length
  writeCorrectIds.value = []
  writeWrongIds.value = []
  writeResults.value = []
  writeRevealed.value = false
  writeFinished.value = false
  combo.value = 0
  comboBest.value = 0
  sessionCorrect.value = 0
  sessionWrong.value = 0
  sessionStarted.value = true
}

function finishTrace() {
  writeQueue.value = []
  writeTotal.value = 0
  writeCorrectIds.value = []
  writeWrongIds.value = []
  writeResults.value = []
  writeRevealed.value = false
  writeFinished.value = false
  sessionStarted.value = false
}

function writeReveal() {
  sfx('ka')
  writeRevealed.value = true
}

// 自評:只記在這場測驗裡,不寫進 SRS —— 手寫是另一種能力,
// 而且自評不夠可靠,混進打字的準確率會影響重點練習選卡
function writeJudge(ok: boolean) {
  const card = traceCard.value
  if (!card) return
  sfx(ok ? 'don' : 'fail')
  if (ok) {
    writeCorrectIds.value = [...writeCorrectIds.value, card.id]
    sessionCorrect.value += 1
    bumpCombo()
  } else {
    writeWrongIds.value = [...writeWrongIds.value, card.id]
    sessionWrong.value += 1
    resetCombo()
  }
  writeResults.value = [...writeResults.value, ok ? 'ok' : 'ng']
  writeQueue.value = writeQueue.value.slice(1)
  writeRevealed.value = false
  traceBoard.value?.clear()
  if (writeQueue.value.length === 0) {
    writeFinished.value = true
    flushCloud()
  }
}

function playTrace() {
  if (traceCard.value) speakKana(traceCard.value.char)
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
  sfx('ka')
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
// 連續一次答對的次數(コンボ),答錯歸零
const combo = ref(0)
const comboBest = ref(0)
function bumpCombo() {
  combo.value += 1
  if (combo.value > comboBest.value) comboBest.value = combo.value
}
function resetCombo() {
  combo.value = 0
}

// === 音效 / 背景音樂 ===
const { sfx, unlock: unlockAudio, startBgm, stopBgm, setSfx, setBgm, nextTrack, trackName, bgmPlaying } = useSound()

function onNextTrack() {
  sfx('ka')
  nextTrack()
}

function toggleSfx() {
  updateSettings({ sfx: !settings.value.sfx })
  if (settings.value.sfx) sfx('ka')
}
function toggleBgm() {
  updateSettings({ bgm: !settings.value.bgm })
}
watch(() => settings.value.sfx, (v) => setSfx(v), { immediate: true })
watch(() => settings.value.bgm, (v) => setBgm(v), { immediate: true })

// 首頁播 BGM,進任何模式就停;結果畫面放過關音效 + 專用曲
watch(sessionStarted, (started) => {
  if (started) stopBgm()
  else startBgm('home')
}, { immediate: true })

const onDoneScreen = computed(() => focusFinished.value || testFinished.value || writeFinished.value)

// === 練習計時 ===
// 在任何模式裡(重點練習 / 拼音測驗 / 手寫測驗)每秒累加,結果畫面與分頁切到背景時暫停;
// 每 10 秒寫進今日統計一次,結束時把剩餘的補上
const studying = computed(() => sessionStarted.value && !onDoneScreen.value)
const sessionSeconds = ref(0)
let studyTimer: number | null = null
let pendingStudySeconds = 0

function flushStudySeconds() {
  if (pendingStudySeconds > 0) {
    addStudySeconds(pendingStudySeconds)
    pendingStudySeconds = 0
  }
}
function startStudyTimer() {
  if (studyTimer != null) return
  studyTimer = window.setInterval(() => {
    sessionSeconds.value += 1
    pendingStudySeconds += 1
    if (pendingStudySeconds >= 10) flushStudySeconds()
  }, 1000)
}
function stopStudyTimer() {
  if (studyTimer != null) {
    clearInterval(studyTimer)
    studyTimer = null
  }
  flushStudySeconds()
}
watch(studying, (on) => {
  if (on) startStudyTimer()
  else stopStudyTimer()
})
watch(sessionStarted, (started) => {
  if (started) sessionSeconds.value = 0
})
function fmtClock(sec: number) {
  const m = Math.floor(sec / 60)
  const s2 = sec % 60
  return `${m}:${String(s2).padStart(2, '0')}`
}
// 彩帶強度:測驗過關最大、零失誤次之、一般完成最小
const celebrationIntensity = computed(() => {
  if (testFinished.value && lastStageResult.value?.passed) return 2
  if (sessionWrong.value === 0) return 1.5
  return 1
})
const fullCombo = computed(() => sessionWrong.value === 0 && sessionCorrect.value > 0)
let doneKey = 0
watch(onDoneScreen, (d) => { if (d) doneKey += 1 })
let resultBgmTimer: number | null = null
watch(onDoneScreen, (done) => {
  if (resultBgmTimer != null) {
    clearTimeout(resultBgmTimer)
    resultBgmTimer = null
  }
  if (done) {
    // 測驗過關已經有更盛大的 clear 音效,其餘結束畫面放 fanfare
    if (!(testFinished.value && lastStageResult.value?.passed)) sfx('fanfare')
    // 音效結束後接結果曲
    resultBgmTimer = window.setTimeout(() => {
      resultBgmTimer = null
      if (onDoneScreen.value) startBgm('result')
    }, 2600)
  } else if (sessionStarted.value) {
    stopBgm()
  }
})

// 瀏覽器只承認 touchend / click / pointerup / keydown 這類事件是「使用者互動」,
// 觸控的 pointerdown 不算,所以要多監聽幾種;真的解鎖成功才拆掉監聽
const GESTURE_EVENTS = ['pointerup', 'touchend', 'click', 'keydown', 'pointerdown'] as const
async function onFirstGesture() {
  const ok = await unlockAudio()
  if (ok) {
    for (const ev of GESTURE_EVENTS) window.removeEventListener(ev, onFirstGesture)
  }
}

// === 手機軟鍵盤 ===
// 鍵盤彈出 → 切成緊湊版面塞進可見區,並把頁面釘住不被推上去。
// 不能用 vv.height / window.innerHeight 比較:viewport-fit 的 interactive-widget 會讓兩者
// 一起縮小,比例永遠不變。改成記住「沒有鍵盤時的可視高度」當基準,再看有沒有明顯變矮。
const kbOpen = ref(false)
const inputFocused = ref(false)
const KB_MIN_DROP = 100
let baseViewportH = 0

function onViewportChange() {
  const vv = window.visualViewport
  if (!vv) return
  const h = Math.round(vv.height)
  document.documentElement.style.setProperty('--vvh', `${h}px`)
  // 輸入框沒有 focus 時的高度才拿來當基準
  if (!inputFocused.value) baseViewportH = Math.max(baseViewportH, h)
  const shrunk = baseViewportH > 0 && h < baseViewportH - KB_MIN_DROP
  const open = sessionStarted.value && inputFocused.value && shrunk
  if (open !== kbOpen.value) kbOpen.value = open
  if (open) {
    // iOS 仍可能把整頁往上捲來露出輸入框;版面已經縮進可視區,捲回頂端即可
    window.scrollTo(0, 0)
  }
}

function onFocusIn(e: FocusEvent) {
  const el = e.target as HTMLElement | null
  if (el?.classList.contains('answer-input')) {
    inputFocused.value = true
    // 鍵盤動畫需要時間,多量幾次
    for (const d of [0, 60, 180, 350, 600]) setTimeout(onViewportChange, d)
  }
}
function onFocusOut(e: FocusEvent) {
  const el = e.target as HTMLElement | null
  if (el?.classList.contains('answer-input')) {
    inputFocused.value = false
    for (const d of [0, 120, 350]) setTimeout(onViewportChange, d)
  }
}

watch(sessionStarted, (started) => {
  if (!started) {
    inputFocused.value = false
    kbOpen.value = false
  }
  nextTick(onViewportChange)
})

function onVisibility() {
  if (document.visibilityState === 'hidden') {
    stopBgm()
    stopStudyTimer()
  } else {
    if (!sessionStarted.value) startBgm()
    if (studying.value) startStudyTimer()
    unlockAudio()
  }
}

function checkAnswer(value: string) {
  if (!current.value || locked.value) return
  const cleaned = value.trim().toLowerCase()
  if (!cleaned) return
  const accepts = current.value.accepts
  const exact = accepts.includes(cleaned)
  const partialMatch = accepts.some((a) => a.startsWith(cleaned))

  // === 測驗模式 ===
  if (testActive.value && !testFinished.value) {
    if (exact) {
      feedback.value = 'good'
      sfx('don')
      locked.value = true
      review(current.value.id, true, firstTry.value)
      sessionCorrect.value += 1
      bumpCombo()
      testResults.value.push('ok')
      testAnswer(current.value.id, true)
      if (settings.value.autoPlaySound) speak(current.value.char)
      setTimeout(() => next_test_card_or_finish(), 500)
      return
    }
    const longestT = Math.max(...accepts.map((a) => a.length))
    if (!partialMatch || cleaned.length >= longestT) {
      feedback.value = 'bad'
      sfx('fail')
      locked.value = true
      review(current.value.id, false, false)
      sessionWrong.value += 1
      resetCombo()
      testResults.value.push('ng')
      testAnswer(current.value.id, false)
      setTimeout(() => next_test_card_or_finish(), 700)
    }
    return
  }

  // === 重點練習模式 ===
  if (focusActive.value && !focusFinished.value) {
    // 新字:看著讀法打對 → 標成已學(不記分),送回隊尾之後正常練
    if (isNewCard.value) {
      if (exact) {
        feedback.value = 'good'
        sfx('don')
        locked.value = true
        introduceCard(current.value.id)
        focusAnswer(current.value.id, false)
        setTimeout(() => next_focus_card_or_finish(), 500)
      } else {
        const longestN = Math.max(...accepts.map((a) => a.length))
        if (!partialMatch || cleaned.length >= longestN) {
          feedback.value = 'bad'
          sfx('fail')
          locked.value = true
          setTimeout(() => {
            // 打錯就再來一次,不換卡
            input.value = ''
            feedback.value = 'idle'
            locked.value = false
            nextTick(() => inputEl.value?.focus())
          }, 500)
        }
      }
      return
    }
    // 看過答案後輸入 → 不紀錄、不計分,直接送回隊尾
    if (showAnswer.value) {
      feedback.value = exact ? 'good' : 'bad'
      locked.value = true
      focusAnswer(current.value.id, false)
      setTimeout(() => next_focus_card_or_finish(), 500)
      return
    }
    if (exact) {
      feedback.value = 'good'
      sfx('don')
      locked.value = true
      review(current.value.id, true, firstTry.value)
      if (firstTry.value) {
        sessionCorrect.value += 1
        bumpCombo()
      }
      focusAnswer(current.value.id, true)
      if (settings.value.autoPlaySound) speak(current.value.char)
      setTimeout(() => next_focus_card_or_finish(), 500)
      return
    }
    const longestF = Math.max(...accepts.map((a) => a.length))
    if (!partialMatch || cleaned.length >= longestF) {
      feedback.value = 'bad'
      sfx('fail')
      if (wrongCount.value === 0) {
        firstTry.value = false
        sessionWrong.value += 1
        resetCombo()
        review(current.value.id, false, false)
      }
      wrongCount.value += 1
      focusAnswer(current.value.id, false)
      locked.value = true
      setTimeout(() => next_focus_card_or_finish(), 600)
    }
    return
  }
}

function revealFocusAnswer() {
  if (!current.value) return
  showAnswer.value = true
  if (settings.value.autoPlaySound) speakKana(current.value.char)
  nextTick(() => inputEl.value?.focus())
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
  // 語音品質排序:iOS/macOS 的加強版 (Enhanced/Premium/Siri) > 本地 Kyoko/O-ren > 其他本地 > 網路語音
  const score = (v: SpeechSynthesisVoice) => {
    const name = v.name.toLowerCase()
    let sc = 0
    if (/enhanced|premium|siri|neural/.test(name)) sc += 100
    if (/kyoko|o-ren|hattori|ichiro|otoya/.test(name)) sc += 40
    if (v.localService) sc += 20
    if (/google/.test(name)) sc -= 10
    return sc
  }
  jaVoice.value = [...ja].sort((a, b) => score(b) - score(a))[0]
}

// 喇叭按鈕:只唸該假名本身的短音,不加長音,避免新手把「あー」當成正確讀法
function speakKana(char: string) {
  speak(char, 0.8)
}

function speak(text: string, rate = 0.85) {
  if (typeof window === 'undefined' || !window.speechSynthesis) {
    console.warn('[speak] speechSynthesis 不支援')
    return
  }
  const synth = window.speechSynthesis
  if (!jaVoice.value) loadVoice()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'ja-JP'
  u.rate = rate
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
  if (current.value) speakKana(current.value.char)
}

let speechKeepAlive: number | null = null

onMounted(() => {
  loadVoice()
  initCloudSync()
  for (const ev of GESTURE_EVENTS) window.addEventListener(ev, onFirstGesture, { passive: true })
  document.addEventListener('visibilitychange', onVisibility)
  // 載入時先試著直接啟動:瀏覽器若放行(常來的網站、同分頁再次進入)就不用等點擊
  unlockAudio()
  window.visualViewport?.addEventListener('resize', onViewportChange)
  window.visualViewport?.addEventListener('scroll', onViewportChange)
  document.addEventListener('focusin', onFocusIn)
  document.addEventListener('focusout', onFocusOut)
  onViewportChange()
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
  document.removeEventListener('visibilitychange', onVisibility)
  window.visualViewport?.removeEventListener('resize', onViewportChange)
  window.visualViewport?.removeEventListener('scroll', onViewportChange)
  document.removeEventListener('focusin', onFocusIn)
  document.removeEventListener('focusout', onFocusOut)
  stopStudyTimer()
  stopBgm()
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
    finishTrace()
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

type PoolGroup = 'bottom' | 'top' | 'mid' | 'unintroduced' | 'locked'
interface CardStat {
  pool: PoolGroup
  accuracy: number
  reps: number
  lapses: number
  introduced: boolean
}

const cardStatsMap = computed<Map<string, CardStat>>(() => {
  const map = new Map<string, CardStat>()
  // 使用 effectiveAccuracy (最近 N 次 / 終身) 跟池子建構同步,
  // 否則格子顏色 (lifetime) 跟重點池選卡 (recent) 會不一致
  const intro = ALL_KANA
    .map((k) => ({ entry: k, state: getCardState(k.id) }))
    .filter((x) => x.state?.introduced)
    .map(({ entry, state }) => ({
      entry,
      state: state!,
      accuracy: effectiveAccuracy(state!),
      streak: state!.correctStreak ?? 0,
    }))

  // 同 buildFocusPool 的 stillStuck 邏輯
  const bottomIds = new Set(
    [...intro]
      .filter((x) => x.streak < 3 && x.accuracy < 0.9)
      .sort((a, b) => a.accuracy - b.accuracy || b.state.reps - a.state.reps)
      .slice(0, 6)
      .map((x) => x.entry.id),
  )

  for (const k of ALL_KANA) {
    const state = getCardState(k.id)
    if (!isUnlocked(k.id)) {
      map.set(k.id, { pool: 'locked', accuracy: 0, reps: 0, lapses: 0, introduced: false })
      continue
    }
    if (!state?.introduced) {
      map.set(k.id, { pool: 'unintroduced', accuracy: 0, reps: 0, lapses: 0, introduced: false })
      continue
    }
    const accuracy = effectiveAccuracy(state)
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
  <div class="page" :class="{ 'kb-open': kbOpen, 'in-session': sessionStarted, 'no-track': !settings.bgm }">
    <div v-if="!sessionStarted" class="ichimatsu-band"></div>
    <Confetti v-if="onDoneScreen" :key="doneKey" :intensity="celebrationIntensity" />
    <header class="topbar">
      <div class="brand">
        <span class="brand-main disp">五十音道場</span>
        <span class="brand-sub">ゴジュウオン・ドウジョウ</span>
      </div>
      <div class="topbar-stats">
        <button
          class="btn-icon"
          :class="{ active: showHistory }"
          @click="sfx('ka'); showHistory = !showHistory; if (showHistory) showSettings = false"
          title="紀錄"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10" /><path d="M10 20V4" /><path d="M16 20v-8" /><path d="M22 20H2" /></svg>
        </button>
        <button
          class="btn-icon"
          :class="{ active: showSettings }"
          @click="sfx('ka'); showSettings = !showSettings; if (showSettings) showHistory = false"
          title="設定"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>
        </button>
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
          <span class="pool-tag pool-locked">🔒 未解鎖</span>
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
                  :style="cell.entry && cardStatsMap.get(cell.entry.id)?.introduced
                    ? { '--acc-pct': Math.round(cardStatsMap.get(cell.entry.id)!.accuracy * 100) + '%' }
                    : null"
                  :title="cell.entry
                    ? cell.entry.char + ' ' + cell.entry.romaji + (cardStatsMap.get(cell.entry.id)?.introduced
                        ? ' · ' + Math.round(cardStatsMap.get(cell.entry.id)!.accuracy * 100) + '%'
                        : '')
                    : ''"
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
                      <span class="cell-stat">
                        <span class="stat-label">練</span>
                        <span class="stat-num">{{ cardStatsMap.get(cell.entry.id)!.reps }}</span>
                      </span>
                      <span class="cell-stat">
                        <span class="stat-label">失</span>
                        <span class="stat-num">{{ cardStatsMap.get(cell.entry.id)!.lapses }}</span>
                      </span>
                    </div>
                    <div v-else-if="cardStatsMap.get(cell.entry.id)?.pool === 'locked'" class="cell-stats cell-stats-unintroduced">🔒</div>
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
                  :style="cell.entry && cardStatsMap.get(cell.entry.id)?.introduced
                    ? { '--acc-pct': Math.round(cardStatsMap.get(cell.entry.id)!.accuracy * 100) + '%' }
                    : null"
                  :title="cell.entry
                    ? cell.entry.char + ' ' + cell.entry.romaji + (cardStatsMap.get(cell.entry.id)?.introduced
                        ? ' · ' + Math.round(cardStatsMap.get(cell.entry.id)!.accuracy * 100) + '%'
                        : '')
                    : ''"
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
                      <span class="cell-stat">
                        <span class="stat-label">練</span>
                        <span class="stat-num">{{ cardStatsMap.get(cell.entry.id)!.reps }}</span>
                      </span>
                      <span class="cell-stat">
                        <span class="stat-label">失</span>
                        <span class="stat-num">{{ cardStatsMap.get(cell.entry.id)!.lapses }}</span>
                      </span>
                    </div>
                    <div v-else-if="cardStatsMap.get(cell.entry.id)?.pool === 'locked'" class="cell-stats cell-stats-unintroduced">🔒</div>
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
          <span class="setting-label">學習順序</span>
          <div class="toggle-group">
            <button
              class="toggle"
              :class="{ active: settings.stageMode === 'separate' }"
              @click="updateSettings({ stageMode: 'separate' })"
            >分開學</button>
            <button
              class="toggle"
              :class="{ active: settings.stageMode === 'mixed' }"
              @click="updateSettings({ stageMode: 'mixed' })"
            >一起學</button>
          </div>
        </div>
        <p class="setting-note muted">
          分開學:平假名 10 關全通過後才開始片假名。一起學:每一關同時練同一行的平假名與片假名。
          只勾選一種假名時沒有差別。
        </p>
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
          <span class="setting-label">音效</span>
          <button class="toggle" :class="{ active: settings.sfx }" @click="toggleSfx">
            {{ settings.sfx ? '開' : '關' }}
          </button>
        </div>
        <div class="setting-row">
          <span class="setting-label">背景音樂(首頁)</span>
          <button class="toggle" :class="{ active: settings.bgm }" @click="toggleBgm">
            {{ settings.bgm ? '開' : '關' }}
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

      <section v-if="!sessionStarted" class="hero-taiko">
        <div class="drum-wrap">
          <div class="drum">
            <div class="drum-face" :class="{ 'two-lines': (stageInfo.current?.charLines.length ?? 1) > 1 }">
              <template v-if="stageInfo.current">
                <div class="drum-sub">第 {{ stageInfo.unlocked }} 關 · {{ scriptShort(stageInfo.current.script) }}</div>
                <div class="drum-label disp">{{ stageInfo.current.label }}</div>
                <div
                  v-for="(line, li) in stageInfo.current.charLines"
                  :key="li"
                  class="drum-chars disp"
                >{{ line.join('') }}</div>
              </template>
              <template v-else>
                <div class="drum-sub">{{ stageInfo.total }} / {{ stageInfo.total }} 關</div>
                <div class="drum-label disp">全通關</div>
                <div class="drum-chars disp">ぜんクリア</div>
              </template>
            </div>
          </div>
          <div class="drum-badges">
            <div v-if="stageInfo.current" class="badge-pill">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z" /></svg>
              <span class="disp">已學 {{ stageRows[stageInfo.unlocked - 1]?.introduced ?? 0 }} / {{ stageInfo.current.chars.length }}</span>
            </div>
            <div class="badge-pill badge-pill-alt">
              <span class="disp">今日 {{ todayStudyMin }}m {{ todayStudySec }}s · {{ todayAccuracy }}%</span>
            </div>
          </div>
          <button v-if="settings.bgm" class="track-chip" :title="bgmPlaying ? '換下一首' : '點一下頁面後開始播放'" @click="onNextTrack">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M9 3v12.3a3.5 3.5 0 1 0 2 3.2V8h6V3H9z" /></svg>
            <span>{{ bgmPlaying ? trackName : '點一下開始播放' }}</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4l10 8-10 8z" /><path d="M19 4v16" /></svg>
          </button>
        </div>

        <button class="start-btn disp" @click="startFocus">開始練習</button>

        <div class="mode-grid">
          <button class="mode-pill mode-normal" :class="{ ready: stageReadyToTest }" @click="startTest">
            <span v-if="stageReadyToTest" class="mode-badge disp">解鎖！</span>
            <span class="mode-jp disp">ローマ字</span>
            <span class="mode-zh">拼音測驗</span>
          </button>
          <button class="mode-pill mode-trace" @click="startTrace">
            <span class="mode-jp disp">かきとり</span>
            <span class="mode-zh">手寫測驗</span>
          </button>
        </div>

        <div class="stage-list">
          <div class="stage-list-head">
            <span class="disp stage-list-title">關卡一覽</span>
            <span class="stage-list-rule"></span>
            <span class="stage-list-sub">ステージをえらぶ</span>
          </div>
          <div
            v-for="row in visibleStageRows"
            :key="row.stage.index"
            class="stage-row"
            :class="row.status"
          >
            <div class="stage-tab disp">{{ row.stage.chars[0] }}</div>
            <div class="stage-body">
              <div class="stage-row-chars disp" :class="{ two: row.stage.charLines.length > 1 }">
                <span v-for="(line, li) in row.stage.charLines" :key="li">{{ line.join('') }}</span>
              </div>
              <div v-if="row.status === 'passed'" class="stage-row-status">クリア！ 準確率 {{ row.accuracy }}%</div>
              <div v-else-if="row.status === 'current' && row.introduced >= row.total" class="stage-row-status">已學 {{ row.total }} / {{ row.total }} · 拼音測驗全對即解鎖下一關</div>
              <div v-else-if="row.status === 'current'" class="stage-row-status">挑戰中 · 已學 {{ row.introduced }} / {{ row.total }}</div>
              <div v-else-if="row.stage.index === stageInfo.unlocked" class="stage-row-status">通過 {{ row.prevLabel }} 後解鎖</div>
              <div v-else class="stage-row-status">{{ scriptName(row.stage.script) }}</div>
            </div>
            <div v-if="row.status !== 'locked'" class="stage-stars">
              <svg v-for="i in 3" :key="i" width="18" height="18" viewBox="0 0 24 24" :fill="i <= row.stars ? 'var(--star)' : 'var(--panel)'" stroke="var(--ink)" stroke-width="2" stroke-linejoin="round"><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z" /></svg>
            </div>
            <svg v-else class="stage-lock" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
          </div>
          <button v-if="hiddenStageCount > 0" class="stage-more" @click="sfx('ka'); showAllStages = true">
            <span>其餘 {{ hiddenStageCount }} 關</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6" /></svg>
          </button>
          <button v-else-if="showAllStages" class="stage-more" @click="sfx('ka'); showAllStages = false">
            <span>收合</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 15l-6-6-6 6" /></svg>
          </button>
        </div>
      </section>

      <section v-else-if="traceActive && !writeFinished" class="panel session trace-panel">
        <div class="session-bar">
          <div class="quiz-title disp">手寫測驗</div>
          <div class="session-meta disp">
            <span class="ok">✓{{ writeCorrectIds.length }}</span>
            <span class="ng">✗{{ writeWrongIds.length }}</span>
            <span>{{ writeAnswered }} / {{ writeTotal }}</span>
            <span class="session-clock">{{ fmtClock(sessionSeconds) }}</span>
          </div>
          <button class="btn-ghost arcade" @click="finishTrace">結束</button>
        </div>

        <div class="gauge">
          <span
            v-for="i in writeTotal"
            :key="i"
            class="gauge-cell"
            :class="writeResults[i - 1] === 'ok' ? 'on good' : writeResults[i - 1] === 'ng' ? 'on bad' : ''"
          ></span>
        </div>

        <div v-if="traceCard" class="trace-wrap">
          <div class="combo-row">
            <transition name="pop">
              <span v-if="combo >= 2" :key="combo" class="combo-pill disp">{{ combo }} コンボ</span>
            </transition>
          </div>
          <div class="trace-head">
            <span class="chip-tag">{{ traceCard.script === 'hiragana' ? '平假名' : '片假名' }}</span>
            <span class="trace-romaji disp">{{ traceCard.romaji }}</span>
            <button v-if="ttsSupported" class="speak-btn arcade" title="播放讀音" @click="playTrace">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M18.5 5.5a9 9 0 0 1 0 13" /></svg>
            </button>
          </div>
          <p class="trace-prompt">{{ writeRevealed ? '和正確字形比對,再選你寫對了沒' : '寫出這個音的假名' }}</p>

          <TraceBoard ref="traceBoard" :char="traceCard.char" :show-guide="writeRevealed" />

          <div class="trace-tools">
            <button class="btn-ghost arcade small" @click="traceBoard?.undo()">上一筆</button>
            <button class="btn-ghost arcade small" @click="traceBoard?.clear()">清除</button>
          </div>

          <div v-if="!writeRevealed" class="trace-nav">
            <button class="primary big disp" @click="writeReveal">對答案</button>
          </div>
          <div v-else class="trace-nav">
            <button class="judge-btn wrong disp" @click="writeJudge(false)">沒寫對</button>
            <button class="judge-btn right disp" @click="writeJudge(true)">寫對了</button>
          </div>

          <p class="muted trace-note">
            憑記憶寫,按「對答案」把正確字形疊上來比對,再誠實選寫對了沒。
            自評只算這場成績,不影響練習與解鎖。
          </p>
        </div>
      </section>

      <section v-else-if="writeFinished" class="panel session trace-done-panel celebrate">
        <div class="sunburst"></div>
        <div class="done-banner">
          <div class="done-title disp">終了！</div>
          <div v-if="fullCombo" class="full-combo disp">フルコンボ！</div>
          <div class="done-sub">手寫測驗 · {{ writeTotal }} 張 · {{ fmtClock(sessionSeconds) }}</div>
        </div>
        <div class="done-stats">
          <div class="done-stat good">
            <span class="done-num disp">{{ writeCorrectIds.length }}</span>
            <span class="done-label">寫對</span>
          </div>
          <div class="done-stat bad">
            <span class="done-num disp">{{ writeWrongIds.length }}</span>
            <span class="done-label">沒寫對</span>
          </div>
          <div class="done-stat combo">
            <span class="done-num disp">{{ comboBest }}</span>
            <span class="done-label">最高コンボ</span>
          </div>
        </div>
        <div v-if="writeWrongCards.length > 0" class="quiz-failed-list">
          <div class="quiz-failed-label muted">要再練的字 ({{ writeWrongCards.length }})</div>
          <div class="quiz-failed-chips">
            <span v-for="k in writeWrongCards" :key="k.id" class="quiz-failed-chip">
              {{ k.char }}
              <span class="quiz-failed-romaji">{{ k.romaji }}</span>
            </span>
          </div>
        </div>
        <button class="primary big disp" @click="finishTrace">回到首頁</button>
      </section>

      <section v-else-if="testActive && !testFinished" class="panel session test-panel">
        <div class="session-bar">
          <div class="quiz-title disp">拼音測驗</div>
          <div class="session-meta disp">
            <span class="ok">✓{{ testCorrectIds.length }}</span>
            <span class="ng">✗{{ testWrongIds.length }}</span>
            <span>{{ testAnswered }} / {{ testTotal }}</span>
            <span class="session-clock">{{ fmtClock(sessionSeconds) }}</span>
          </div>
          <button class="btn-ghost arcade" @click="finishTest">結束</button>
        </div>

        <!-- 量表:每題一格,依對錯上色 -->
        <div class="gauge">
          <template v-if="testTotal <= 24">
            <span
              v-for="i in testTotal"
              :key="i"
              class="gauge-cell"
              :class="testResults[i - 1] === 'ok' ? 'on good' : testResults[i - 1] === 'ng' ? 'on bad' : ''"
            ></span>
          </template>
          <span v-else class="gauge-bar"><span class="gauge-fill" :style="{ width: (testAnswered / testTotal) * 100 + '%' }"></span></span>
        </div>

        <div v-if="current" class="card focus-card" :data-state="feedback">
          <div class="combo-row">
            <transition name="pop">
              <span v-if="combo >= 2" :key="combo" class="combo-pill disp">{{ combo }} コンボ</span>
            </transition>
          </div>
          <div class="kana-face-wrap">
            <div class="kana-face">
              <div class="kana">{{ current.char }}</div>
            </div>
            <button v-if="ttsSupported" class="speak-btn arcade" title="播放讀音" @click="playCurrent">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M18.5 5.5a9 9 0 0 1 0 13" /></svg>
            </button>
          </div>
          <div class="tag-row">
            <span class="chip-tag">{{ current.script === 'hiragana' ? '平假名' : '片假名' }}</span>
            <span class="chip-tag chip-test disp">拼音</span>
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
            <button class="btn-ghost arcade small" @click="skipTestCard">我不會</button>
            <span class="quiz-hint muted">每張只問一次,不提示</span>
          </div>
        </div>
      </section>

      <section v-else-if="testFinished" class="panel session test-done-panel celebrate" :class="{ passed: lastStageResult?.passed }">
        <div v-if="lastStageResult?.passed" class="sunburst"></div>
        <div class="done-banner">
          <div class="done-title disp">{{ lastStageResult?.passed ? '合格！' : '終了' }}</div>
          <div v-if="fullCombo" class="full-combo disp">フルコンボ！</div>
          <div class="done-sub">拼音測驗 · {{ testTotal }} 張 · {{ fmtClock(sessionSeconds) }}</div>
        </div>
        <div v-if="lastStageResult" class="stage-result" :class="lastStageResult.passed ? 'pass' : 'fail'">
          <template v-if="lastStageResult.passed">
            🎉 通過「{{ lastStageResult.stage.label }}」!
            <span v-if="lastStageResult.next">已解鎖下一關:{{ lastStageResult.next.script === 'hiragana' ? '平假名' : '片假名' }} {{ lastStageResult.next.label }}</span>
            <span v-else>五十音全部通關!</span>
          </template>
          <template v-else>
            「{{ lastStageResult.stage.label }}」還沒通過 —— 錯了
            {{ lastStageResult.wrongInStage.length }} 個,全部一次答對才解鎖下一關。
          </template>
        </div>
        <div class="quiz-summary-row">
          <span class="ok">對 {{ testCorrectIds.length }}</span>
          <span class="ng">錯 {{ testWrongIds.length }}</span>
          <span class="muted">共 {{ testTotal }} 張</span>
        </div>
        <div v-if="testWrongCards.length > 0" class="quiz-failed-list">
          <div class="quiz-failed-label muted">忘記的字 ({{ testWrongCards.length }})</div>
          <div class="quiz-failed-chips">
            <span v-for="k in testWrongCards" :key="k.id" class="quiz-failed-chip">
              {{ k.char }}
              <span class="quiz-failed-romaji">{{ k.romaji }}</span>
            </span>
          </div>
        </div>
        <div v-if="testCorrectCards.length > 0" class="quiz-failed-list">
          <div class="quiz-failed-label muted">答對的字 ({{ testCorrectCards.length }})</div>
          <div class="quiz-failed-chips">
            <span v-for="k in testCorrectCards" :key="k.id" class="quiz-failed-chip quiz-correct-chip">
              {{ k.char }}
              <span class="quiz-failed-romaji">{{ k.romaji }}</span>
            </span>
          </div>
        </div>
        <p class="muted focus-done-note">
          答錯的字 streak 已歸零,下次重點練習它們會回到 Bottom 6。
        </p>
        <button class="primary big disp" @click="finishTest">回到首頁</button>
      </section>

      <section v-else-if="focusActive && !focusFinished" class="panel session focus-panel">
        <div class="session-bar">
          <div class="quiz-title disp">重點練習</div>
          <div class="session-meta disp">
            <span>{{ focusCorrectCount }} / {{ focusInitialSize }}</span>
            <span class="session-clock">{{ fmtClock(sessionSeconds) }}</span>
          </div>
          <button class="btn-ghost arcade" @click="finishFocus">結束</button>
        </div>

        <!-- 魂ゲージ:每張出隊亮一格 -->
        <div class="gauge" :class="{ full: focusCorrectCount >= focusInitialSize }">
          <template v-if="focusInitialSize <= 14">
            <span
              v-for="i in focusInitialSize"
              :key="i"
              class="gauge-cell"
              :class="{ on: i <= focusCorrectCount }"
            ></span>
          </template>
          <span v-else class="gauge-bar"><span class="gauge-fill" :style="{ width: focusProgress + '%' }"></span></span>
        </div>

        <div v-if="current" class="card focus-card" :data-state="feedback">
          <div class="combo-row">
            <transition name="pop">
              <span v-if="combo >= 2" :key="combo" class="combo-pill disp">{{ combo }} コンボ</span>
            </transition>
          </div>

          <div class="kana-face-wrap">
            <div class="kana-face" :class="{ 'with-reading': isNewCard }">
              <div class="kana">{{ current.char }}</div>
              <div v-if="isNewCard" class="kana-reading disp">{{ current.romaji }}</div>
            </div>
            <button
              v-if="ttsSupported"
              class="speak-btn arcade"
              :title="settings.autoPlaySound ? '播放讀音' : '播放讀音 (自動播放已關)'"
              @click="playCurrent"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4V5z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M18.5 5.5a9 9 0 0 1 0 13" /></svg>
            </button>
          </div>

          <div class="tag-row">
            <span class="chip-tag">{{ current.script === 'hiragana' ? '平假名' : '片假名' }}</span>
            <span v-if="isNewCard" class="chip-tag chip-new disp">新字</span>
            <span v-else class="chip-tag chip-focus disp">重點</span>
            <span class="focus-progress-dots" :title="`已對 ${focusProgressFor(current.id).done}/${focusProgressFor(current.id).needed} 次`">
              <span
                v-for="i in focusProgressFor(current.id).needed"
                :key="i"
                class="focus-dot"
                :class="{ filled: i <= focusProgressFor(current.id).done }"
              ></span>
            </span>
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
            :placeholder="isNewCard ? `照著打 ${current.romaji}` : '輸入羅馬字'"
            @keydown.enter.prevent="checkAnswer(input)"
          />

          <div v-if="isNewCard" class="hint-row">
            <span class="new-card-note muted">新字:照著讀法打一次就記為已學,之後不再提示</span>
          </div>
          <div v-else class="hint-row">
            <button
              v-if="!showAnswer"
              class="btn-ghost arcade small"
              @click="revealFocusAnswer"
            >不會(看答案)</button>
            <span v-else class="answer-shown">
              答案 <strong class="disp">{{ current.romaji }}</strong>
              <span class="answer-note muted">看了不記分,需再答對一次才出隊</span>
            </span>
          </div>
        </div>
      </section>

      <section v-else-if="focusFinished" class="panel session focus-done-panel celebrate">
        <div class="sunburst"></div>
        <div class="done-banner">
          <svg class="done-star s1" width="26" height="26" viewBox="0 0 24 24" fill="var(--star)" stroke="var(--ink)" stroke-width="2" stroke-linejoin="round"><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z" /></svg>
          <svg class="done-star s2" width="18" height="18" viewBox="0 0 24 24" fill="var(--bad)" stroke="var(--ink)" stroke-width="2" stroke-linejoin="round"><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z" /></svg>
          <svg class="done-star s3" width="22" height="22" viewBox="0 0 24 24" fill="var(--accent)" stroke="var(--ink)" stroke-width="2" stroke-linejoin="round"><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4 6.1 20.5l1.2-6.5L2.5 9.4l6.6-.9z" /></svg>
          <div class="done-title disp">完了！</div>
          <div v-if="fullCombo" class="full-combo disp">フルコンボ！</div>
          <div class="done-sub">重點練習 · {{ focusInitialSize }} 張全部出隊 · {{ fmtClock(sessionSeconds) }}</div>
        </div>
        <div class="done-stats">
          <div class="done-stat good">
            <span class="done-num disp">{{ sessionCorrect }}</span>
            <span class="done-label">一次答對</span>
          </div>
          <div class="done-stat bad">
            <span class="done-num disp">{{ sessionWrong }}</span>
            <span class="done-label">答錯</span>
          </div>
          <div class="done-stat combo">
            <span class="done-num disp">{{ comboBest }}</span>
            <span class="done-label">最高コンボ</span>
          </div>
        </div>
        <p v-if="stageReadyToTest && stageInfo.current" class="muted focus-done-note">
          {{ stageInfo.current.label }} 的字都學過了。隔一段時間再來拼音測驗,一次全對就解鎖下一關 ——
          剛練完馬上測驗考的是短期記憶,過了也不代表真的記住。
        </p>
        <p v-else class="muted focus-done-note">
          這場練過的字準確率會被推高;下次再開會自動挑當下最弱的 6 張 + 目前關卡的新字。
        </p>
        <button class="primary big disp" @click="finishFocus">回到首頁</button>
      </section>

    </main>
  </div>
</template>

<style scoped>
.page {
  position: relative;
  width: 100%;
  max-width: 720px;
  margin: 0 auto;
  padding: 24px 20px 60px;
}
.disp {
  font-family: var(--font-display);
  font-weight: 900;
}

/* ===== 軟鍵盤開啟時的緊湊版面 ===== */
/* 鼓面大小跟著可視高度走,鍵盤把畫面壓到很矮時也塞得下 */
.page.in-session.kb-open {
  --drum: min(168px, calc(var(--vvh, 500px) * 0.36));
  position: fixed;
  inset: 0;
  height: var(--vvh, 100%);
  overflow-y: auto;
  padding: 6px 14px 10px;
}
.page.in-session.kb-open .topbar { display: none; }
.page.in-session.kb-open .panel.session {
  padding: 12px 14px;
  margin-bottom: 0;
  border: none;
  box-shadow: none;
  background: transparent;
}
.page.in-session.kb-open .session-bar { margin-bottom: 8px; }
.page.in-session.kb-open .quiz-title.disp { font-size: 16px; }
.page.in-session.kb-open .btn-ghost.arcade { padding: 6px 12px; font-size: 13px; }
.page.in-session.kb-open .gauge { margin: 0 0 4px; padding: 3px; }
.page.in-session.kb-open .gauge-cell,
.page.in-session.kb-open .gauge-bar { height: 8px; }
.page.in-session.kb-open .combo-row { height: 24px; }
.page.in-session.kb-open .card { padding: 4px 0; }
.page.in-session.kb-open .panel.session::before { display: none; }
.page.in-session.kb-open .kana-face-wrap {
  width: var(--drum);
  height: var(--drum);
  margin: 0 auto 6px;
}
.page.in-session.kb-open .kana-face-wrap::before { box-shadow: 0 4px 0 var(--ink); }
.page.in-session.kb-open .kana-face { inset: calc(var(--drum) * 0.09); }
.page.in-session.kb-open .kana-face .kana { font-size: calc(var(--drum) * 0.60); }
.page.in-session.kb-open .kana-face.with-reading .kana { font-size: calc(var(--drum) * 0.50); }
.page.in-session.kb-open .kana-reading { font-size: calc(var(--drum) * 0.14); margin-top: 0; }
.page.in-session.kb-open .new-card-note { display: none; }
.page.in-session.kb-open .kana-face-wrap .speak-btn { width: 38px; height: 38px; right: -8px; bottom: -2px; }
.page.in-session.kb-open .kana { font-size: 96px; margin: 0; }
.page.in-session.kb-open .tag-row { margin-bottom: 8px; }
.page.in-session.kb-open .learn-hint { padding: 6px 12px; margin: 0 auto 8px; gap: 0; box-shadow: none; }
.page.in-session.kb-open .learn-hint-romaji { font-size: 20px; }
.page.in-session.kb-open .learn-hint-note { display: none; }
.page.in-session.kb-open .answer-input { font-size: 22px; padding: 8px 12px; }
.page.in-session.kb-open .hint-row { margin-top: 8px; }
.page.in-session.kb-open .answer-note { display: none; }
.page.in-session.kb-open .quiz-hint,
.page.in-session.kb-open .trace-note { display: none; }
.page.in-session.kb-open .focus-progress-bar { margin: -6px 0 8px; }
/* 市松格頭帶:只在首頁出現 */
.ichimatsu-band {
  /* 滿版出血:不受 .page 的 720px 限制,寬螢幕也貼到視窗兩側 */
  position: absolute;
  top: 0;
  left: 50%;
  width: 100vw;
  margin-left: -50vw;
  height: 444px;
  background-color: var(--accent);
  background-image:
    linear-gradient(45deg, var(--accent-check) 25%, transparent 25%, transparent 75%, var(--accent-check) 75%),
    linear-gradient(45deg, var(--accent-check) 25%, transparent 25%, transparent 75%, var(--accent-check) 75%);
  background-size: 28px 28px;
  background-position: 0 0, 14px 14px;
  border-radius: 0 0 40px 40px;
  z-index: 0;
  pointer-events: none;
  /* 市松格斜向捲動:位移一整格 (28px) 後與起點重合,循環無接縫 */
  animation: ichimatsu-scroll 6s linear infinite;
  will-change: background-position;
}
/* 背景音樂關閉時沒有曲名標籤,頭帶跟著縮短 */
.page.no-track .ichimatsu-band { height: 404px; }
@keyframes ichimatsu-scroll {
  from { background-position: 0 0, 14px 14px; }
  to { background-position: 28px 28px, 42px 42px; }
}
@media (prefers-reduced-motion: reduce) {
  .ichimatsu-band { animation: none; }
}
.topbar, main { position: relative; z-index: 1; }

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;
  flex-wrap: wrap;
  gap: 12px;
}
.brand {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.brand-main {
  font-size: 24px;
  letter-spacing: 0.08em;
  paint-order: stroke fill;
  -webkit-text-stroke: 5px var(--panel);
  text-shadow: 0 3px 0 rgba(var(--ink-rgb), 0.18);
}
.brand-sub {
  font-size: 10px;
  letter-spacing: 0.24em;
  color: var(--accent-text);
  font-weight: 700;
}
.topbar-stats {
  display: flex;
  gap: 8px;
  align-items: center;
}
.btn-icon {
  background: var(--panel);
  border: 3px solid var(--ink);
  box-shadow: 0 3px 0 var(--ink);
  color: var(--ink);
  width: 44px;
  height: 44px;
  border-radius: 14px;
  font-size: 14px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.08s, box-shadow 0.08s;
}
.btn-icon:hover { background: var(--panel-2); }
.btn-icon:active,
.btn-icon.active {
  transform: translateY(3px);
  box-shadow: 0 0 0 var(--ink);
}
.account-btn {
  width: auto;
  padding: 0 12px;
  font-size: 13px;
}
.account-btn.signed-in {
  border-color: var(--accent-text);
  color: var(--accent-text);
}

.panel {
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 28px;
  margin-bottom: 16px;
  box-shadow: 0 1px 2px rgba(var(--ink-rgb), 0.04), 0 8px 24px rgba(var(--ink-rgb), 0.05);
}

.exam-banner {
  display: flex;
  align-items: center;
  gap: 12px;
  background: linear-gradient(90deg, rgba(var(--bad-rgb), 0.15), rgba(var(--accent-rgb), 0.10));
  border: 1px solid rgba(var(--bad-rgb), 0.35);
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

.panel h3,
.panel h4 {
  position: relative;
  padding-bottom: 8px;
  margin-bottom: 14px;
}
.panel h3::after,
.panel h4::after {
  content: '';
  position: absolute;
  left: 0;
  bottom: 0;
  width: 28px;
  height: 2px;
  background: var(--accent);
}
.muted {
  color: var(--muted);
  font-size: 14px;
  margin: 0 0 20px;
  line-height: 1.6;
}

.primary {
  background: var(--accent);
  color: var(--on-accent);
  border: 3px solid var(--ink);
  box-shadow: 0 4px 0 var(--ink);
  border-radius: 14px;
  padding: 10px 18px;
  font-weight: 700;
  transition: transform 0.08s, box-shadow 0.08s;
}
.primary:active {
  transform: translateY(4px);
  box-shadow: 0 0 0 var(--ink);
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
.primary:hover { filter: brightness(1.04); }

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
.quiz-title.disp { font-size: 20px; letter-spacing: 0.1em; white-space: nowrap; }
.session-meta.disp { font-size: 13px; gap: 8px; letter-spacing: 0.04em; color: var(--muted); white-space: nowrap; }
.session-bar { gap: 8px; }
.session-bar .btn-ghost.arcade { white-space: nowrap; flex-shrink: 0; }
.session-clock { font-variant-numeric: tabular-nums; opacity: 0.8; }

/* 描邊版按鈕(結束 / 看答案 / 喇叭) */
.btn-ghost.arcade {
  background: var(--panel);
  color: var(--ink);
  border: 3px solid var(--ink);
  box-shadow: 0 3px 0 var(--ink);
  border-radius: 12px;
  font-weight: 700;
  padding: 8px 14px;
  transition: transform 0.08s, box-shadow 0.08s;
}
.btn-ghost.arcade.small { padding: 6px 12px; font-size: 12px; }
.btn-ghost.arcade:active { transform: translateY(3px); box-shadow: 0 0 0 var(--ink); }
.speak-btn.arcade {
  background: var(--panel);
  color: var(--ink);
  border: 3px solid var(--ink);
  box-shadow: 0 3px 0 var(--ink);
  width: 48px;
  height: 48px;
}
.speak-btn.arcade:active { transform: translateY(3px); box-shadow: 0 0 0 var(--ink); }

/* 魂ゲージ */
.gauge {
  display: flex;
  gap: 4px;
  padding: 5px;
  border: 3px solid var(--ink);
  border-radius: 999px;
  background: var(--panel-2);
  margin: -8px 0 6px;
}
.gauge-cell {
  flex: 1;
  height: 12px;
  border-radius: 999px;
  background: var(--border);
  transition: background 0.25s, box-shadow 0.25s;
}
.gauge-cell.on {
  background: var(--star);
  box-shadow: inset 0 -3px 0 rgba(var(--ink-rgb), 0.18);
}
.gauge.full .gauge-cell.on { background: var(--good); }
.gauge-cell.on.good { background: var(--good); }
.gauge-cell.on.bad { background: var(--bad); }
.gauge-fill.time { background: var(--accent); }
.gauge.low .gauge-fill.time { background: var(--bad); }
.chip-tag.chip-test { background: var(--star); }
.session-meta.disp .timer { font-size: 16px; color: var(--ink); }
.session-meta.disp .ok { color: var(--good); }
.session-meta.disp .ng { color: var(--bad); }
.hint-row .quiz-hint { margin: 0; font-size: 11px; }
.gauge-bar { flex: 1; height: 12px; border-radius: 999px; background: var(--border); overflow: hidden; }
.gauge-fill { display: block; height: 100%; background: var(--star); transition: width 0.3s ease; }

/* コンボ */
.combo-row { height: 34px; display: flex; justify-content: center; align-items: center; position: relative; }
.combo-pill {
  padding: 4px 14px;
  border-radius: 999px;
  background: var(--star);
  border: 3px solid var(--ink);
  box-shadow: 0 3px 0 var(--ink);
  font-size: 14px;
  letter-spacing: 0.1em;
  color: var(--ink);
}
.pop-enter-active { animation: pop-in 0.25s cubic-bezier(0.2, 1.4, 0.4, 1); }
.pop-leave-active { transition: opacity 0.12s; position: absolute; }
.pop-leave-to { opacity: 0; }
@keyframes pop-in {
  from { transform: scale(0.6); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}

/* ===== 練習 / 測驗 畫面的彩色填充 ===== */
.panel.session {
  position: relative;
  overflow: hidden;
  --band: var(--accent);
  --ring: var(--accent);
}
.panel.session.focus-panel { --band: var(--accent); --ring: var(--accent); }
.panel.session.test-panel { --band: var(--star); --ring: var(--star); }
.panel.session.trace-panel { --band: var(--good); --ring: var(--good); }
/* 頂部彩色市松格帶,session-bar 與量表坐在上面 */
.panel.session::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 128px;
  background-color: var(--band);
  background-image:
    linear-gradient(45deg, rgba(255, 255, 255, 0.28) 25%, transparent 25%, transparent 75%, rgba(255, 255, 255, 0.28) 75%),
    linear-gradient(45deg, rgba(255, 255, 255, 0.28) 25%, transparent 25%, transparent 75%, rgba(255, 255, 255, 0.28) 75%);
  background-size: 24px 24px;
  background-position: 0 0, 12px 12px;
  border-bottom: 3px solid var(--ink);
  z-index: 0;
  pointer-events: none;
}
.panel.session > * { position: relative; }
.panel.session .gauge { background: var(--panel); }
.trace-panel .session-meta.disp,
.trace-panel .session-meta.disp .ok,
.trace-panel .session-meta.disp .ng { color: var(--ink); }
/* 鼓面卡片:外圈彩色鼓身 + 內圈白色鼓面 */
.kana-face-wrap {
  position: relative;
  width: 244px;
  height: 244px;
  margin: 4px auto 14px;
}
.kana-face-wrap::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 999px;
  background: var(--ring);
  border: 4px solid var(--ink);
  box-shadow: 0 8px 0 var(--ink);
}
.kana-face {
  position: absolute;
  inset: 20px;
  border-radius: 999px;
  background: var(--panel);
  border: 4px solid var(--ink);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, transform 0.15s, border-color 0.15s;
}
.kana-face { flex-direction: column; }
.kana-face .kana { margin: 0; font-size: 118px; }
.kana-face.with-reading .kana { font-size: 100px; margin-top: -6px; }
.kana-reading {
  font-size: 26px;
  letter-spacing: 0.14em;
  padding-left: 0.14em;
  color: var(--accent-text);
  line-height: 1;
  margin-top: -4px;
}
.new-card-note { font-size: 12px; }
.focus-card[data-state='good'] .kana-face {
  background: rgba(var(--good-rgb), 0.18);
  transform: scale(1.04);
}
.focus-card[data-state='bad'] .kana-face {
  background: rgba(var(--bad-rgb), 0.16);
  animation: shake 0.3s;
}
.kana-face-wrap .speak-btn {
  position: absolute;
  right: 2px;
  bottom: 10px;
}

/* 標籤 */
.chip-tag {
  font-size: 11px;
  padding: 4px 10px;
  border-radius: 999px;
  border: 2px solid var(--ink);
  background: var(--panel);
  color: var(--ink);
  font-weight: 700;
}
.chip-new { background: var(--star); }
.chip-focus { background: var(--accent); }
.focus-progress-dots { display: inline-flex; gap: 4px; align-items: center; margin-left: 4px; }
.focus-dot {
  width: 14px;
  height: 14px;
  border-radius: 999px;
  border: 2px solid var(--ink);
  background: var(--panel);
  transition: background 0.2s;
}
.focus-dot.filled { background: var(--star); }

/* 完成畫面 */
.panel.session.celebrate { position: relative; overflow: hidden; }
/* 放射光墊在最底下,其餘內容(文字、卡片、按鈕)都疊在它上面 */
.panel.session.celebrate > .sunburst { z-index: 0; }
.panel.session.celebrate > :not(.sunburst) { position: relative; z-index: 1; }
/* 旋轉放射光 */
.sunburst {
  position: absolute;
  inset: -60%;
  background: repeating-conic-gradient(
    rgba(242, 193, 78, 0.22) 0deg 9deg,
    transparent 9deg 18deg
  );
  animation: sunburst-spin 28s linear infinite;
  pointer-events: none;
  mask-image: radial-gradient(circle at center, #000 0%, rgba(0, 0, 0, 0.55) 35%, transparent 62%);
  -webkit-mask-image: radial-gradient(circle at center, #000 0%, rgba(0, 0, 0, 0.55) 35%, transparent 62%);
}
@keyframes sunburst-spin { to { transform: rotate(360deg); } }
.done-banner { position: relative; text-align: center; margin: 4px 0 18px; }
.done-title {
  font-size: 52px;
  line-height: 1.1;
  color: var(--bad);
  paint-order: stroke fill;
  -webkit-text-stroke: 7px var(--panel);
  text-shadow: 4px 5px 0 var(--ink);
  animation: title-pop 0.55s cubic-bezier(0.2, 1.6, 0.4, 1) both;
}
.test-done-panel:not(.passed) .done-title { color: var(--ink); text-shadow: 0 4px 0 rgba(var(--ink-rgb), 0.18); }
@keyframes title-pop {
  from { transform: scale(0.3) rotate(-8deg); opacity: 0; }
  to { transform: scale(1) rotate(0); opacity: 1; }
}
.full-combo {
  display: inline-block;
  margin-top: 6px;
  padding: 4px 14px;
  border-radius: 999px;
  background: var(--star);
  border: 3px solid var(--ink);
  box-shadow: 0 3px 0 var(--ink);
  color: var(--ink);
  font-size: 14px;
  letter-spacing: 0.14em;
  transform: rotate(-4deg);
  animation: badge-pop 0.5s 0.35s cubic-bezier(0.2, 1.6, 0.4, 1) both;
}
@keyframes badge-pop {
  from { transform: rotate(-4deg) scale(0); }
  to { transform: rotate(-4deg) scale(1); }
}
.done-star { position: absolute; animation: twinkle 1.6s ease-in-out infinite; }
.done-star.s1 { left: 8%; top: -6px; }
.done-star.s2 { right: 12%; top: 4px; animation-delay: 0.4s; }
.done-star.s3 { right: 4%; bottom: 8px; animation-delay: 0.9s; }
@keyframes twinkle {
  0%, 100% { transform: scale(0.85) rotate(-10deg); opacity: 0.7; }
  50% { transform: scale(1.15) rotate(10deg); opacity: 1; }
}
.done-stat.good { background: rgba(var(--good-rgb), 0.22); }
.done-stat.bad { background: rgba(var(--bad-rgb), 0.18); }
.done-stat.combo { background: var(--star-soft); }
.done-stat { animation: stat-rise 0.45s 0.15s cubic-bezier(0.2, 1.4, 0.4, 1) both; }
.done-stat:nth-child(2) { animation-delay: 0.25s; }
.done-stat:nth-child(3) { animation-delay: 0.35s; }
@keyframes stat-rise {
  from { transform: translateY(18px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .sunburst, .done-title, .full-combo, .done-star, .done-stat { animation: none; }
}
.done-sub { font-size: 13px; color: var(--muted); margin-top: 6px; letter-spacing: 0.08em; }
.done-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
  margin-bottom: 14px;
}
.done-stat {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 12px 6px;
  border-radius: 14px;
  border: 3px solid var(--ink);
  box-shadow: 0 3px 0 var(--ink);
  background: var(--panel);
}
.done-num { font-size: 28px; line-height: 1; }
.mode-pill { position: relative; }
.mode-pill.ready { animation: ready-bounce 1.6s ease-in-out infinite; }
.mode-badge {
  position: absolute;
  top: -12px;
  right: -6px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--star);
  border: 2px solid var(--ink);
  font-size: 10px;
  letter-spacing: 0.06em;
  color: var(--ink);
}
@keyframes ready-bounce {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-3px); }
}
@media (prefers-reduced-motion: reduce) {
  .mode-pill.ready { animation: none; }
}
.done-label { font-size: 11px; color: var(--muted); font-weight: 700; }

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
  background: rgba(var(--bad-rgb), 0.08);
  font-size: 18px;
}
.quiz-failed-romaji {
  font-size: 11px;
  color: var(--muted);
}
.quiz-correct-chip {
  border-color: rgba(var(--good-rgb), 0.55) !important;
  background: rgba(var(--good-rgb), 0.10) !important;
}
.session-meta .timer {
  font-size: 16px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.session-meta .timer.low { color: var(--bad); }
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
  color: var(--on-accent);
  background: var(--accent);
  padding: 3px 10px;
  border-radius: 999px;
  font-weight: 600;
}
.focus-progress-dots {
  display: inline-flex;
  gap: 3px;
  margin-left: 4px;
  font-size: 14px;
  letter-spacing: 1px;
}
.learn-hint {
  background: var(--star-soft);
  border: 3px solid var(--ink);
  box-shadow: 0 3px 0 var(--ink);
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
  color: var(--accent-text);
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
  background: var(--panel);
  border: 3px solid var(--ink);
  box-shadow: 0 4px 0 var(--ink);
  border-radius: 16px;
  color: var(--text);
  padding: 12px 14px;
  outline: none;
  letter-spacing: 0.15em;
  font-variant: small-caps;
  transition: border-color 0.15s;
}
.answer-input::placeholder { font-variant: normal; letter-spacing: 0.06em; }
.answer-input:focus { border-color: var(--accent-text); }
.answer-input.good { border-color: var(--good); background: rgba(var(--good-rgb), 0.14); }
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
.answer-shown strong { color: var(--text); font-size: 16px; margin: 0 4px; }
.answer-note { font-size: 11px; margin-left: 8px; }

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
  color: var(--on-accent);
  border-color: var(--accent-text);
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
.cal-cell.s0 { background: rgba(var(--ink-rgb), 0.06); }
.cal-cell.s1 { background: rgba(var(--accent-rgb), 0.22); }
.cal-cell.s2 { background: rgba(var(--accent-rgb), 0.42); }
.cal-cell.s3 { background: rgba(var(--accent-rgb), 0.66); }
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
  --acc-pct: 0%;
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--panel);
  font-family: 'Hiragino Sans', 'Yu Gothic', 'Meiryo', system-ui, sans-serif;
  color: var(--text);
  padding: 10px 14px;
  min-height: 80px;
  line-height: 1.15;
  gap: 10px;
}
.kana-grid-cell .cell-main {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.kana-grid-cell .cell-char { font-size: 30px; font-weight: 600; }
.kana-grid-cell .cell-romaji { font-size: 13px; color: var(--muted); }
.kana-grid-cell .cell-stats {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 3px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--muted);
  white-space: nowrap;
}
.kana-grid-cell .cell-stat {
  display: inline-flex;
  gap: 4px;
  opacity: 0.9;
}
.kana-grid-cell .stat-label {
  opacity: 0.65;
}
.kana-grid-cell .stat-num {
  display: inline-block;
  min-width: 2.5em;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.kana-grid-cell.empty {
  background: transparent;
  border-color: transparent;
}
/* 進度條當背景:從左填到 var(--acc-pct),顏色依池子 */
.kana-grid-cell.pool-bottom {
  background: linear-gradient(
    to right,
    rgba(var(--bad-rgb), 0.30) var(--acc-pct),
    transparent var(--acc-pct)
  );
  border-color: rgba(var(--bad-rgb), 0.40);
}
.kana-grid-cell.pool-top {
  background: linear-gradient(
    to right,
    rgba(var(--good-rgb), 0.30) var(--acc-pct),
    transparent var(--acc-pct)
  );
  border-color: rgba(var(--good-rgb), 0.40);
}
.kana-grid-cell.pool-mid {
  background: linear-gradient(
    to right,
    rgba(var(--accent-rgb), 0.18) var(--acc-pct),
    transparent var(--acc-pct)
  );
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
.kana-grid-cell.pool-locked {
  background: transparent;
  border-style: dotted;
  opacity: 0.25;
}
.kana-grid-cell.pool-locked .cell-stats-unintroduced {
  font-size: 10px;
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
.pool-tag.pool-locked { color: var(--muted); opacity: 0.35; }

.stage-result {
  margin: 0 auto 12px;
  max-width: 420px;
  padding: 10px 14px;
  border-radius: 12px;
  font-size: 14px;
  line-height: 1.6;
  border: 1px solid;
}
.stage-result.pass {
  color: var(--good);
  border-color: rgba(var(--good-rgb), 0.4);
  background: rgba(var(--good-rgb), 0.08);
}
.trace-chips {
  display: flex;
  gap: 8px;
  justify-content: center;
  flex-wrap: wrap;
  margin: 4px 0 14px;
}
.trace-chip {
  min-width: 40px;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--panel-2);
  color: var(--text);
  font-size: 18px;
  cursor: pointer;
}
.trace-chip.active {
  border-color: var(--accent-text);
  color: var(--accent-text);
  background: rgba(var(--accent-rgb), 0.12);
}
.trace-wrap {
  max-width: 340px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.trace-head {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
}
.trace-romaji {
  font-size: 40px;
  color: var(--ink);
  letter-spacing: 0.1em;
  line-height: 1;
}
.trace-prompt {
  text-align: center;
  font-size: 12px;
  color: var(--muted);
  margin: -4px 0 0;
}
.judge-btn {
  flex: 1;
  padding: 14px 0;
  font-size: 16px;
  border-radius: 14px;
  border: 3px solid var(--ink);
  box-shadow: 0 4px 0 var(--ink);
  color: var(--ink);
  transition: transform 0.08s, box-shadow 0.08s;
}
.judge-btn:active { transform: translateY(4px); box-shadow: 0 0 0 var(--ink); }
.judge-btn.right { background: var(--good); color: var(--panel); }
.judge-btn.wrong { background: var(--panel); }
.panel.session.trace-done-panel { --band: var(--good); }
.trace-done-panel::before { display: none; }
.trace-tools {
  display: flex;
  justify-content: center;
  gap: 8px;
  flex-wrap: wrap;
}
.trace-nav {
  display: flex;
  gap: 10px;
}
.trace-nav > button { flex: 1; }
.trace-note { font-size: 12px; line-height: 1.6; text-align: center; margin: 0; }
.stage-result.fail {
  color: var(--bad);
  border-color: rgba(var(--bad-rgb), 0.4);
  background: rgba(var(--bad-rgb), 0.08);
}

.btn-ghost.big {
  padding: 14px 28px;
  font-size: 16px;
  border-radius: 14px;
  border: 3px solid var(--ink);
  box-shadow: 0 4px 0 var(--ink);
  background: var(--panel);
  color: var(--ink);
  font-weight: 700;
}
.btn-ghost.big:active {
  transform: translateY(4px);
  box-shadow: 0 0 0 var(--ink);
}

/* ===== 首頁:鼓面 + 難度 + 關卡列表 ===== */
.hero-taiko {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-bottom: 16px;
}
.drum-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 4px;
}
.drum {
  width: 210px;
  height: 210px;
  border-radius: 999px;
  background: var(--bad);
  border: 4px solid var(--ink);
  box-shadow: 0 8px 0 var(--ink);
  display: flex;
  align-items: center;
  justify-content: center;
}
.drum-face {
  width: 164px;
  height: 164px;
  border-radius: 999px;
  background: var(--panel);
  border: 4px solid var(--ink);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}
.drum-sub {
  font-size: 11px;
  letter-spacing: 0.2em;
  color: var(--muted);
}
.drum-label {
  font-size: 58px;
  line-height: 1.05;
  color: var(--ink);
}
.stage-row-chars { display: flex; gap: 12px; flex-wrap: wrap; }
.stage-row-chars.two { font-size: 14px; letter-spacing: 0.12em; }
.setting-note {
  font-size: 12px;
  line-height: 1.6;
  margin: -6px 0 14px;
}
.drum-chars {
  font-size: 16px;
  letter-spacing: 0.3em;
  padding-left: 0.3em;
  color: var(--bad);
  line-height: 1.35;
}
/* 一起學:圓圈裡要放兩行假名,字級縮一階 */
.drum-face.two-lines .drum-label { font-size: 42px; }
.drum-face.two-lines .drum-chars { font-size: 14px; letter-spacing: 0.2em; padding-left: 0.2em; }
.drum-badges {
  display: flex;
  gap: 8px;
  margin-top: 22px;
  position: relative;
  flex-wrap: wrap;
  justify-content: center;
}
.badge-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 40px;
  padding: 0 14px;
  border-radius: 999px;
  background: var(--star);
  border: 3px solid var(--ink);
  box-shadow: 0 3px 0 var(--ink);
  color: var(--ink);
  font-size: 13px;
  letter-spacing: 0.1em;
}
.badge-pill-alt { background: var(--panel); }
.track-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 12px;
  padding: 6px 12px;
  border-radius: 999px;
  border: 2px solid rgba(var(--ink-rgb), 0.35);
  background: rgba(255, 255, 255, 0.55);
  color: var(--ink);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  position: relative;
}
.start-btn {
  width: 100%;
  height: 62px;
  margin-top: 26px;
  border-radius: 18px;
  background: var(--accent-text);
  color: var(--panel);
  font-size: 22px;
  letter-spacing: 0.24em;
  padding-left: 0.24em;
  border: 3px solid var(--ink);
  box-shadow: 0 5px 0 var(--ink);
  transition: transform 0.08s, box-shadow 0.08s;
}
.start-btn:active {
  transform: translateY(5px);
  box-shadow: 0 0 0 var(--ink);
}
.mode-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.mode-pill {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 9px 4px;
  border-radius: 14px;
  border: 3px solid var(--ink);
  box-shadow: 0 3px 0 var(--ink);
  color: var(--ink);
  background: var(--panel);
  transition: transform 0.08s, box-shadow 0.08s;
}
.mode-pill:active {
  transform: translateY(3px);
  box-shadow: 0 0 0 var(--ink);
}
.mode-jp { font-size: 11px; letter-spacing: 0.08em; }
.mode-zh { font-size: 14px; font-weight: 700; }
.mode-normal { background: var(--accent); }
.stage-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 12px;
}
.stage-list-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.stage-list-title { font-size: 18px; letter-spacing: 0.1em; }
.stage-list-rule {
  flex-grow: 1;
  height: 3px;
  background: var(--ink);
  border-radius: 2px;
}
.stage-list-sub {
  font-size: 11px;
  letter-spacing: 0.12em;
  color: var(--muted);
}
.stage-row {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 62px;
  padding-right: 14px;
  border-radius: 16px;
  background: var(--panel);
  border: 3px solid var(--ink);
  box-shadow: 0 4px 0 var(--ink);
  overflow: hidden;
}
.stage-tab {
  width: 58px;
  height: 100%;
  font-size: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-right: 3px solid var(--ink);
  flex-shrink: 0;
}
.stage-body {
  display: flex;
  flex-direction: column;
  gap: 1px;
  flex-grow: 1;
  min-width: 0;
}
.stage-row-chars { font-size: 16px; letter-spacing: 0.2em; }
.stage-row-status { font-size: 11px; font-weight: 700; }
.stage-stars { display: flex; gap: 2px; flex-shrink: 0; }
.stage-row.passed .stage-tab { background: var(--good); color: var(--panel); }
.stage-row.passed .stage-row-status { color: var(--good); }
.stage-row.current { background: var(--star-soft); }
.stage-row.current .stage-tab { background: var(--bad); color: var(--panel); }
.stage-row.current .stage-row-status { color: var(--bad); }
.stage-row.locked {
  background: var(--panel-2);
  border-color: var(--border-strong);
  box-shadow: none;
  color: var(--muted);
}
.stage-row.locked .stage-tab {
  background: var(--border);
  color: var(--muted);
  border-right-color: var(--border-strong);
}
.stage-row.locked .stage-row-chars,
.stage-row.locked .stage-row-status { color: var(--muted); font-weight: 500; }
.stage-lock { flex-shrink: 0; }
.stage-more {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 46px;
  border-radius: 14px;
  border: 3px dashed var(--border-strong);
  background: transparent;
  color: var(--muted);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.1em;
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
.focus-done-note {
  font-size: 13px;
  margin: 16px 0 24px;
  line-height: 1.6;
}

@media (max-width: 560px) {
  .kana { font-size: 110px; }
  .topbar-stats { gap: 6px; }
  /* 手機格子太窄 → 改成垂直排:假名上、stats 一樣直排但放在下面 */
  .kana-grid-cell {
    flex-direction: column;
    justify-content: center;
    padding: 6px 4px;
    min-height: 100px;
    gap: 4px;
  }
  .kana-grid-cell .cell-main { align-items: center; }
  .kana-grid-cell .cell-char { font-size: 24px; }
  .kana-grid-cell .cell-romaji { font-size: 11px; }
  .kana-grid-cell .cell-stats {
    flex-direction: column;
    align-items: center;
    gap: 2px;
    font-size: 10px;
  }
  .kana-grid-cell .stat-num { min-width: 2em; }
  /* 進度條改成由下往上填,跟直立格子方向一致 */
  .kana-grid-cell.pool-bottom {
    background: linear-gradient(
      to top,
      rgba(var(--bad-rgb), 0.30) var(--acc-pct),
      transparent var(--acc-pct)
    );
  }
  .kana-grid-cell.pool-top {
    background: linear-gradient(
      to top,
      rgba(var(--good-rgb), 0.30) var(--acc-pct),
      transparent var(--acc-pct)
    );
  }
  .kana-grid-cell.pool-mid {
    background: linear-gradient(
      to top,
      rgba(var(--accent-rgb), 0.18) var(--acc-pct),
      transparent var(--acc-pct)
    );
  }
  .history-table { font-size: 12px; }
  .history-table th,
  .history-table td { padding: 6px 4px; }
}
</style>
