// 音效與背景音樂:全部用 Web Audio 合成,沒有音檔、沒有版權問題。
// - SFX:don(大鼓)、ka(邊鼓)、fail(答錯)、clear(過關)
// - BGM:祭典風循環(太鼓節奏 + 陽音階撥弦旋律),用 lookahead scheduler 排程
// ===== 曲庫:6 首原創循環,隨機播放 =====
// 音名 → 頻率 (A4 = 440)
const NOTE_INDEX: Record<string, number> = { C: -9, 'C#': -8, D: -7, 'D#': -6, E: -5, F: -4, 'F#': -3, G: -2, 'G#': -1, A: 0, 'A#': 1, B: 2 }
function n(name: string): number {
  const m = /^([A-G]#?)(\d)$/.exec(name)
  if (!m) return 440
  const semis = NOTE_INDEX[m[1]] + (Number(m[2]) - 4) * 12
  return 440 * Math.pow(2, semis / 12)
}
const N = (names: string): (number | null)[] =>
  names.trim().split(/\s+/).map((x) => (x === '-' ? null : n(x)))

export interface Track {
  name: string
  bpm: number
  loopSteps: number        // 16 分音符數(32 = 兩小節)
  don: number[]
  ka: number[]
  melody: (number | null)[]
  melodyStep: number       // 每幾個 step 一個音(2 = 八分音符)
  voice: 'pluck' | 'flute'
  noteDur: number
  bass: number[]           // 每拍(4 step)一個低音
  loops: number            // 播幾輪後換曲
}

const TRACKS: Track[] = [
  {
    // 陽音階,標準祭囃子
    name: '祭囃子', bpm: 132, loopSteps: 32,
    don: [0, 6, 8, 14, 16, 22, 24, 28, 30], ka: [4, 12, 20, 26, 27],
    melody: N('D5 E5 G5 A5 G5 E5 D5 - B4 D5 E5 G5 E5 D5 B4 -'), melodyStep: 2,
    voice: 'pluck', noteDur: 0.32,
    bass: [n('D3'), n('D3'), n('A2'), n('D3'), n('D3'), n('D3'), n('A2'), n('B2')], loops: 6,
  },
  {
    // 慢一點的盆踊り,G 陽音階,鼓有留白
    name: '盆踊り', bpm: 108, loopSteps: 32,
    don: [0, 8, 12, 16, 24, 28], ka: [6, 14, 22, 30, 31],
    melody: N('G4 A4 C5 D5 C5 A4 G4 - E4 G4 A4 C5 A4 G4 E4 -'), melodyStep: 2,
    voice: 'pluck', noteDur: 0.42,
    bass: [n('G2'), n('G2'), n('D3'), n('G2'), n('C3'), n('C3'), n('D3'), n('G2')], loops: 5,
  },
  {
    // 快速花火,ka 很多,旋律往上衝
    name: '花火', bpm: 148, loopSteps: 32,
    don: [0, 4, 8, 12, 16, 20, 24, 26, 28], ka: [2, 6, 10, 14, 18, 22, 30, 31],
    melody: N('A4 B4 D5 E5 A5 E5 D5 B4 A4 B4 D5 E5 F#5 E5 D5 B4'), melodyStep: 2,
    voice: 'pluck', noteDur: 0.26,
    bass: [n('A2'), n('A2'), n('E3'), n('A2'), n('D3'), n('D3'), n('E3'), n('A2')], loops: 6,
  },
  {
    // 夜櫻,都節音階 (E F A B C),慢,笛聲
    name: '夜桜', bpm: 92, loopSteps: 64,
    don: [0, 16, 24, 32, 48, 56], ka: [12, 28, 44, 60],
    melody: N('E5 - F5 - A5 - - - B5 - A5 - F5 - E5 - C5 - - - B4 - A4 - - - - - E5 - - -'), melodyStep: 2,
    voice: 'flute', noteDur: 0.5,
    bass: [n('E3'), n('E3'), n('E3'), n('E3'), n('A2'), n('A2'), n('B2'), n('B2'), n('E3'), n('E3'), n('E3'), n('E3'), n('A2'), n('A2'), n('B2'), n('E3')], loops: 4,
  },
  {
    // 神輿,推進感,重複短句像喊聲
    name: '神輿', bpm: 140, loopSteps: 32,
    don: [0, 2, 4, 8, 10, 12, 16, 18, 20, 24, 26, 28], ka: [6, 14, 22, 30],
    melody: N('D5 D5 A4 - D5 D5 A4 - G5 G5 E5 - D5 - A4 -'), melodyStep: 2,
    voice: 'pluck', noteDur: 0.22,
    bass: [n('D3'), n('D3'), n('D3'), n('D3'), n('G2'), n('G2'), n('A2'), n('A2')], loops: 6,
  },
  {
    // 竹林,笛聲長音,鼓很少,偏環境
    name: '竹林', bpm: 116, loopSteps: 64,
    don: [0, 32], ka: [8, 24, 40, 56],
    melody: N('A4 - - - B4 - D5 - - - E5 - - - D5 - B4 - - - A4 - - - - - - - G4 - A4 -'), melodyStep: 2,
    voice: 'flute', noteDur: 0.6,
    bass: [n('A2'), n('A2'), n('A2'), n('A2'), n('A2'), n('A2'), n('G2'), n('G2'), n('A2'), n('A2'), n('A2'), n('A2'), n('D3'), n('D3'), n('G2'), n('A2')], loops: 4,
  },
]

// 結果畫面專用:輕快、不換曲
const RESULT_TRACK: Track = {
  name: '祝', bpm: 120, loopSteps: 32,
  don: [0, 8, 16, 24, 28], ka: [4, 6, 12, 20, 22, 30],
  melody: N('G5 A5 B5 - D6 - B5 A5 G5 - E5 G5 A5 - - - B5 A5 G5 E5 D5 - E5 G5 A5 - - - G5 - - -'), melodyStep: 1,
  voice: 'pluck', noteDur: 0.3,
  bass: [n('G2'), n('G2'), n('D3'), n('D3'), n('E3'), n('E3'), n('D3'), n('G2')], loops: 1_000_000,
}

// 過關音效用的音
const D5 = n('D5'), E5 = n('E5'), G5 = n('G5'), A5 = n('A5'), B5 = n('B5'), D6 = n('D6'), G4 = n('G4'), A4 = n('A4')

let ctx: AudioContext | null = null
let master: GainNode | null = null
let sfxBus: GainNode | null = null
let bgmBus: GainNode | null = null
let noiseBuf: AudioBuffer | null = null

function ensure(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (ctx) return ctx
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AC) return null
  ctx = new AC()
  master = ctx.createGain()
  master.gain.value = 0.9
  master.connect(ctx.destination)
  sfxBus = ctx.createGain()
  sfxBus.gain.value = 0.55
  sfxBus.connect(master)
  bgmBus = ctx.createGain()
  bgmBus.gain.value = 0.16
  bgmBus.connect(master)
  // 白噪音 buffer,給鼓皮/邊鼓用
  const len = ctx.sampleRate * 0.5
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate)
  const data = noiseBuf.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
  return ctx
}

