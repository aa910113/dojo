<script setup lang="ts">
// 描紅板:虛線田字格 + 淡色範字(SVG 文字)+ 可手寫的 canvas 疊層
// 筆跡用 0~1 的相對座標存,換尺寸 / 轉向時重畫不變形
const props = withDefaults(defineProps<{
  char: string
  showGuide?: boolean
}>(), { showGuide: true })

// 筆順示範:把標準筆畫一筆一筆畫出來(資料同辨識器,KanjiVG 衍生)
const demoStrokes = computed<number[][][]>(
  () => (STROKE_DATA as Record<string, number[][][]>)[props.char] ?? [],
)
// 已畫完的長度比例,0 = 沒在示範
const demoProgress = ref(0)
const hasStrokeData = computed(() => demoStrokes.value.length > 0)
// 範字/示範在格子裡留邊,不要頂到框線(只影響顯示,辨識另外正規化)
const PAD = 0.12
const mapX = (v: number) => (PAD + v * (1 - 2 * PAD)) * cssSize
const mapY = (v: number) => (PAD + v * (1 - 2 * PAD)) * cssSize
let demoRaf = 0

type Point = { x: number; y: number }
type Stroke = Point[]

import STROKE_DATA from '~/data/kana-strokes.json'

const wrapEl = ref<HTMLDivElement | null>(null)
const canvasEl = ref<HTMLCanvasElement | null>(null)
const strokes = ref<Stroke[]>([])
let live: Stroke | null = null
let ctx: CanvasRenderingContext2D | null = null
let cssSize = 0
let ro: ResizeObserver | null = null

const hasInk = computed(() => strokes.value.length > 0)

function inkColor(): string {
  if (!wrapEl.value) return '#7dd3fc'
  return getComputedStyle(wrapEl.value).getPropertyValue('--accent-text').trim() || '#4f8db3'
}

function accentColor(): string {
  if (!wrapEl.value) return '#9ccbe0'
  return getComputedStyle(wrapEl.value).getPropertyValue('--good').trim() || '#6cb58d'
}

function resize() {
  const wrap = wrapEl.value
  const canvas = canvasEl.value
  if (!wrap || !canvas) return
  const dpr = window.devicePixelRatio || 1
  cssSize = wrap.clientWidth
  canvas.width = Math.round(cssSize * dpr)
  canvas.height = Math.round(cssSize * dpr)
  canvas.style.width = `${cssSize}px`
  canvas.style.height = `${cssSize}px`
  ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
  }
  redraw()
}

function drawStroke(s: Stroke) {
  if (!ctx || s.length === 0) return
  ctx.strokeStyle = inkColor()
  ctx.lineWidth = cssSize * 0.045
  ctx.beginPath()
  ctx.moveTo(s[0].x * cssSize, s[0].y * cssSize)
  if (s.length === 1) {
    ctx.lineTo(s[0].x * cssSize + 0.01, s[0].y * cssSize)
  }
  for (let i = 1; i < s.length; i++) {
    ctx.lineTo(s[i].x * cssSize, s[i].y * cssSize)
  }
  ctx.stroke()
}

// 範字:整個字的標準筆畫,淡淡地墊在底下。
// 用和辨識器同一份資料,所以顯示的就是它實際比對的形狀
function drawGuide() {
  if (!ctx || !props.showGuide) return
  const list = demoStrokes.value
  if (list.length === 0) return
  ctx.save()
  ctx.strokeStyle = accentColor()
  ctx.globalAlpha = 0.3
  ctx.lineWidth = cssSize * 0.05
  for (const pts of list) {
    ctx.beginPath()
    ctx.moveTo(mapX(pts[0][0]), mapY(pts[0][1]))
    for (let k = 1; k < pts.length; k++) ctx.lineTo(mapX(pts[k][0]), mapY(pts[k][1]))
    ctx.stroke()
  }
  ctx.restore()
}

// 筆順示範:一筆一筆畫出來,壓在範字上面
function drawDemo() {
  if (!ctx || demoProgress.value <= 0) return
  const list = demoStrokes.value
  if (list.length === 0) return
  const total = list.length
  const done = demoProgress.value * total
  ctx.save()
  ctx.strokeStyle = accentColor()
  ctx.globalAlpha = 0.75
  ctx.lineWidth = cssSize * 0.05
  for (let i = 0; i < total; i++) {
    const frac = Math.max(0, Math.min(1, done - i))
    if (frac <= 0) break
    const pts = list[i]
    const upto = 1 + Math.floor(frac * (pts.length - 1))
    ctx.beginPath()
    ctx.moveTo(mapX(pts[0][0]), mapY(pts[0][1]))
    for (let k = 1; k < upto; k++) ctx.lineTo(mapX(pts[k][0]), mapY(pts[k][1]))
    ctx.stroke()
    // 起筆處點一個圈,標示這一筆從哪開始
    if (frac < 1) {
      ctx.beginPath()
      ctx.arc(mapX(pts[0][0]), mapY(pts[0][1]), cssSize * 0.028, 0, Math.PI * 2)
      ctx.fillStyle = accentColor()
      ctx.fill()
    }
  }
  ctx.restore()
}

