// 音效與背景音樂:全部用 Web Audio 合成,沒有音檔、沒有版權問題。
// - SFX:don(大鼓)、ka(邊鼓)、fail(答錯)、clear(過關)
// - BGM:祭典風循環(太鼓節奏 + 陽音階撥弦旋律),用 lookahead scheduler 排程
const BPM = 132
const STEP = 60 / BPM / 4 // 16 分音符
const LOOP_STEPS = 32 // 兩小節

// 節奏:太鼓 don / ka 的 step 位置
const DON_STEPS = new Set([0, 6, 8, 14, 16, 22, 24, 28, 30])
const KA_STEPS = new Set([4, 12, 20, 26, 27])

// 旋律:陽音階 (D E G A B),每 2 step 一個八分音符;null = 休止
const D5 = 587.33, E5 = 659.25, G5 = 783.99, A5 = 880.0, B4 = 493.88, D6 = 1174.66
const MELODY: (number | null)[] = [
  D5, E5, G5, A5, G5, E5, D5, null,
  B4, D5, E5, G5, E5, D5, B4, null,
]
// 低音:每拍一下
const BASS_STEPS = new Set([0, 4, 8, 12, 16, 20, 24, 28])
const BASS = [146.83, 146.83, 110.0, 146.83, 146.83, 146.83, 110.0, 123.47] // D3 D3 A2 D3 ...

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

function scheduleStep(step: number, at: number) {
  const bus = bgmBus!
  if (DON_STEPS.has(step)) playDon(at, bus, 0.9)
  if (KA_STEPS.has(step)) playKa(at, bus, 0.6)
  if (step % 2 === 0) {
    const f = MELODY[(step / 2) % MELODY.length]
    if (f) playPluck(at, f, bus, 0.32, 0.8)
  }
  if (BASS_STEPS.has(step)) playBass(at, BASS[(step / 4) % BASS.length], bus)
}

function bgmTick() {
  const c = ctx!
  // 提前 0.12 秒排程,避免 setInterval 抖動造成掉拍
  while (nextStepTime < c.currentTime + 0.12) {
    scheduleStep(stepIndex, nextStepTime)
    nextStepTime += STEP
    stepIndex = (stepIndex + 1) % LOOP_STEPS
  }
}

export const useSound = () => {
  const sfxOn = useState<boolean>('snd-sfx', () => true)
  const bgmOn = useState<boolean>('snd-bgm', () => true)
  // 使用者是否已經跟頁面互動過(瀏覽器 autoplay 限制)
  const unlocked = useState<boolean>('snd-unlocked', () => false)
  const bgmPlaying = useState<boolean>('snd-bgm-playing', () => false)
  // 想播 BGM 但還沒解鎖 → 解鎖後自動補播
  const bgmWanted = useState<boolean>('snd-bgm-wanted', () => false)

  function unlock() {
    const c = ensure()
    if (!c) return
    if (c.state === 'suspended') c.resume().catch(() => {})
    unlocked.value = true
    if (bgmWanted.value && bgmOn.value && !bgmPlaying.value) startBgm()
  }

  function sfx(kind: 'don' | 'ka' | 'fail' | 'clear') {
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

  function startBgm() {
    bgmWanted.value = true
    if (!bgmOn.value) return
    const c = ensure()
    if (!c || !unlocked.value) return
    if (bgmPlaying.value) return
    if (c.state === 'suspended') c.resume().catch(() => {})
    stepIndex = 0
    nextStepTime = c.currentTime + 0.05
    bgmBus!.gain.cancelScheduledValues(c.currentTime)
    bgmBus!.gain.setValueAtTime(0.0001, c.currentTime)
    bgmBus!.gain.exponentialRampToValueAtTime(0.16, c.currentTime + 0.6)
    bgmTimer = window.setInterval(bgmTick, 25)
    bgmPlaying.value = true
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
      startBgm()
    }
  }

  return { sfxOn, bgmOn, bgmPlaying, unlock, sfx, startBgm, stopBgm, setSfx, setBgm }
}