// === 音色 ===
function playDon(at: number, bus: GainNode, vel = 1) {
  const c = ctx!
  // 鼓皮:正弦音高快速下滑
  const osc = c.createOscillator()
  osc.type = 'sine'
  osc.frequency.setValueAtTime(160, at)
  osc.frequency.exponentialRampToValueAtTime(55, at + 0.18)
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(1.0 * vel, at + 0.006)
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.42)
  osc.connect(g).connect(bus)
  osc.start(at)
  osc.stop(at + 0.45)
  // 敲擊瞬間的噪音
  const n = c.createBufferSource()
  n.buffer = noiseBuf
  const lp = c.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.value = 900
  const ng = c.createGain()
  ng.gain.setValueAtTime(0.5 * vel, at)
  ng.gain.exponentialRampToValueAtTime(0.0001, at + 0.06)
  n.connect(lp).connect(ng).connect(bus)
  n.start(at)
  n.stop(at + 0.08)
}

function playKa(at: number, bus: GainNode, vel = 1) {
  const c = ctx!
  const n = c.createBufferSource()
  n.buffer = noiseBuf
  const bp = c.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = 3800
  bp.Q.value = 1.2
  const g = c.createGain()
  g.gain.setValueAtTime(0.7 * vel, at)
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.05)
  n.connect(bp).connect(g).connect(bus)
  n.start(at)
  n.stop(at + 0.07)
  // 木框的短促「叩」
  const osc = c.createOscillator()
  osc.type = 'square'
  osc.frequency.setValueAtTime(1500, at)
  osc.frequency.exponentialRampToValueAtTime(900, at + 0.03)
  const og = c.createGain()
  og.gain.setValueAtTime(0.18 * vel, at)
  og.gain.exponentialRampToValueAtTime(0.0001, at + 0.04)
  osc.connect(og).connect(bus)
  osc.start(at)
  osc.stop(at + 0.05)
}