function redraw() {
  if (!ctx) return
  ctx.clearRect(0, 0, cssSize, cssSize)
  drawGuide()
  drawDemo()
  for (const s of strokes.value) drawStroke(s)
  if (live) drawStroke(live)
}

// 播放筆順示範:每一筆約 0.5 秒
function playDemo() {
  cancelAnimationFrame(demoRaf)
  const total = demoStrokes.value.length
  if (total === 0) return
  const dur = total * 520
  const t0 = performance.now()
  const step = (now: number) => {
    const t = Math.min(1, (now - t0) / dur)
    demoProgress.value = t
    redraw()
    if (t < 1) demoRaf = requestAnimationFrame(step)
  }
  demoRaf = requestAnimationFrame(step)
}

function stopDemo() {
  cancelAnimationFrame(demoRaf)
  demoProgress.value = 0
  redraw()
}

function toPoint(e: PointerEvent): Point {
  const rect = canvasEl.value!.getBoundingClientRect()
  return {
    x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
  }
}

function onDown(e: PointerEvent) {
  if (!canvasEl.value) return
  e.preventDefault()
  canvasEl.value.setPointerCapture(e.pointerId)
  live = [toPoint(e)]
  redraw()
}

function onMove(e: PointerEvent) {
  if (!live) return
  e.preventDefault()
  // 用 coalesced events 拿到高頻取樣,筆跡才平滑
  const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [e]
  for (const ev of events.length ? events : [e]) live.push(toPoint(ev))
  redraw()
}

function onUp(e: PointerEvent) {
  if (!live) return
  e.preventDefault()
  strokes.value = [...strokes.value, live]
  live = null
  redraw()
}

function clear() {
  strokes.value = []
  live = null
  redraw()
}

function undo() {
  strokes.value = strokes.value.slice(0, -1)
  redraw()
}

watch(() => props.char, () => { stopDemo(); clear() })
watch(() => props.showGuide, () => redraw())

onMounted(() => {
  resize()
  ro = new ResizeObserver(() => resize())
  if (wrapEl.value) ro.observe(wrapEl.value)
})

onBeforeUnmount(() => {
  cancelAnimationFrame(demoRaf)
  ro?.disconnect()
})

// getStrokes 回傳 [0,1] 相對座標的筆跡,給辨識器用
defineExpose({ clear, undo, hasInk, getStrokes: () => strokes.value, playDemo, stopDemo })
</script>

<template>
  <div ref="wrapEl" class="trace-board">
    <svg class="trace-guide" viewBox="0 0 100 100" aria-hidden="true">
      <rect x="1" y="1" width="98" height="98" rx="6" class="guide-frame" />
      <line x1="50" y1="3" x2="50" y2="97" class="guide-dash" />
      <line x1="3" y1="50" x2="97" y2="50" class="guide-dash" />
      <text
        v-if="showGuide && !hasStrokeData"
        x="50"
        y="50"
        text-anchor="middle"
        dominant-baseline="central"
        class="guide-char"
      >{{ char }}</text>
    </svg>
    <canvas
      ref="canvasEl"
      class="trace-ink"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onUp"
      @pointerleave="onUp"
    />
  </div>
</template>

<style scoped>
.trace-board {
  position: relative;
  width: 100%;
  aspect-ratio: 1 / 1;
  border-radius: 14px;
  background: var(--panel-2);
  overflow: hidden;
  user-select: none;
  -webkit-user-select: none;
}
.trace-guide {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}
.guide-frame {
  fill: none;
  stroke: var(--border);
  stroke-width: 1.2;
}
.guide-dash {
  stroke: var(--border);
  stroke-width: 0.8;
  stroke-dasharray: 3 3;
}
.guide-char {
  /* 教科書體風格;離線或字型沒載到就退回系統日文字型 */
  font-family: 'Klee One', 'Hiragino Maru Gothic ProN', 'Hiragino Sans', 'Noto Sans JP', 'Yu Gothic', sans-serif;
  font-size: 74px;
  font-weight: 400;
  fill: var(--accent-text);
  opacity: 0.22;
}
.trace-ink {
  position: absolute;
  inset: 0;
  touch-action: none;
  cursor: crosshair;
}
</style>
