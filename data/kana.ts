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
