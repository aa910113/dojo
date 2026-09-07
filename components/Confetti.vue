<script setup lang="ts">
// 滿版彩帶 + 紙花:canvas 畫,掛載時從左右下角噴出,加上頂端灑落;
// 粒子落出畫面就結束。prefers-reduced-motion 時不播。
const props = withDefaults(defineProps<{
  intensity?: number   // 1 = 一般,2 = 盛大
  colors?: string[]
}>(), {
  intensity: 1,
  colors: () => ['#f2c14e', '#d9756a', '#9ccbe0', '#6cb58d', '#4f8db3', '#fdfcf9'],
})

interface Piece {
  x: number
  y: number
  vx: number
  vy: number
  w: number
  h: number
  rot: number
  vr: number
  color: string
  kind: 'flake' | 'ribbon'
  phase: number
  life: number
}

const canvasEl = ref<HTMLCanvasElement | null>(null)
let raf = 0
let pieces: Piece[] = []
let ctx: CanvasRenderingContext2D | null = null
let W = 0
let H = 0
let dpr = 1
let startAt = 0
let lastEmit = 0

function rand(a: number, b: number) {
  return a + Math.random() * (b - a)
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function spawnBurst(x: number, y: number, dir: number, count: number) {
  for (let i = 0; i < count; i++) {
    const ribbon = Math.random() < 0.3
    const speed = rand(9, 16) * (0.8 + props.intensity * 0.2)
    const ang = dir + rand(-0.45, 0.45)
    pieces.push({
      x,
      y,
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed,
      w: ribbon ? rand(6, 9) : rand(7, 12),
      h: ribbon ? rand(40, 70) : rand(4, 8),
      rot: rand(0, Math.PI * 2),
      vr: rand(-0.25, 0.25),
      color: pick(props.colors),
      kind: ribbon ? 'ribbon' : 'flake',
      phase: rand(0, Math.PI * 2),
      life: 0,
    })
  }
}

function spawnRain(count: number) {
  for (let i = 0; i < count; i++) {
    const ribbon = Math.random() < 0.25
    pieces.push({
      x: rand(0, W),
      y: rand(-40, -10),
      vx: rand(-1.2, 1.2),
      vy: rand(2, 4),
      w: ribbon ? rand(6, 9) : rand(7, 12),
      h: ribbon ? rand(40, 70) : rand(4, 8),
      rot: rand(0, Math.PI * 2),
      vr: rand(-0.2, 0.2),
      color: pick(props.colors),
      kind: ribbon ? 'ribbon' : 'flake',
      phase: rand(0, Math.PI * 2),
      life: 0,
    })
  }
}

function resize() {
  const c = canvasEl.value
  if (!c) return
  dpr = Math.min(2, window.devicePixelRatio || 1)
  W = window.innerWidth
  H = window.innerHeight
  c.width = Math.round(W * dpr)
  c.height = Math.round(H * dpr)
  c.style.width = `${W}px`
  c.style.height = `${H}px`
  ctx = c.getContext('2d')
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0)
}

function drawPiece(p: Piece) {
  if (!ctx) return
  ctx.save()
  ctx.translate(p.x, p.y)
  ctx.fillStyle = p.color
  if (p.kind === 'flake') {
    ctx.rotate(p.rot)
    // 用 cos 模擬翻面,寬度會忽寬忽窄
    const sx = Math.max(0.15, Math.abs(Math.cos(p.life * 0.15 + p.phase)))
    ctx.fillRect(-p.w / 2 * sx, -p.h / 2, p.w * sx, p.h)
  } else {
    // 彩帶:從頭到尾用正弦擺動的細長條
    ctx.rotate(p.rot * 0.2)
    ctx.beginPath()
    const segs = 8
    for (let i = 0; i <= segs; i++) {
      const t = i / segs
      const yy = t * p.h
      const xx = Math.sin(p.phase + p.life * 0.12 + t * 4) * p.w * 0.9
      if (i === 0) ctx.moveTo(xx, yy)
      else ctx.lineTo(xx, yy)
    }
    ctx.lineWidth = p.w * 0.55
    ctx.strokeStyle = p.color
    ctx.lineCap = 'round'
    ctx.stroke()
  }
  ctx.restore()
}

function frame(now: number) {
  if (!ctx) return
  const elapsed = now - startAt
  // 前 0.9 秒左右下角持續噴,前 2 秒頂端灑落
  if (elapsed < 900 && now - lastEmit > 60) {
    lastEmit = now
    const n = Math.round(6 * props.intensity)
    spawnBurst(0, H * 0.72, -Math.PI / 2 + 0.45, n)
    spawnBurst(W, H * 0.72, -Math.PI / 2 - 0.45, n)
  }
  if (elapsed < 2000 && Math.random() < 0.6) spawnRain(Math.round(2 * props.intensity))

  ctx.clearRect(0, 0, W, H)
  const alive: Piece[] = []
  for (const p of pieces) {
    p.life += 1
    p.vy += 0.22               // 重力
    p.vx *= 0.985              // 阻力
    p.vy *= 0.985
    p.x += p.vx + Math.sin(p.life * 0.08 + p.phase) * 0.6
    p.y += p.vy
    p.rot += p.vr
    if (p.y < H + 80) {
      drawPiece(p)
      alive.push(p)
    }
  }
  pieces = alive
  if (pieces.length > 0 || elapsed < 2200) {
    raf = requestAnimationFrame(frame)
  } else {
    ctx.clearRect(0, 0, W, H)
  }
}

onMounted(() => {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  resize()
  window.addEventListener('resize', resize)
  pieces = []
  const s = Math.round(40 * props.intensity)
  // 開場一大發
  spawnBurst(0, H * 0.75, -Math.PI / 2 + 0.5, s)
  spawnBurst(W, H * 0.75, -Math.PI / 2 - 0.5, s)
  spawnRain(Math.round(30 * props.intensity))
  startAt = performance.now()
  lastEmit = startAt
  raf = requestAnimationFrame(frame)
})

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  window.removeEventListener('resize', resize)
})
</script>

<template>
  <canvas ref="canvasEl" class="confetti" aria-hidden="true" />
</template>

<style scoped>
.confetti {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 50;
}
</style>
