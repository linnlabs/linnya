import { describe, expect, it } from 'vitest'
import { DirectionClass } from '../domain/types'
import { main } from '../shared/utils/layout/generateBranch'

function extractNumbers(path: string): number[] {
  return Array.from(path.matchAll(/-?\d+(?:\.\d+)?/g), match => Number(match[0]))
}

describe('mindmap branch generation', () => {
  it('keeps right-side main branch using the current smooth fan-out shape', () => {
    const path = main({
      pT: 5000,
      pL: 1000,
      pW: 320,
      pH: 48,
      cT: 50,
      cL: 2400,
      cW: 360,
      cH: 80,
      direction: DirectionClass.RIGHT,
      containerHeight: 520,
    })

    const values = extractNumbers(path)
    const startX = values[0]
    const firstLineX = values[2]

    expect(path).toContain(' Q ')
    expect(firstLineX).toBeGreaterThan(startX)
  })

  it('keeps left-side main branch using the current smooth fan-out shape', () => {
    const path = main({
      pT: 5000,
      pL: 1800,
      pW: 320,
      pH: 48,
      cT: 50,
      cL: 500,
      cW: 360,
      cH: 80,
      direction: DirectionClass.LEFT,
      containerHeight: 520,
    })

    const values = extractNumbers(path)
    const startX = values[0]
    const firstLineX = values[2]

    expect(path).toContain(' Q ')
    expect(firstLineX).toBeLessThan(startX)
  })
})
