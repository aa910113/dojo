<script setup lang="ts">
// 描紅板:虛線田字格 + 淡色範字(SVG 文字)+ 可手寫的 canvas 疊層
// 筆跡用 0~1 的相對座標存,換尺寸 / 轉向時重畫不變形
const props = withDefaults(defineProps<{
  char: string
  showGuide?: boolean
}>(), { showGuide: true })

type Point = { x: number; y: number }
type Stroke = Point[]

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

function redraw() {
  if (!ctx) return
  ctx.clearRect(0, 0, cssSize, cssSize)
  for (const s of strokes.value) drawStroke(s)
  if (live) drawStroke(live)
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

watch(() => props.char, () => clear())

onMounted(() => {
  resize()
  ro = new ResizeObserver(() => resize())
  if (wrapEl.value) ro.observe(wrapEl.value)
})

onBeforeUnmount(() => {
  ro?.disconnect()
})

// getStrokes 回傳 [0,1] 相對座標的筆跡,給辨識器用
defineExpose({ clear, undo, hasInk, getStrokes: () => strokes.value })
</script>

<template>
  <div ref="wrapEl" class="trace-board">
    <svg class="trace-guide" viewBox="0 0 100 100" aria-hidden="true">
      <rect x="1" y="1" width="98" height="98" rx="6" class="guide-frame" />
      <line x1="50" y1="3" x2="50" y2="97" class="guide-dash" />
      <line x1="3" y1="50" x2="97" y2="50" class="guide-dash" />
      <text
        v-if="showGuide"
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
