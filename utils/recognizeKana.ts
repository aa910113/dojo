// 假名手寫辨識:把使用者的筆跡和 KanjiVG 的標準筆畫比對。
// 假名只有 46 個字形,而且我們知道正解是哪一個,所以做的是
// 「這筆跡像不像目標字,而且是不是比其他字更像」——排名比絕對門檻穩健得多。
//
// 筆畫資料來源:KanjiVG (Ulrich Apel),CC BY-SA 3.0。
import STROKE_DATA from '~/data/kana-strokes.json'

export type Pt = [number, number]
export interface RawPoint { x: number; y: number }

const REF = STROKE_DATA as unknown as Record<string, Pt[][]>
const N = 16               // 每筆重新取樣的點數
const REJECT_DIST = 0.42   // 連最像的字都超過這個距離 → 當作沒認出來
const ORDER_MAX = 0.13     // 筆順不同但形狀算對的上限

// 依弧長重新取樣成 N 點
function resample(pts: Pt[], n = N): Pt[] {
  if (pts.length === 0) return []
  if (pts.length === 1) return Array.from({ length: n }, () => [...pts[0]] as Pt)
  const seg: number[] = []
  const cum = [0]
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
    seg.push(d)
    cum.push(cum[i - 1] + d)
  }
  const total = cum[cum.length - 1]
  if (total === 0) return Array.from({ length: n }, () => [...pts[0]] as Pt)
  const out: Pt[] = []
  for (let s = 0; s < n; s++) {
    const target = (total * s) / (n - 1)
    let i = 1
    while (i < cum.length - 1 && cum[i] < target) i++
    const t = seg[i - 1] === 0 ? 0 : (target - cum[i - 1]) / seg[i - 1]
    out.push([
      pts[i - 1][0] + t * (pts[i][0] - pts[i - 1][0]),
      pts[i - 1][1] + t * (pts[i][1] - pts[i - 1][1]),
    ])
  }
  return out
}

// 以整個字的外框正規化到 [0,1],保留長寬比並置中(和產生參考資料時同一套)
function normalize(strokes: Pt[][]): Pt[][] {
  const all = strokes.flat()
  if (all.length === 0) return strokes
  const xs = all.map((p) => p[0])
  const ys = all.map((p) => p[1])
  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const minY = Math.min(...ys), maxY = Math.max(...ys)
  const w = maxX - minX, h = maxY - minY
  // 一橫或一豎這種極扁的筆畫,避免被放大成滿版
  const scale = 1 / Math.max(w, h, 0.12)
  const ox = (1 - w * scale) / 2
  const oy = (1 - h * scale) / 2
  return strokes.map((st) => st.map(([x, y]) => [(x - minX) * scale + ox, (y - minY) * scale + oy] as Pt))
}

function strokeDist(a: Pt[], b: Pt[]): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += Math.hypot(a[i][0] - b[i][0], a[i][1] - b[i][1])
  return sum / a.length
}

// 依筆順逐筆比對
function orderedDist(user: Pt[][], ref: Pt[][]): number {
  let sum = 0
  for (let i = 0; i < ref.length; i++) sum += strokeDist(user[i], ref[i])
  return sum / ref.length
}

// 不管筆順的最佳配對(貪心),用來判斷「形狀對但筆順不同」
function assignedDist(user: Pt[][], ref: Pt[][]): number {
  const used = new Set<number>()
  let sum = 0
  for (const r of ref) {
    let best = Infinity, bestI = -1
    for (let i = 0; i < user.length; i++) {
      if (used.has(i)) continue
      const d = strokeDist(user[i], r)
      if (d < best) { best = d; bestI = i }
    }
    used.add(bestI)
    sum += best
  }
  return sum / ref.length
}

export interface RecognizeResult {
  ok: boolean
  // 'ok' 認出目標字 | 'order' 形狀對但筆順不同 | 'strokes' 筆畫數不對
  // 'confused' 比較像別的字 | 'unknown' 認不出來 | 'empty' 沒有筆跡
  reason: 'ok' | 'order' | 'strokes' | 'confused' | 'unknown' | 'empty'
  confusedWith?: string
  expectedStrokes?: number
  gotStrokes?: number
}

export function recognizeKana(
  rawStrokes: RawPoint[][],
  target: string,
  script: 'hiragana' | 'katakana',
): RecognizeResult {
  const ref = REF[target]
  if (!ref) return { ok: false, reason: 'unknown' }
  const drawn = rawStrokes.filter((s) => s.length > 0)
  if (drawn.length === 0) return { ok: false, reason: 'empty' }

  const user = normalize(drawn.map((s) => resample(s.map((p) => [p.x, p.y] as Pt))))

  if (user.length !== ref.length) {
    return { ok: false, reason: 'strokes', expectedStrokes: ref.length, gotStrokes: user.length }
  }

  // 只跟同一種假名比:題目已經說了是平假名還是片假名,
  // 而且 へ/ヘ 這類跨腳本幾乎同形的字不該互相干擾
  const lo = script === 'hiragana' ? 0x3041 : 0x30a1
  const hi = script === 'hiragana' ? 0x309f : 0x30ff
  let bestChar = target
  let bestDist = Infinity
  for (const [ch, st] of Object.entries(REF)) {
    const cp = ch.codePointAt(0)!
    if (cp < lo || cp > hi) continue
    if (st.length !== user.length) continue
    const d = orderedDist(user, st)
    if (d < bestDist) { bestDist = d; bestChar = ch }
  }

  const targetOrdered = orderedDist(user, ref)
  if (bestDist > REJECT_DIST) return { ok: false, reason: 'unknown' }

  if (bestChar === target) return { ok: true, reason: 'ok' }

  // 形狀其實對得上,只是筆順不同 → 算寫對,另外提示筆順。
  // 這條寬容規則必須用絕對門檻:相對門檻在目標本來就不像時也會通過。
  const targetAssigned = assignedDist(user, ref)
  if (targetAssigned < ORDER_MAX && targetAssigned < targetOrdered) {
    // 再確認不管筆順時也沒有別的字更像
    let bestA = Infinity
    let bestAChar = target
    for (const [ch, st] of Object.entries(REF)) {
      const cp = ch.codePointAt(0)!
      if (cp < lo || cp > hi) continue
      if (st.length !== user.length) continue
      const d = assignedDist(user, st)
      if (d < bestA) { bestA = d; bestAChar = ch }
    }
    if (bestAChar === target) return { ok: true, reason: 'order' }
  }

  return { ok: false, reason: 'confused', confusedWith: bestChar }
}
