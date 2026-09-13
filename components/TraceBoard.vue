<script setup lang="ts">
// 描寫板:虛線田字格 + 可手寫的 canvas。
// 範字與筆順示範直接畫 KanjiVG 的原始曲線,保留每個假名在 109 字身框裡的
// 自然大小與位置 —— 若把每個字各自縮放到填滿格子,小字會被放大而顯得不工整。
// 筆跡用 0~1 的相對座標存,換尺寸 / 轉向時重畫不變形。
import STROKE_DATA from '~/data/kana-strokes.json'

const props = withDefaults(defineProps<{
  char: string
  showGuide?: boolean
}>(), { showGuide: true })

type Point = { x: number; y: number }
type Stroke = Point[]
interface CharData { p: string[]; s: number[][][] }

const VIEW = 109 // KanjiVG 的字身框

const wrapEl = ref<HTMLDivElement | null>(null)
const canvasEl = ref<HTMLCanvasElement | null>(null)
const strokes = ref<Stroke[]>([])
let live: Stroke | null = null
let ctx: CanvasRenderingContext2D | null = null
let cssSize = 0
let ro: ResizeObserver | null = null

const hasInk = computed(() => strokes.value.length > 0)
const charData = computed<CharData | null>(
  () => (STROKE_DATA as Record<string, CharData>)[props.char] ?? null,
)
const hasStrokeData = computed(() => (charData.value?.p.length ?? 0) > 0)

// === 範字 / 筆順示範 ===
// 量路徑長度要靠 SVG,建一個隱藏的 path 重複使用
let measurer: SVGPathElement | null = null
function measure(d: string) {
  if (typeof document === 'undefined') return { len: 0, start: null as DOMPoint | null }
  if (!measurer) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('width', '0')
    svg.setAttribute('height', '0')
    svg.setAttribute('style', 'position:absolute;left:-9999px;top:0;overflow:hidden')
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    svg.appendChild(path)
    document.body.appendChild(svg)
    measurer = path
  }
  measurer.setAttribute('d', d)
  const len = measurer.getTotalLength()
  return { len, start: len > 0 ? measurer.getPointAtLength(0) : null }
}

interface StrokeShape { path: Path2D; len: number; start: DOMPoint | null }
const shapes = computed<StrokeShape[]>(() => {
  if (typeof window === 'undefined') return []
  return (charData.value?.p ?? []).map((d) => {
    const m = measure(d)
    return { path: new Path2D(d), len: m.len, start: m.start }
  })
})

// 已畫完的比例,0 = 沒在示範
const demoProgress = ref(0)
let demoRaf = 0

function inkColor(): string {
  if (!wrapEl.value) return '#4f8db3'
  return getComputedStyle(wrapEl.value).getPropertyValue('--accent-text').trim() || '#4f8db3'
}

function guideColor(): string {
  if (!wrapEl.value) return '#6cb58d'
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

// 取樣點少的時候直線連接會出現稜角,改成通過相鄰中點的二次曲線
function tracePath(pts: Array<[number, number]>) {
  if (!ctx || pts.length === 0) return
  ctx.moveTo(pts[0][0], pts[0][1])
  if (pts.length === 1) {
    ctx.lineTo(pts[0][0] + 0.01, pts[0][1])
    return
  }
  for (let i = 1; i < pts.length - 1; i++) {
    ctx.quadraticCurveTo(
      pts[i][0], pts[i][1],
      (pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2,
    )
  }
  const last = pts[pts.length - 1]
  ctx.lineTo(last[0], last[1])
}

function drawStroke(s: Stroke) {
  if (!ctx || s.length === 0) return
  ctx.strokeStyle = inkColor()
  ctx.lineWidth = cssSize * 0.032
  ctx.beginPath()
  tracePath(s.map((p) => [p.x * cssSize, p.y * cssSize]))
  ctx.stroke()
}

// 把 109 的字身框對應到 canvas,線寬換算回該座標系
function withCharTransform(px: number, draw: (c: CanvasRenderingContext2D) => void) {
  if (!ctx) return
  const k = cssSize / VIEW
  ctx.save()
  ctx.scale(k, k)
  ctx.lineWidth = px / k
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  draw(ctx)
  ctx.restore()
}

function drawGuide() {
  if (!ctx || !props.showGuide) return
  const list = shapes.value
  if (list.length === 0) return
  withCharTransform(cssSize * 0.04, (c) => {
    c.strokeStyle = guideColor()
    c.globalAlpha = 0.3
    for (const sh of list) c.stroke(sh.path)
  })
}

function drawDemo() {
  if (!ctx || demoProgress.value <= 0) return
  const list = shapes.value
  if (list.length === 0) return
  const total = list.length
  const done = demoProgress.value * total
  withCharTransform(cssSize * 0.04, (c) => {
    c.strokeStyle = guideColor()
    c.globalAlpha = 0.8
    for (let i = 0; i < total; i++) {
      const frac = Math.max(0, Math.min(1, done - i))
      if (frac <= 0) break
      const sh = list[i]
      // 用虛線長度畫出「寫到一半」的筆畫,曲線本身維持原樣
      c.setLineDash([sh.len * frac, sh.len])
      c.stroke(sh.path)
      c.setLineDash([])
      // 起筆處點一個圈,標示這一筆從哪開始
      if (frac < 1 && sh.start) {
        c.beginPath()
        c.arc(sh.start.x, sh.start.y, VIEW * 0.03, 0, Math.PI * 2)
        c.fillStyle = guideColor()
        c.fill()
      }
    }
  })
}

function redraw() {
  if (!ctx) return
  ctx.clearRect(0, 0, cssSize, cssSize)
  drawGuide()
  drawDemo()
  for (const s of strokes.value) drawStroke(s)
  if (live) drawStroke(live)
}

// 播放筆順示範:每一筆約 0.6 秒
function playDemo() {
  cancelAnimationFrame(demoRaf)
  const total = shapes.value.length
  if (total === 0) return
  const dur = total * 600
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

// === 手寫 ===
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
