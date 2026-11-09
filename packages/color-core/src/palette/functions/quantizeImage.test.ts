import { describe, expect, it } from 'vitest'
import { deltaEOK, rgbToOklab } from '../../functions/colorSpace.js'
import { quantizeImage } from './quantizeImage.js'

function image(colors: readonly (readonly [number, number, number])[], size = 32) {
  const data = new Uint8Array(size * size * 4)
  for (let pixel = 0; pixel < size * size; pixel += 1) {
    const color = colors[Math.floor((pixel / (size * size)) * colors.length)] ?? [0, 0, 0]
    data.set([color[0], color[1], color[2], 255], pixel * 4)
  }
  return { width: size, height: size, data }
}

describe('量化', () => {
  it('纯色图只有一种颜色，占比为 1', () => {
    const [only, ...rest] = quantizeImage(image([[46, 107, 87]]))
    expect(rest).toHaveLength(0)
    expect(only?.share).toBeCloseTo(1, 6)
    expect(deltaEOK(only?.lab ?? { l: 0, a: 0, b: 0 }, rgbToOklab([46, 107, 87]))).toBeLessThan(0.02)
  })

  it('两色各半：两种颜色，占比都接近一半，结果确定', () => {
    const input = image([[200, 40, 40], [40, 80, 200]])
    const first = quantizeImage(input)
    expect(first).toHaveLength(2)
    first.forEach(color => expect(color.share).toBeGreaterThan(0.35))
    expect(quantizeImage(input)).toEqual(first)
  })

  it('透明像素不计', () => {
    const transparent = image([[200, 40, 40], [40, 80, 200]])
    for (let pixel = 0; pixel < 512; pixel += 1) transparent.data[pixel * 4 + 3] = 0
    const colors = quantizeImage(transparent)
    expect(colors).toHaveLength(1)
  })
})
