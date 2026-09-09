export type KanaScript = 'hiragana' | 'katakana'

export interface KanaEntry {
  id: string
  char: string
  romaji: string
  accepts: string[]
  script: KanaScript
  row: string
}

const rows: Array<{ row: string; items: Array<[string, string, string, string[]?]> }> = [
  {
    row: 'a',
    items: [
      ['あ', 'ア', 'a'],
      ['い', 'イ', 'i'],
      ['う', 'ウ', 'u'],
      ['え', 'エ', 'e'],
      ['お', 'オ', 'o'],
    ],
  },
  {
    row: 'k',
    items: [
      ['か', 'カ', 'ka'],
      ['き', 'キ', 'ki'],
      ['く', 'ク', 'ku'],
      ['け', 'ケ', 'ke'],
      ['こ', 'コ', 'ko'],
    ],
  },
  {
    row: 's',
    items: [
      ['さ', 'サ', 'sa'],
      ['し', 'シ', 'shi', ['si']],
      ['す', 'ス', 'su'],
      ['せ', 'セ', 'se'],
      ['そ', 'ソ', 'so'],
    ],
  },
  {
    row: 't',
    items: [
      ['た', 'タ', 'ta'],
      ['ち', 'チ', 'chi', ['ti']],
      ['つ', 'ツ', 'tsu', ['tu']],
      ['て', 'テ', 'te'],
      ['と', 'ト', 'to'],
    ],
  },
  {
    row: 'n',
    items: [
      ['な', 'ナ', 'na'],
      ['に', 'ニ', 'ni'],
      ['ぬ', 'ヌ', 'nu'],
      ['ね', 'ネ', 'ne'],
      ['の', 'ノ', 'no'],
    ],
  },
  {
    row: 'h',
    items: [
      ['は', 'ハ', 'ha'],
      ['ひ', 'ヒ', 'hi'],
      ['ふ', 'フ', 'fu', ['hu']],
      ['へ', 'ヘ', 'he'],
      ['ほ', 'ホ', 'ho'],
    ],
  },
  {
    row: 'm',
    items: [
      ['ま', 'マ', 'ma'],
      ['み', 'ミ', 'mi'],
      ['む', 'ム', 'mu'],
      ['め', 'メ', 'me'],
      ['も', 'モ', 'mo'],
    ],
  },
  {
    row: 'y',
    items: [
      ['や', 'ヤ', 'ya'],
      ['ゆ', 'ユ', 'yu'],
      ['よ', 'ヨ', 'yo'],
    ],
  },
  {
    row: 'r',
    items: [
      ['ら', 'ラ', 'ra'],
      ['り', 'リ', 'ri'],
      ['る', 'ル', 'ru'],
      ['れ', 'レ', 're'],
      ['ろ', 'ロ', 'ro'],
    ],
  },
  {
    row: 'w',
    items: [
      ['わ', 'ワ', 'wa'],
      ['を', 'ヲ', 'wo', ['o']],
    ],
  },
  {
    row: 'n-special',
    items: [
      ['ん', 'ン', 'n', ['nn']],
    ],
  },
]

function buildAll(): KanaEntry[] {
  const list: KanaEntry[] = []
  for (const { row, items } of rows) {
    for (const [h, k, r, alts] of items) {
      const accepts = [r, ...(alts ?? [])]
      list.push({
        id: `h-${h}`,
        char: h,
        romaji: r,
        accepts,
        script: 'hiragana',
        row,
      })
      list.push({
        id: `k-${k}`,
        char: k,
        romaji: r,
        accepts,
        script: 'katakana',
        row,
      })
    }
  }
  return list
}

export const ALL_KANA: KanaEntry[] = buildAll()

export function getKanaById(id: string): KanaEntry | undefined {
  return ALL_KANA.find((k) => k.id === id)
}

// === 關卡(stage) ===
// 一關 = 一行(わ行與ん合併)。可選兩種順序:
//   separate = 平假名 10 關 → 片假名 10 關
//   mixed    = 每關同時包含同一行的平假名與片假名(10 關,每關 10 字)
// 通過目前關卡的測驗(該關全部一次答對)才解鎖下一關。
export type StageMode = 'separate' | 'mixed'

export interface Stage {
  index: number
  // 組成這一關的「腳本:行序」,是穩定識別碼,切換學習順序後通過紀錄不會歸零
  parts: string[]
  script: KanaScript | 'both'
  label: string
  cardIds: string[]
  chars: string[]
  // 顯示用:每個腳本一行,避免 mixed 模式 10 個字擠成一列
  charLines: string[][]
}

export const STAGE_ROW_GROUPS: string[][] = [
  ['a'], ['k'], ['s'], ['t'], ['n'], ['h'], ['m'], ['y'], ['r'], ['w', 'n-special'],
]

export const SCRIPT_ORDER: KanaScript[] = ['hiragana', 'katakana']

export function stagePartKey(script: KanaScript, rowIndex: number): string {
  return `${script}:${rowIndex}`
}

function rowCards(script: KanaScript, rowGroup: string[]): KanaEntry[] {
  return ALL_KANA.filter((k) => k.script === script && rowGroup.includes(k.row))
}

function rowLabel(cards: KanaEntry[], rowGroup: string[]): string {
  const first = cards[0]
  return rowGroup.length > 1
    ? `${first.char}行・${cards[cards.length - 1].char}`
    : `${first.char}行`
}

export function buildStages(scripts: KanaScript[], mode: StageMode): Stage[] {
  const picked = SCRIPT_ORDER.filter((s) => scripts.includes(s))
  const use = picked.length > 0 ? picked : SCRIPT_ORDER
  const out: Stage[] = []

  const push = (parts: string[], script: KanaScript | 'both', label: string, groups: KanaEntry[][]) => {
    out.push({
      index: out.length,
      parts,
      script,
      label,
      cardIds: groups.flat().map((k) => k.id),
      chars: groups.flat().map((k) => k.char),
      charLines: groups.map((g) => g.map((k) => k.char)),
    })
  }

  if (use.length > 1 && mode === 'mixed') {
    STAGE_ROW_GROUPS.forEach((rowGroup, r) => {
      const groups = use.map((sc) => rowCards(sc, rowGroup))
      push(
        use.map((sc) => stagePartKey(sc, r)),
        'both',
        rowLabel(groups[0], rowGroup),
        groups,
      )
    })
    return out
  }

  for (const script of use) {
    STAGE_ROW_GROUPS.forEach((rowGroup, r) => {
      const cards = rowCards(script, rowGroup)
      push([stagePartKey(script, r)], script, rowLabel(cards, rowGroup), [cards])
    })
  }
  return out
}

// 舊資料的 passedStages(數字)是照這個順序算的
export const LEGACY_PART_ORDER: string[] = SCRIPT_ORDER.flatMap((sc) =>
  STAGE_ROW_GROUPS.map((_, r) => stagePartKey(sc, r)),
)

export const STAGES: Stage[] = buildStages(SCRIPT_ORDER, 'separate')
