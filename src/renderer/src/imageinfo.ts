export type Adj = { brightness: number; contrast: number; saturation: number; grayscale: number }

export const NO_ADJ: Adj = { brightness: 100, contrast: 100, saturation: 100, grayscale: 0 }

const num = (v: number, lo: number, hi: number): number =>
  Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo

export const cleanAdj = (a: Partial<Adj> | null | undefined): Adj => ({
  brightness: num(Number(a?.brightness ?? 100), 50, 150),
  contrast: num(Number(a?.contrast ?? 100), 50, 150),
  saturation: num(Number(a?.saturation ?? 100), 0, 200),
  grayscale: num(Number(a?.grayscale ?? 0), 0, 100)
})

export const isNeutral = (a: Adj): boolean =>
  a.brightness === 100 && a.contrast === 100 && a.saturation === 100 && a.grayscale === 0

/** The same string previews with CSS `filter` and bakes with `ctx.filter`. */
export const adjustFilter = (a: Adj): string => {
  const adj = cleanAdj(a)
  return [
    `brightness(${Math.round(adj.brightness)}%)`,
    `contrast(${Math.round(adj.contrast)}%)`,
    `saturate(${Math.round(adj.saturation)}%)`,
    `grayscale(${Math.round(adj.grayscale)}%)`
  ].join(' ')
}

export const megapixels = (w: number, h: number): number => (Math.max(0, w) * Math.max(0, h)) / 1_000_000

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a)

/** «16:9», «3:2», … — well-known ratios win, otherwise the reduced fraction. */
export function aspectText(w: number, h: number): string {
  if (w <= 0 || h <= 0) return '—'
  const known: [number, number][] = [
    [1, 1],
    [3, 2],
    [4, 3],
    [5, 4],
    [16, 9],
    [16, 10],
    [21, 9],
    [2, 1],
    [3, 1]
  ]
  for (const [a, b] of known) {
    if (Math.abs(w / h - a / b) <= 0.01) return `${a}:${b}`
  }
  const d = gcd(Math.round(w), Math.round(h)) || 1
  return `${Math.round(w / d)}:${Math.round(h / d)}`
}

const hex = (r: number, g: number, b: number): string =>
  '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')

export type Swatch = { hex: string; share: number }

/**
 * Colours people would name: quantise to 4 bits per channel, count, then take the winners.
 * Transparent pixels are ignored; `share` is of the opaque pixels that were counted.
 */
export function dominantColors(data: Uint8ClampedArray, max = 5): Swatch[] {
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>()
  let counted = 0
  for (let i = 0; i + 3 < data.length; i += 4) {
    const a = data[i + 3]
    if (a < 16) continue
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
    const bucket = buckets.get(key)
    if (bucket) {
      bucket.n++
      bucket.r += r
      bucket.g += g
      bucket.b += b
    } else {
      buckets.set(key, { n: 1, r, g, b })
    }
    counted++
  }
  if (!counted) return []
  return [...buckets.values()]
    .sort((x, y) => y.n - x.n)
    .slice(0, Math.max(1, max))
    .map((b) => ({ hex: hex(b.r / b.n, b.g / b.n, b.b / b.n), share: b.n / counted }))
}

/** Luminance histogram (Rec. 709 weights), normalised to its tallest bin. */
export function luminanceHistogram(data: Uint8ClampedArray, bins = 48): number[] {
  const size = Math.max(2, Math.round(bins))
  const out = new Array<number>(size).fill(0)
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] < 16) continue
    const y = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
    const at = Math.min(size - 1, Math.max(0, Math.floor((y / 255) * size)))
    out[at]++
  }
  const peak = Math.max(...out, 0)
  return peak ? out.map((v) => v / peak) : out
}