// 撥弦(琴/三味線感):三角波 + 泛音,快速衰減
function playPluck(at: number, freq: number, bus: GainNode, dur = 0.35, vel = 1) {
  const c = ctx!
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(0.5 * vel, at + 0.004)
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur)
  g.connect(bus)
  const o1 = c.createOscillator()
  o1.type = 'triangle'
  o1.frequency.value = freq
  const o2 = c.createOscillator()
  o2.type = 'sine'
  o2.frequency.value = freq * 2
  const g2 = c.createGain()
  g2.gain.value = 0.35
  o1.connect(g)
  o2.connect(g2).connect(g)
  o1.start(at); o2.start(at)
  o1.stop(at + dur + 0.02); o2.stop(at + dur + 0.02)
}

// 笛(篠笛感):正弦 + 輕微顫音,慢起音
function playFlute(at: number, freq: number, bus: GainNode, dur = 0.5, vel = 1) {
  const c = ctx!
  const o = c.createOscillator()
  o.type = 'sine'
  o.frequency.value = freq
  const lfo = c.createOscillator()
  lfo.type = 'sine'
  lfo.frequency.value = 5.5
  const lfoGain = c.createGain()
  lfoGain.gain.value = freq * 0.006
  lfo.connect(lfoGain).connect(o.frequency)
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(0.4 * vel, at + 0.04)
  g.gain.setValueAtTime(0.4 * vel, at + dur * 0.7)
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur)
  // 一點氣音
  const nz = c.createBufferSource()
  nz.buffer = noiseBuf
  const bp = c.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = freq * 2
  bp.Q.value = 6
  const ng = c.createGain()
  ng.gain.setValueAtTime(0.06 * vel, at)
  ng.gain.exponentialRampToValueAtTime(0.0001, at + dur)
  nz.connect(bp).connect(ng).connect(bus)
  o.connect(g).connect(bus)
  o.start(at); lfo.start(at); nz.start(at)
  o.stop(at + dur + 0.05); lfo.stop(at + dur + 0.05); nz.stop(at + dur + 0.05)
}

function playBass(at: number, freq: number, bus: GainNode) {
  const c = ctx!
  const o = c.createOscillator()
  o.type = 'sine'
  o.frequency.value = freq
  const g = c.createGain()
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(0.5, at + 0.01)
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.28)
  o.connect(g).connect(bus)
  o.start(at)
  o.stop(at + 0.3)
}

// === BGM scheduler ===
let bgmTimer: number | null = null
let nextStepTime = 0
let stepIndex = 0
let loopsPlayed = 0
let track: Track = TRACKS[0]
let stepSec = 60 / track.bpm / 4
let pendingSwitch = false

