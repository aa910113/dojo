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
// 一關 = 一行(わ行與ん合併)。順序:平假名全部 → 片假名全部。
// 通過目前關卡的測驗(該關全部一次答對)才解鎖下一關。
export interface Stage {
  index: number
  script: KanaScript
  label: string
  cardIds: string[]
  chars: string[]
}

const STAGE_ROW_GROUPS: string[][] = [
  ['a'], ['k'], ['s'], ['t'], ['n'], ['h'], ['m'], ['y'], ['r'], ['w', 'n-special'],
]

function buildStages(): Stage[] {
  const out: Stage[] = []
  for (const script of ['hiragana', 'katakana'] as KanaScript[]) {
    for (const rowGroup of STAGE_ROW_GROUPS) {
      const cards = ALL_KANA.filter((k) => k.script === script && rowGroup.includes(k.row))
      const first = cards[0]
      const label = rowGroup.length > 1
        ? `${first.char}行・${cards[cards.length - 1].char}`
        : `${first.char}行`
      out.push({
        index: out.length,
        script,
        label,
        cardIds: cards.map((k) => k.id),
        chars: cards.map((k) => k.char),
      })
    }
  }
  return out
}

export const STAGES: Stage[] = buildStages()

export function stageOfCard(id: string): Stage | undefined {
  return STAGES.find((s) => s.cardIds.includes(id))
}
