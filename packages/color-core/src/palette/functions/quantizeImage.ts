import type { Oklab } from '../../definitions/color.js'
import { rgbToOklab } from '../../functions/colorSpace.js'
import type { PaletteImagePixels } from '../definitions/palette.js'
import { EDGE_PIXEL_WEIGHT, KMEANS_MAX_ITERATIONS, QUANTIZE_COLOR_COUNT } from '../definitions/paletteConstants.js'

/**
 * 一张图的主要颜色：先用 Wu 量化在 sRGB 5 位直方图上切出初值，再在 OKLab 里对直方图格子做加权 k-means。
 * 全程确定，不用随机初值；像素按画面位置加权（中心 1、边角 EDGE_PIXEL_WEIGHT），透明像素不计。
 */

export interface QuantizedColor {
  readonly lab: Oklab
  /** 该颜色在本图里的加权占比，0–1；全部颜色之和为 1。 */
  readonly share: number
}

const SIDE = 33
const SIDE_SQUARED = SIDE * SIDE
const CELL_COUNT = SIDE * SIDE * SIDE

type Axis = 0 | 1 | 2

interface Box {
  r0: number
  r1: number
  g0: number
  g1: number
  b0: number
  b1: number
  volume: number
}

function index(r: number, g: number, b: number): number {
  return r * SIDE_SQUARED + g * SIDE + b
}

interface Moments {
  readonly weight: Float64Array
  readonly red: Float64Array
  readonly green: Float64Array
  readonly blue: Float64Array
  readonly squares: Float64Array
}

function createMoments(): Moments {
  return {
    weight: new Float64Array(CELL_COUNT),
    red: new Float64Array(CELL_COUNT),
    green: new Float64Array(CELL_COUNT),
    blue: new Float64Array(CELL_COUNT),
    squares: new Float64Array(CELL_COUNT),
  }
}

function buildHistogram(image: PaletteImagePixels): Moments {
  const histogram = createMoments()
  const { width, height, data } = image
  const centerX = (width - 1) / 2
  const centerY = (height - 1) / 2
  const radius = Math.hypot(centerX, centerY) || 1
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4
      const alpha = data[offset + 3] ?? 0
      if (alpha < 128) continue
      const red = data[offset] ?? 0
      const green = data[offset + 1] ?? 0
      const blue = data[offset + 2] ?? 0
      const distance = Math.hypot(x - centerX, y - centerY) / radius
      const weight = 1 - (1 - EDGE_PIXEL_WEIGHT) * Math.min(1, distance)
      const cell = index((red >> 3) + 1, (green >> 3) + 1, (blue >> 3) + 1)
      histogram.weight[cell] = (histogram.weight[cell] ?? 0) + weight
      histogram.red[cell] = (histogram.red[cell] ?? 0) + weight * red
      histogram.green[cell] = (histogram.green[cell] ?? 0) + weight * green
      histogram.blue[cell] = (histogram.blue[cell] ?? 0) + weight * blue
      histogram.squares[cell] = (histogram.squares[cell] ?? 0) + weight * (red * red + green * green + blue * blue)
    }
  }
  return histogram
}

function cumulate(histogram: Moments): Moments {
  const moments = createMoments()
  const arrays = [
    [histogram.weight, moments.weight],
    [histogram.red, moments.red],
    [histogram.green, moments.green],
    [histogram.blue, moments.blue],
    [histogram.squares, moments.squares],
  ] as const
  for (const [source, target] of arrays) {
    for (let r = 1; r < SIDE; r += 1) {
      const area = new Float64Array(SIDE)
      for (let g = 1; g < SIDE; g += 1) {
        let line = 0
        for (let b = 1; b < SIDE; b += 1) {
          const cell = index(r, g, b)
          line += source[cell] ?? 0
          area[b] = (area[b] ?? 0) + line
          target[cell] = (target[cell - SIDE_SQUARED] ?? 0) + (area[b] ?? 0)
        }
      }
    }
  }
  return moments
}

function at(moment: Float64Array, r: number, g: number, b: number): number {
  return moment[index(r, g, b)] ?? 0
}

function volume(box: Box, moment: Float64Array): number {
  return at(moment, box.r1, box.g1, box.b1) - at(moment, box.r1, box.g1, box.b0)
    - at(moment, box.r1, box.g0, box.b1) + at(moment, box.r1, box.g0, box.b0)
    - at(moment, box.r0, box.g1, box.b1) + at(moment, box.r0, box.g1, box.b0)
    + at(moment, box.r0, box.g0, box.b1) - at(moment, box.r0, box.g0, box.b0)
}