function pickTrack(exclude?: Track): Track {
  const pool = TRACKS.filter((t) => t !== exclude)
  return pool[Math.floor(Math.random() * pool.length)]
}

function setTrack(t: Track) {
  track = t
  stepSec = 60 / t.bpm / 4
  stepIndex = 0
  loopsPlayed = 0
}

function scheduleStep(step: number, at: number) {
  const bus = bgmBus!
  const t = track
  if (t.don.includes(step)) playDon(at, bus, 0.9)
  if (t.ka.includes(step)) playKa(at, bus, 0.6)
  if (step % t.melodyStep === 0) {
    const f = t.melody[(step / t.melodyStep) % t.melody.length]
    if (f) {
      if (t.voice === 'flute') playFlute(at, f, bus, t.noteDur, 0.9)
      else playPluck(at, f, bus, t.noteDur, 0.8)
    }
  }
  if (step % 4 === 0) {
    const b = t.bass[(step / 4) % t.bass.length]
    if (b) playBass(at, b, bus)
  }
}

function bgmTick() {
  const c = ctx!
  // 提前 0.12 秒排程,避免 setInterval 抖動造成掉拍
  while (nextStepTime < c.currentTime + 0.12) {
    scheduleStep(stepIndex, nextStepTime)
    nextStepTime += stepSec
    stepIndex += 1
    if (stepIndex >= track.loopSteps) {
      stepIndex = 0
      loopsPlayed += 1
    }
    // 自然換曲:播滿設定輪數;手動換曲:等到下一拍就換,不用等整輪
    const loopDone = stepIndex === 0 && loopsPlayed >= track.loops
    const manual = pendingSwitch && stepIndex % 4 === 0
    if (loopDone || manual) {
      pendingSwitch = false
      setTrack(pickTrack(track))
      nextStepTime += stepSec * 4 // 空一拍再進下一首
      trackChanged?.()
    }
  }
}

let trackChanged: (() => void) | null = null
let bgmKind: 'home' | 'result' = 'home'
let playingKind: 'home' | 'result' = 'home'

