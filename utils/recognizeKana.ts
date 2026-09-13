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
// 絕對門檻:光看排名不夠 —— 數字、直線這類根本不是假名的東西,
// 在 46 個候選裡總會有一個「最接近」。門檻由模擬資料訂出:
// 正常書寫的距離中位數約 0.03-0.05,而各種塗鴉最近也要 0.086 以上。
// 門檻由模擬「真人差異」訂出:每一筆各自縮放位移、整體長寬比與傾斜改變、
// 端點漂移,再加上手抖。這類變形下正確書寫的距離幾乎都在 0.16 以內。
const MAX_DIST = 0.16      // 超過就當作沒寫對/認不出來
const ORDER_MAX = 0.18     // 筆順不同但形狀算對的上限
// 只靠距離擋不掉直線類塗鴉(數字 1、兩條豎線),因為它們和較直的假名距離很近。
// 改用單向的彎曲度否決:該彎的筆畫寫成直線就退回,但寫得比標準更彎(手抖)不罰。
const STRAIGHT_MAX = 0.35
// 正規化後的外框比例:細長的「1」和較寬的「く」差很多,靠這個擋掉
const BOX_MAX = 0.32
// 距離在這個值以內算「對得很好」,不再多問;超過才加驗筆畫的彎度,
// 因為正確書寫幾乎都落在 0.10 以內,而數字 1 對上「く」是 0.12
const CONFIDENT_DIST = 0.10
// 中段偏離起訖連線的幅度比標準少這麼多 → 寫得太直
const BULGE_MAX = 0.15

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

// 彈性比對 (DTW):逐點硬對齊會因為「哪一段寫得長一點」就判失敗,
// 允許局部伸縮才容得下真人的比例差異。band 限制避免退化成亂配。
function strokeDist(a: Pt[], b: Pt[], band = 3): number {
  const n = a.length, m = b.length
  const INF = Number.POSITIVE_INFINITY
  let prev = new Array<number>(m + 1).fill(INF)
  let cur = new Array<number>(m + 1).fill(INF)
  prev[0] = 0
  for (let i = 1; i <= n; i++) {
    cur.fill(INF)
    const lo = Math.max(1, i - band)
    const hi = Math.min(m, i + band)
    for (let j = lo; j <= hi; j++) {
      const c = Math.hypot(a[i - 1][0] - b[j - 1][0], a[i - 1][1] - b[j - 1][1])
      cur[j] = c + Math.min(prev[j], cur[j - 1], prev[j - 1])
    }
    const t = prev; prev = cur; cur = t
  }
  return prev[m] / Math.max(n, m)
}

// 一筆的總轉彎量(以 π 為單位):直線接近 0,有彎的筆畫明顯較大
function turning(st: Pt[]): number {
  let total = 0
  for (let i = 2; i < st.length; i++) {
    const a = Math.atan2(st[i - 1][1] - st[i - 2][1], st[i - 1][0] - st[i - 2][0])
    const b = Math.atan2(st[i][1] - st[i - 1][1], st[i][0] - st[i - 1][0])
    let d = b - a
    d = Math.atan2(Math.sin(d), Math.cos(d))
    total += Math.abs(d)
  }
  return total / Math.PI
}

// 正規化後佔的長寬(其中較長的一邊會是 1)
function extents(strokes: Pt[][]): [number, number] {
  const all = strokes.flat()
  const xs = all.map((p) => p[0])
  const ys = all.map((p) => p[1])
  return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)]
}

// 一筆中段偏離「起點到終點連線」的最大距離。頭尾各略過兩點,
// 這樣起筆的小勾(例如數字 1 的頭)不會被當成彎曲
function bulge(st: Pt[]): number {
  const a = st[0]
  const b = st[st.length - 1]
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len = Math.hypot(dx, dy) || 1e-6
  let worst = 0
  for (let i = 2; i < st.length - 2; i++) {
    const d = Math.abs((st[i][0] - a[0]) * dy - (st[i][1] - a[1]) * dx) / len
    if (d > worst) worst = d
  }
  return worst
}

// 比標準少彎多少(只看寫太直)
function bulgeDeficit(user: Pt[][], ref: Pt[][]): number {
  let worst = -Infinity
  for (let i = 0; i < ref.length; i++) worst = Math.max(worst, bulge(ref[i]) - bulge(user[i]))
  return worst
}

// 「比標準直多少」的最大值。只看寫太直,不管寫太彎
function straightness(user: Pt[][], ref: Pt[][]): number {
  let worst = -Infinity
  for (let i = 0; i < ref.length; i++) worst = Math.max(worst, turning(ref[i]) - turning(user[i]))
  return worst
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
  // 診斷用:和目標字的距離、以及最接近的候選字距離(越小越像)
  dist?: number
  bestDist?: number
  bestChar?: string
  // 'ok' 認出目標字 | 'order' 形狀對但筆順不同 | 'strokes' 筆畫數不對
  // 'straight' 該彎的筆畫寫成直線 | 'shape' 整體比例差太多
  // 'confused' 比較像別的字
  // 'unknown' 認不出來 | 'empty' 沒有筆跡
  reason: 'ok' | 'order' | 'strokes' | 'straight' | 'shape' | 'confused' | 'unknown' | 'empty'
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
  const diag = { dist: +targetOrdered.toFixed(4), bestDist: +bestDist.toFixed(4), bestChar }

  // 先過絕對門檻:連最接近的候選都差太多 → 這根本不是假名
  if (bestDist > MAX_DIST) return { ok: false, reason: 'unknown', ...diag }
  // 再擋直線類塗鴉:該彎的筆畫被寫成直線
  if (straightness(user, ref) > STRAIGHT_MAX) return { ok: false, reason: 'straight', ...diag }
  // 外框比例差太多(例如細長的數字 1 對上較寬的假名)
  const [uw, uh] = extents(user)
  const [rw, rh] = extents(ref)
  if (Math.abs(uw - rw) > BOX_MAX || Math.abs(uh - rh) > BOX_MAX) {
    return { ok: false, reason: 'shape', ...diag }
  }
  // 對得不夠好的時候,再看筆畫是不是該彎卻寫得太直
  if (bestDist > CONFIDENT_DIST && bulgeDeficit(user, ref) > BULGE_MAX) {
    return { ok: false, reason: 'straight', ...diag }
  }

  if (bestChar === target) return { ok: true, reason: 'ok', ...diag }

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
    if (bestAChar === target) return { ok: true, reason: 'order', ...diag }
  }

  return { ok: false, reason: 'confused', confusedWith: bestChar, ...diag }
}
