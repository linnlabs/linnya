import { DARK_THEME, THEME } from '../../../domain/constants'
import type { MindMapInstance } from '../../../domain/types/index'
import type { Theme } from '../../../domain/types/index'

/**
 * 中文说明：
 * - MindMapData 会持久化 theme 对象，旧版本内置主题里保存过旧 palette token。
 * - 内置主题的真实来源应始终是当前 domain constants，避免旧文档把过期 palette 重新带回渲染链路。
 * - 非内置自定义主题仍保留自己的 palette / cssVar，只补齐当前基础变量。
 */
export const resolveMindMapTheme = (theme: Theme | undefined, prefersDark = false): Theme => {
  const preferredBase = prefersDark ? DARK_THEME : THEME
  if (!theme) return preferredBase

  const explicitBase = theme.type === 'dark' ? DARK_THEME : THEME
  if (theme.name === THEME.name) return THEME
  if (theme.name === DARK_THEME.name) return DARK_THEME
  if (theme.name === 'default') return preferredBase

  return {
    ...theme,
    palette: Array.isArray(theme.palette) && theme.palette.length > 0 ? theme.palette : explicitBase.palette,
    cssVar: {
      ...explicitBase.cssVar,
      ...theme.cssVar,
    },
  }
}

const readCurrentPreferredDark = (mind: MindMapInstance): boolean => {
  if (mind.theme?.type === 'dark') return true
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export const changeTheme = function (this: MindMapInstance, theme: Theme, shouldRefresh = true) {
  const nextTheme = resolveMindMapTheme(theme, readCurrentPreferredDark(this))
  this.theme = nextTheme
  const cssVar = nextTheme.cssVar
  const keys = Object.keys(cssVar) as (keyof typeof cssVar)[]
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]
    this.container.style.setProperty(key as string, cssVar[key] as string)
  }
  shouldRefresh && this.refresh()
}