function bottom(box: Box, axis: Axis, moment: Float64Array): number {
  if (axis === 0) {
    return -at(moment, box.r0, box.g1, box.b1) + at(moment, box.r0, box.g1, box.b0)
      + at(moment, box.r0, box.g0, box.b1) - at(moment, box.r0, box.g0, box.b0)
  }
  if (axis === 1) {
    return -at(moment, box.r1, box.g0, box.b1) + at(moment, box.r1, box.g0, box.b0)
      + at(moment, box.r0, box.g0, box.b1) - at(moment, box.r0, box.g0, box.b0)
  }
  return -at(moment, box.r1, box.g1, box.b0) + at(moment, box.r1, box.g0, box.b0)
    + at(moment, box.r0, box.g1, box.b0) - at(moment, box.r0, box.g0, box.b0)
}

function top(box: Box, axis: Axis, position: number, moment: Float64Array): number {
  if (axis === 0) {
    return at(moment, position, box.g1, box.b1) - at(moment, position, box.g1, box.b0)
      - at(moment, position, box.g0, box.b1) + at(moment, position, box.g0, box.b0)
  }
  if (axis === 1) {
    return at(moment, box.r1, position, box.b1) - at(moment, box.r1, position, box.b0)
      - at(moment, box.r0, position, box.b1) + at(moment, box.r0, position, box.b0)
  }
  return at(moment, box.r1, box.g1, position) - at(moment, box.r1, box.g0, position)
    - at(moment, box.r0, box.g1, position) + at(moment, box.r0, box.g0, position)
}

function variance(box: Box, moments: Moments): number {
  const red = volume(box, moments.red)
  const green = volume(box, moments.green)
  const blue = volume(box, moments.blue)
  const weight = volume(box, moments.weight)
  if (weight <= 0) return 0
  return volume(box, moments.squares) - (red * red + green * green + blue * blue) / weight
}

function maximize(box: Box, axis: Axis, first: number, last: number, moments: Moments, whole: readonly [number, number, number, number]): { score: number; cut: number } {
  const baseRed = bottom(box, axis, moments.red)
  const baseGreen = bottom(box, axis, moments.green)
  const baseBlue = bottom(box, axis, moments.blue)
  const baseWeight = bottom(box, axis, moments.weight)
  let best = 0
  let cut = -1
  for (let position = first; position < last; position += 1) {
    const halfRed = baseRed + top(box, axis, position, moments.red)
    const halfGreen = baseGreen + top(box, axis, position, moments.green)
    const halfBlue = baseBlue + top(box, axis, position, moments.blue)
    const halfWeight = baseWeight + top(box, axis, position, moments.weight)
    if (halfWeight <= 0) continue
    const restWeight = whole[3] - halfWeight
    if (restWeight <= 0) continue
    const restRed = whole[0] - halfRed
    const restGreen = whole[1] - halfGreen
    const restBlue = whole[2] - halfBlue
    const score = (halfRed * halfRed + halfGreen * halfGreen + halfBlue * halfBlue) / halfWeight
      + (restRed * restRed + restGreen * restGreen + restBlue * restBlue) / restWeight
    if (score > best) {
      best = score
      cut = position
    }
  }
  return { score: best, cut }
}

function cutBox(first: Box, second: Box, moments: Moments): boolean {
  const whole = [
    volume(first, moments.red),
    volume(first, moments.green),
    volume(first, moments.blue),
    volume(first, moments.weight),
  ] as const
  const red = maximize(first, 0, first.r0 + 1, first.r1, moments, whole)
  const green = maximize(first, 1, first.g0 + 1, first.g1, moments, whole)
  const blue = maximize(first, 2, first.b0 + 1, first.b1, moments, whole)
  let axis: Axis
  if (red.score >= green.score && red.score >= blue.score) {
    axis = 0
    if (red.cut < 0) return false
  } else if (green.score >= red.score && green.score >= blue.score) {
    axis = 1
  } else {
    axis = 2
  }
  second.r1 = first.r1
  second.g1 = first.g1
  second.b1 = first.b1
  if (axis === 0) {
    second.r0 = red.cut
    first.r1 = red.cut
    second.g0 = first.g0
    second.b0 = first.b0
  } else if (axis === 1) {
    if (green.cut < 0) return false
    second.g0 = green.cut
    first.g1 = green.cut
    second.r0 = first.r0
    second.b0 = first.b0
  } else {
    if (blue.cut < 0) return false
    second.b0 = blue.cut
    first.b1 = blue.cut
    second.r0 = first.r0
    second.g0 = first.g0
  }
  first.volume = (first.r1 - first.r0) * (first.g1 - first.g0) * (first.b1 - first.b0)
  second.volume = (second.r1 - second.r0) * (second.g1 - second.g0) * (second.b1 - second.b0)
  return true
}

