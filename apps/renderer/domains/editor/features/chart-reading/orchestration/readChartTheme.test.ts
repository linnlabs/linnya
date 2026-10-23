// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RENDERER_UI_THEME_ATTRIBUTE } from '@linnya/renderer-ui/theme'
import { CHART_PALETTES, FALLBACK_CHART_THEME } from '../definitions/chartTheme'
import { chartSchemeOfTheme, readActiveChartScheme, resolveChartTheme, sanitizeFontFamily } from './readChartTheme'

beforeEach(() => {
  // jsdom 没有 canvas：颜色解析函数按“解析不了就原样返回”降级，这里不需要它的告警。
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
})

afterEach(() => {
  vi.restoreAllMocks()
  document.documentElement.removeAttribute(RENDERER_UI_THEME_ATTRIBUTE)
  document.body.replaceChildren()
})

function mountHost(style: Record<string, string> = {}): HTMLElement {
  const host = document.createElement('div')
  for (const [name, value] of Object.entries(style)) host.style.setProperty(name, value)
  document.body.append(host)
  return host
}

describe('主题身份', () => {
  it('暗色主题用暗色色系，其余（含月白蓝）都用亮色色系', () => {
    expect(chartSchemeOfTheme('dark')).toBe('dark')
    expect(chartSchemeOfTheme('light')).toBe('light')
    expect(chartSchemeOfTheme('moonlight-blue')).toBe('light')
    expect(chartSchemeOfTheme(null)).toBe('light')
    document.documentElement.setAttribute(RENDERER_UI_THEME_ATTRIBUTE, 'dark')
    expect(readActiveChartScheme()).toBe('dark')
  })

  it('字体名里的双引号换成单引号，才能放进 SVG 属性', () => {
    expect(sanitizeFontFamily('"PingFang SC", system-ui')).toBe("'PingFang SC', system-ui")
  })
})

describe('resolveChartTheme', () => {
  it('色系由 scheme 与 palette 决定，默认是绿', () => {
    const host = mountHost()
    expect(resolveChartTheme(host, 'light').palette).toBe(CHART_PALETTES.verdant.light)
    expect(resolveChartTheme(host, 'dark').palette).toBe(CHART_PALETTES.verdant.dark)
    expect(resolveChartTheme(host, 'light', 'warm').palette).toBe(CHART_PALETTES.warm.light)
    expect(resolveChartTheme(host, 'dark', 'aqua').palette).toBe(CHART_PALETTES.aqua.dark)
  })

  it('提示框取界面的反色 token，文字取文字 token；缺失时用保守后备值', () => {
    const themed = resolveChartTheme(mountHost({
      '--color-bg-inverse': '#334455',
      '--color-text-inverse': '#f0f0f0',
      '--color-text-primary': '#101010',
      '--color-text-secondary': '#404040',
      '--color-text-muted': '#707070',
    }), 'light')
    expect(themed).toMatchObject({
      tooltipBackground: '#334455',
      tooltipText: '#f0f0f0',
      textPrimary: '#101010',
      textSecondary: '#404040',
      textMuted: '#707070',
    })

    const bare = resolveChartTheme(mountHost(), 'dark')
    expect(bare.tooltipBackground).toBe(FALLBACK_CHART_THEME.dark.tooltipBackground)
    expect(bare.tooltipText).toBe(FALLBACK_CHART_THEME.dark.tooltipText)
    expect(bare.textPrimary).toBe(FALLBACK_CHART_THEME.dark.textPrimary)
  })

  it('图表表面是所处页面第一个不透明的背景：外壳无底色时取到页面底色', () => {
    const page = mountHost({ 'background-color': 'rgb(250, 250, 247)' })
    const shell = document.createElement('div')
    const plot = document.createElement('div')
    shell.append(plot)
    page.append(shell)
    expect(resolveChartTheme(plot, 'light').surface).toBe('rgb(250, 250, 247)')
    expect(resolveChartTheme(mountHost(), 'light').surface).toBe(FALLBACK_CHART_THEME.light.surface)
  })
})