export const useSound = () => {
  const sfxOn = useState<boolean>('snd-sfx', () => true)
  const bgmOn = useState<boolean>('snd-bgm', () => true)
  // 使用者是否已經跟頁面互動過(瀏覽器 autoplay 限制)
  const unlocked = useState<boolean>('snd-unlocked', () => false)
  const bgmPlaying = useState<boolean>('snd-bgm-playing', () => false)
  // 想播 BGM 但還沒解鎖 → 解鎖後自動補播
  const bgmWanted = useState<boolean>('snd-bgm-wanted', () => false)
  const trackName = useState<string>('snd-track', () => '')
  trackChanged = () => { trackName.value = track.name }

  function unlock() {
    const c = ensure()
    if (!c) return
    if (c.state === 'suspended') c.resume().catch(() => {})
    unlocked.value = true
    if (bgmWanted.value && bgmOn.value && !bgmPlaying.value) startBgm(bgmKind)
  }

  function sfx(kind: 'don' | 'ka' | 'fail' | 'clear' | 'fanfare') {
    if (!sfxOn.value) return
    const c = ensure()
    if (!c || !sfxBus) return
    if (c.state === 'suspended') c.resume().catch(() => {})
    const t = c.currentTime + 0.005
    switch (kind) {
      case 'don':
        playDon(t, sfxBus, 1)
        break
      case 'ka':
        playKa(t, sfxBus, 1)
        break
      case 'fail':
        // 兩聲下行低音
        playPluck(t, 220, sfxBus, 0.25, 0.9)
        playPluck(t + 0.16, 174.61, sfxBus, 0.4, 0.9)
        break
      case 'fanfare': {
        // 練習完成:鼓聲滾奏加速 → 上行旋律 → 收尾大鼓
        const roll = [0, 0.14, 0.27, 0.39, 0.5, 0.6, 0.69, 0.77, 0.84, 0.9]
        roll.forEach((dt, i) => (i % 2 === 0 ? playDon(t + dt, sfxBus!, 0.7) : playKa(t + dt, sfxBus!, 0.6)))
        const tune = [G4, A4, D5, E5, G5, A5, B5, D6]
        tune.forEach((f, i) => {
          playPluck(t + 1.0 + i * 0.11, f, sfxBus!, 0.45, 0.9)
        })
        playFlute(t + 1.9, D6, sfxBus, 0.9, 0.8)
        playPluck(t + 1.9, D6, sfxBus, 0.9, 1)
        playDon(t + 1.9, sfxBus, 1)
        playKa(t + 2.15, sfxBus, 0.8)
        playDon(t + 2.3, sfxBus, 1)
        break
      }
      case 'clear': {
        // 上行陽音階小旋律 + 收尾大鼓
        const seq = [D5, E5, G5, A5, D6]
        seq.forEach((f, i) => playPluck(t + i * 0.09, f, sfxBus!, 0.5, 0.9))
        playPluck(t + 0.55, D6, sfxBus, 0.9, 1)
        playDon(t + 0.55, sfxBus, 1)
        break
      }
    }
  }

  // 'home' = 隨機曲庫;'result' = 結果畫面專用曲
  function startBgm(kind: 'home' | 'result' = 'home') {
    bgmWanted.value = true
    bgmKind = kind
    if (!bgmOn.value) return
    const c = ensure()
    if (!c || !unlocked.value) return
    if (bgmPlaying.value) {
      if (playingKind === kind) return
      // 切換曲種:直接停掉再重開
      hardStop()
    }
    if (c.state === 'suspended') c.resume().catch(() => {})
    if (kind === 'result') setTrack(RESULT_TRACK)
    else setTrack(pickTrack(track === RESULT_TRACK ? undefined : track))
    playingKind = kind
    trackName.value = track.name
    nextStepTime = c.currentTime + 0.05
    bgmBus!.gain.cancelScheduledValues(c.currentTime)
    bgmBus!.gain.setValueAtTime(0.0001, c.currentTime)
    bgmBus!.gain.exponentialRampToValueAtTime(0.16, c.currentTime + 0.6)
    bgmTimer = window.setInterval(bgmTick, 25)
    bgmPlaying.value = true
  }

  function hardStop() {
    if (bgmTimer != null) {
      clearInterval(bgmTimer)
      bgmTimer = null
    }
    if (ctx && bgmBus) {
      bgmBus.gain.cancelScheduledValues(ctx.currentTime)
      bgmBus.gain.setValueAtTime(0.0001, ctx.currentTime)
    }
    bgmPlaying.value = false
  }

  function stopBgm() {
    bgmWanted.value = false
    if (!bgmPlaying.value || !ctx || !bgmBus) return
    const c = ctx
    bgmBus.gain.cancelScheduledValues(c.currentTime)
    bgmBus.gain.setValueAtTime(bgmBus.gain.value, c.currentTime)
    bgmBus.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.25)
    if (bgmTimer != null) {
      clearInterval(bgmTimer)
      bgmTimer = null
    }
    bgmPlaying.value = false
  }

  // 跳下一首(隨機、不重複當前這首)
  function nextTrack() {
    if (!bgmPlaying.value) {
      setTrack(pickTrack(track))
      trackName.value = track.name
      return
    }
    // 讓目前這輪結束時換曲,節奏不會斷在半拍
    pendingSwitch = true
  }

  function setSfx(on: boolean) {
    sfxOn.value = on
  }

  function setBgm(on: boolean) {
    bgmOn.value = on
    if (!on) {
      const wanted = bgmWanted.value
      stopBgm()
      bgmWanted.value = wanted
    } else if (bgmWanted.value) {
      startBgm(bgmKind)
    }
  }

  return { sfxOn, bgmOn, bgmPlaying, trackName, unlock, sfx, startBgm, stopBgm, setSfx, setBgm, nextTrack }
}