function wuBoxes(moments: Moments, count: number): Box[] {
  const boxes: Box[] = [{ r0: 0, r1: SIDE - 1, g0: 0, g1: SIDE - 1, b0: 0, b1: SIDE - 1, volume: 0 }]
  const variances: number[] = [0]
  let next = 0
  for (let i = 1; i < count; i += 1) {
    const current = boxes[next]
    if (!current) break
    const fresh: Box = { r0: 0, r1: 0, g0: 0, g1: 0, b0: 0, b1: 0, volume: 0 }
    if (cutBox(current, fresh, moments)) {
      boxes.push(fresh)
      variances[next] = current.volume > 1 ? variance(current, moments) : 0
      variances[i] = fresh.volume > 1 ? variance(fresh, moments) : 0
    } else {
      variances[next] = 0
      i -= 1
    }
    next = 0
    let largest = variances[0] ?? 0
    for (let k = 1; k < boxes.length; k += 1) {
      if ((variances[k] ?? 0) > largest) {
        largest = variances[k] ?? 0
        next = k
      }
    }
    if (largest <= 0) break
  }
  return boxes
}

interface WeightedPoint {
  readonly lab: Oklab
  readonly weight: number
}

function distanceSquared(left: Oklab, right: Oklab): number {
  const dl = left.l - right.l
  const da = left.a - right.a
  const db = left.b - right.b
  return dl * dl + da * da + db * db
}

function kMeans(points: readonly WeightedPoint[], initial: readonly Oklab[]): QuantizedColor[] {
  let centroids = initial.slice()
  const assignment = new Int32Array(points.length).fill(-1)
  for (let iteration = 0; iteration < KMEANS_MAX_ITERATIONS; iteration += 1) {
    let changed = false
    points.forEach((point, pointIndex) => {
      let best = 0
      let bestDistance = Number.POSITIVE_INFINITY
      centroids.forEach((centroid, centroidIndex) => {
        const distance = distanceSquared(point.lab, centroid)
        if (distance < bestDistance) {
          bestDistance = distance
          best = centroidIndex
        }
      })
      if (assignment[pointIndex] !== best) {
        assignment[pointIndex] = best
        changed = true
      }
    })
    const sums = centroids.map(() => ({ l: 0, a: 0, b: 0, weight: 0 }))
    points.forEach((point, pointIndex) => {
      const sum = sums[assignment[pointIndex] ?? 0]
      if (!sum) return
      sum.l += point.lab.l * point.weight
      sum.a += point.lab.a * point.weight
      sum.b += point.lab.b * point.weight
      sum.weight += point.weight
    })
    centroids = sums.map((sum, centroidIndex) => sum.weight > 0
      ? { l: sum.l / sum.weight, a: sum.a / sum.weight, b: sum.b / sum.weight }
      : centroids[centroidIndex] ?? { l: 0, a: 0, b: 0 })
    if (!changed) break
  }
  const weights = new Float64Array(centroids.length)
  points.forEach((point, pointIndex) => {
    const cluster = assignment[pointIndex] ?? 0
    weights[cluster] = (weights[cluster] ?? 0) + point.weight
  })
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  if (total <= 0) return []
  return centroids
    .map((lab, centroidIndex) => ({ lab, share: (weights[centroidIndex] ?? 0) / total }))
    .filter(color => color.share > 0)
    .sort((left, right) => right.share - left.share)
}

export function quantizeImage(image: PaletteImagePixels, colorCount = QUANTIZE_COLOR_COUNT): QuantizedColor[] {
  const histogram = buildHistogram(image)
  const points: WeightedPoint[] = []
  for (let cell = 0; cell < CELL_COUNT; cell += 1) {
    const weight = histogram.weight[cell] ?? 0
    if (weight <= 0) continue
    points.push({
      lab: rgbToOklab([(histogram.red[cell] ?? 0) / weight, (histogram.green[cell] ?? 0) / weight, (histogram.blue[cell] ?? 0) / weight]),
      weight,
    })
  }
  if (points.length === 0) return []
  const moments = cumulate(histogram)
  const initial = wuBoxes(moments, colorCount)
    .map(box => {
      const weight = volume(box, moments.weight)
      if (weight <= 0) return null
      return rgbToOklab([volume(box, moments.red) / weight, volume(box, moments.green) / weight, volume(box, moments.blue) / weight])
    })
    .filter((lab): lab is Oklab => lab !== null)
  return kMeans(points, initial)
}
