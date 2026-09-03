import { describe, expect, it } from 'vitest'
import { DARK_THEME, THEME } from '../domain/constants'
import type { Theme } from '../domain/types'
import { resolveMindMapTheme } from '../shared/utils/theme'

describe('mindmap theme normalization', () => {
  it('uses current light palette for persisted built-in light themes', () => {
    const persistedTheme: Theme = {
      name: THEME.name,
      type: 'light',
      palette: ['legacy-light-palette-entry'],
      cssVar: THEME.cssVar,
    }

    expect(resolveMindMapTheme(persistedTheme)).toBe(THEME)
  })

  it('uses current dark palette for persisted built-in dark themes', () => {
    const persistedTheme: Theme = {
      name: DARK_THEME.name,
      type: 'dark',
      palette: ['legacy-dark-palette-entry'],
      cssVar: DARK_THEME.cssVar,
    }

    expect(resolveMindMapTheme(persistedTheme)).toBe(DARK_THEME)
  })

  it('resolves default persisted themes from current preferred scheme', () => {
    const persistedTheme: Theme = {
      name: 'default',
      type: 'light',
      palette: ['legacy-default-palette-entry'],
      cssVar: THEME.cssVar,
    }

    expect(resolveMindMapTheme(persistedTheme, false)).toBe(THEME)
    expect(resolveMindMapTheme(persistedTheme, true)).toBe(DARK_THEME)
  })

  it('keeps custom theme palette while completing current css variables', () => {
    const customPalette = ['custom-branch-color']
    const customTheme: Theme = {
      name: 'Custom',
      type: 'light',
      palette: customPalette,
      cssVar: {
        ...THEME.cssVar,
        '--main-gap-x': '96px',
      },
    }

    const resolved = resolveMindMapTheme(customTheme)

    expect(resolved).not.toBe(customTheme)
    expect(resolved.palette).toBe(customPalette)
    expect(resolved.cssVar['--main-gap-x']).toBe('96px')
    expect(resolved.cssVar['--mindmap-svg-label-color']).toBe(THEME.cssVar['--mindmap-svg-label-color'])
  })
})
