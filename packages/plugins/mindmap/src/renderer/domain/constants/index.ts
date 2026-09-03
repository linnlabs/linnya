import type { Theme } from '../types/index'

export const LEFT = 0
export const RIGHT = 1
export const SIDE = 2
export const DOWN = 3

const baseSpacingVars = {
  '--node-gap-x': '22px',
  '--node-gap-y': '12px',
  '--main-gap-x': '120px',
  '--main-gap-y': '36px',
  '--root-radius': '32px',
  '--main-radius': '18px',
  '--topic-padding': '6px 20px',
  '--map-padding': '60px 80px',
  '--topic-radius': '10px',
} as const

const baseRenderColorVars = {
  '--mindmap-svg-label-color': 'var(--color-text-secondary)',
  '--mindmap-svg-path-stroke': 'var(--color-text-secondary)',
  '--mindmap-link-controller-stroke': 'var(--color-info)',
  '--mindmap-arrow-stroke': 'var(--color-error)',
  '--mindmap-arrow-label-color': 'var(--color-error)',
} as const

export const MINDMAP_RENDER_COLORS = {
  svgLabel: 'var(--mindmap-svg-label-color)',
  svgPathStroke: 'var(--mindmap-svg-path-stroke)',
  linkControllerStroke: 'var(--mindmap-link-controller-stroke)',
  arrowStroke: 'var(--mindmap-arrow-stroke)',
  arrowLabel: 'var(--mindmap-arrow-label-color)',
} as const

export const THEME: Theme = {
  name: 'Linnya Light',
  type: 'light',
  palette: [
    'var(--color-red-350)',
    'var(--mindmap-palette-orange)',
    'var(--color-yellow-500)',
    'var(--color-brand-600)',
    'var(--mindmap-palette-cyan)',
    'var(--color-blue-500)',
    'var(--mindmap-palette-purple)',
    'var(--mindmap-palette-pink)',
    'var(--mindmap-palette-brown)',
    'var(--color-gray-600)',
  ],
  cssVar: {
    ...baseSpacingVars,
    ...baseRenderColorVars,
    '--root-color': 'var(--color-white)',
    '--root-bgcolor': 'var(--color-accent)',
    '--root-border-color': 'transparent',
    '--main-color': 'var(--color-text-primary)',
    '--main-bgcolor': 'var(--color-bg-surface)',
    '--color': 'var(--color-text-secondary)',
    '--bgcolor': 'var(--color-bg-default)',
    '--selected': 'var(--color-accent)',
    '--accent-color': 'var(--color-accent)',
    '--panel-color': 'var(--color-text-primary)',
    '--panel-bgcolor': 'var(--color-bg-surface)',
    '--panel-border-color': 'var(--color-border-light)',
    '--expander-color': 'var(--color-text-secondary)',
  },
}

export const DARK_THEME: Theme = {
  name: 'Linnya Dark',
  type: 'dark',
  palette: [
    'var(--color-red-300)',
    'var(--mindmap-palette-dark-orange)',
    'var(--color-yellow-300)',
    'var(--color-brand-400)',
    'var(--mindmap-palette-dark-cyan)',
    'var(--color-blue-300)',
    'var(--mindmap-palette-dark-purple)',
    'var(--mindmap-palette-dark-pink)',
    'var(--mindmap-palette-dark-brown)',
    'var(--color-gray-200)',
  ],
  cssVar: {
    ...baseSpacingVars,
    ...baseRenderColorVars,
    '--root-color': 'var(--color-white)',
    '--root-bgcolor': 'var(--color-accent)',
    '--root-border-color': 'color-mix(in srgb, var(--color-white) 12%, transparent)',
    '--main-color': 'var(--color-text-primary)',
    '--main-bgcolor': 'var(--color-bg-surface)',
    '--color': 'var(--color-text-secondary)',
    '--bgcolor': 'var(--color-bg-default)',
    '--selected': 'var(--color-accent)',
    '--accent-color': 'var(--color-accent)',
    '--panel-color': 'var(--color-text-primary)',
    '--panel-bgcolor': 'var(--color-bg-surface)',
    '--panel-border-color': 'var(--color-border-light)',
    '--expander-color': 'var(--color-text-secondary)',
  },
}
