import { describe, expect, it } from 'vitest'

import { createRandom, encodeRngId } from './random.js'
import { paletteFamilies } from './scorePalette.js'
import { describePalette } from './describePalette.js'
import type { PaletteImagePixels } from '../definitions/palette.js'
import { suggestPalettes } from '../orchestration/suggestPalettes.js'

type Rgb = readonly [number, number, number]

function blocks(parts: readonly (readonly [Rgb, number])[], seed: number): PaletteImagePixels {
  const size = 48
  const random = createRandom(seed)
  const data = new Uint8Array(size * size * 4)
  const total = parts.reduce((sum, [, share]) => sum + share, 0)
  let pixel = 0
  for (const [color, share] of parts) {
    const count = Math.round((share / total) * size * size)
    for (let i = 0; i < count && pixel < size * size; i += 1, pixel += 1) {
      color.forEach((channel, index) => { data[pixel * 4 + index] = Math.max(0, Math.min(255, Math.round(channel + (random() - 0.5) * 6))) })
      data[pixel * 4 + 3] = 255
    }
  }
  for (; pixel < size * size; pixel += 1) data[pixel * 4 + 3] = 255
  return { width: size, height: size, data }
}

describe('describePalette', () => {
  it('配色建议给出的每一套，只凭颜色值说出的底色和色系与建议里的一致', () => {
    const imageSets = [
      [blocks([[[89, 114, 100], 50], [[24, 22, 20], 40], [[151, 120, 88], 10]], 1), blocks([[[151, 120, 88], 60], [[200, 200, 198], 40]], 2)],
      [blocks([[[82, 126, 62], 55], [[200, 200, 198], 45]], 3)],
      [blocks([[[102, 131, 176], 40], [[65, 75, 39], 20], [[230, 230, 228], 40]], 4)],
    ]
    let checked = 0
    for (const [setIndex, images] of imageSets.entries()) {
      for (let seed = 0; seed < 40; seed += 1) {
        const result = suggestPalettes({ images, rng: encodeRngId(seed * 7 + setIndex) })
        if (result.kind !== 'palettes') throw new Error(result.kind)
        for (const palette of result.palettes) {
          expect(describePalette(palette.bg, palette.accent), palette.id).toEqual({ base: palette.base, families: paletteFamilies(palette) })
          checked += 1
        }
      }
    }
    expect(checked).toBeGreaterThan(300)
  })

  it('手写的配色归到最近的一档：纯白是浅底，米色和淡蓝是染纸，近黑和藏青是深底', () => {
    expect(describePalette('#FFFFFF', ['#1F6FC1'])?.base).toBe('light')
    expect(describePalette('#F5F0E6', ['#8A5A2B'])?.base).toBe('tint')
    expect(describePalette('#F0F5FC', ['#6884AF', '#4B9495'])).toEqual({ base: 'tint', families: ['蓝', '青'] })
    expect(describePalette('#141619', ['#90B5EE'])).toEqual({ base: 'dark', families: ['蓝'] })
    expect(describePalette('#1B2A44', ['#E3B04B'])?.base).toBe('dark')
  })

  it('强调色都是黑白灰时没有色系；底色写错时返回 null', () => {
    expect(describePalette('#FFFFFF', ['#222222', '#888888'])).toEqual({ base: 'light', families: [] })
    expect(describePalette('not-a-color', ['#1F6FC1'])).toBeNull()
  })
})
