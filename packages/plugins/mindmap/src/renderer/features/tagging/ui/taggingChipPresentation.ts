/**
 * MindMap tagging chip 的呈现契约。
 *
 * 中文说明：
 * - TaggingBadgeAddon 与 conversation 的 MindMapTagNodeCard 展示的是同一套 tagging 语义；
 * - 颜色值必须集中在这里，避免两边复制后出现“主界面一种颜色、对话工具卡片另一种颜色”；
 * - 目标 functional / semantic token 已进入运行时入口，这里禁止再写旧 token 或 hex fallback。
 */

export interface TaggingChipColors {
  backgroundColor?: string
  textColor?: string
  borderColor?: string
}

export interface TaggingKindDisplayConfig {
  label: string
  className: string
  tooltip: string
}

export const TAGGING_KIND_DISPLAY_MAP = {
  hypothesis: { label: '假设', className: 'mm-kind-badge--hypothesis', tooltip: '节点类型：假设' },
  question: { label: '问题', className: 'mm-kind-badge--question', tooltip: '节点类型：问题' },
  conclusion: { label: '结论', className: 'mm-kind-badge--conclusion', tooltip: '节点类型：结论' },
} as const satisfies Record<string, TaggingKindDisplayConfig>

export function getTaggingKindDisplayConfig(kind: string): TaggingKindDisplayConfig {
  switch (kind) {
    case 'hypothesis':
      return TAGGING_KIND_DISPLAY_MAP.hypothesis
    case 'question':
      return TAGGING_KIND_DISPLAY_MAP.question
    case 'conclusion':
      return TAGGING_KIND_DISPLAY_MAP.conclusion
    default:
      return {
        label: kind,
        className: 'mm-kind-badge--unknown',
        tooltip: `节点类型：${kind}`,
      }
  }
}

export const STATUS_COLORS: Record<string, TaggingChipColors> = {
  verified: {
    backgroundColor: 'color-mix(in srgb, var(--color-success) 14%, transparent)',
    textColor: 'var(--color-success)',
    borderColor: 'color-mix(in srgb, var(--color-success) 28%, transparent)',
  },
  refuted: {
    backgroundColor: 'color-mix(in srgb, var(--color-error) 14%, transparent)',
    textColor: 'var(--color-error)',
    borderColor: 'color-mix(in srgb, var(--color-error) 28%, transparent)',
  },
  closed: {
    backgroundColor: 'var(--color-bg-subtle)',
    textColor: 'var(--color-text-tertiary)',
    borderColor: 'color-mix(in srgb, var(--color-border-light) 70%, transparent)',
  },
  open: {
    backgroundColor: 'var(--color-bg-subtle)',
    textColor: 'var(--color-text-tertiary)',
    borderColor: 'color-mix(in srgb, var(--color-border-light) 60%, transparent)',
  },
  unknown: {
    backgroundColor: 'var(--color-bg-subtle)',
    textColor: 'var(--color-text-secondary)',
    borderColor: 'color-mix(in srgb, var(--color-border-light) 70%, transparent)',
  },
}

export const CONFIDENCE_COLORS: Record<string, TaggingChipColors> = {
  high: {
    backgroundColor: 'color-mix(in srgb, var(--color-success) 14%, transparent)',
    textColor: 'var(--color-success)',
    borderColor: 'color-mix(in srgb, var(--color-success) 28%, transparent)',
  },
  medium: {
    backgroundColor: 'color-mix(in srgb, var(--color-warning) 14%, transparent)',
    textColor: 'var(--color-warning)',
    borderColor: 'color-mix(in srgb, var(--color-warning) 28%, transparent)',
  },
  low: {
    backgroundColor: 'color-mix(in srgb, var(--color-error) 14%, transparent)',
    textColor: 'var(--color-error)',
    borderColor: 'color-mix(in srgb, var(--color-error) 28%, transparent)',
  },
  numeric: {
    backgroundColor: 'var(--color-bg-subtle)',
    textColor: 'var(--color-text-primary)',
    borderColor: 'color-mix(in srgb, var(--color-border-light) 70%, transparent)',
  },
  unknown: {
    backgroundColor: 'var(--color-bg-subtle)',
    textColor: 'var(--color-text-secondary)',
    borderColor: 'color-mix(in srgb, var(--color-border-light) 70%, transparent)',
  },
}

export const KIND_COLORS: Record<string, TaggingChipColors> = {
  'mm-kind-badge--hypothesis': {
    backgroundColor: 'color-mix(in srgb, var(--color-blue-500) 15%, transparent)',
    textColor: 'var(--color-blue-500)',
    borderColor: 'color-mix(in srgb, var(--color-blue-500) 30%, transparent)',
  },
  'mm-kind-badge--question': {
    backgroundColor: 'color-mix(in srgb, var(--mindmap-palette-purple) 15%, transparent)',
    textColor: 'var(--mindmap-palette-purple)',
    borderColor: 'color-mix(in srgb, var(--mindmap-palette-purple) 30%, transparent)',
  },
  'mm-kind-badge--conclusion': {
    backgroundColor: 'color-mix(in srgb, var(--color-success) 15%, transparent)',
    textColor: 'var(--color-success)',
    borderColor: 'color-mix(in srgb, var(--color-success) 30%, transparent)',
  },
  'mm-kind-badge--unknown': {
    backgroundColor: 'var(--color-bg-subtle)',
    textColor: 'var(--color-text-secondary)',
    borderColor: 'color-mix(in srgb, var(--color-border-light) 70%, transparent)',
  },
}
