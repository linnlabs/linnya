import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

/** 根块语义由 Editor 的全部 NodeView、序列化与只读预览共用。 */
export const ROOT_BLOCK_CONTENT_ATTRS = {
  contentType: 'data-content-type',
  headingLevel: 'data-heading-level',
  listType: 'data-list-type',
} as const;
export interface RootBlockColorAttributes {
  backgroundColor?: unknown;
  textColor?: unknown;
}

function readColorAttribute(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function toColorVariable(prefix: 'block-bg' | 'block-text', value: string): string {
  return `var(--${prefix}-${value.replace('_bg', '').replace('_text', '')})`
}

export function resolveRootBlockColorStyle(
  attrs: RootBlockColorAttributes
): Record<string, string> {
  const style: Record<string, string> = {}
  const bgColor = readColorAttribute(attrs.backgroundColor)
  const textColor = readColorAttribute(attrs.textColor)

  if (bgColor) style.backgroundColor = toColorVariable('block-bg', bgColor)
  if (textColor) style.color = toColorVariable('block-text', textColor)

  return style
}

export function applyRootBlockColorStyle(
  rootBlockEl: HTMLElement,
  attrs: RootBlockColorAttributes
): void {
  const style = resolveRootBlockColorStyle(attrs)

  if (style.backgroundColor) {
    rootBlockEl.style.setProperty('background-color', style.backgroundColor)
  } else {
    rootBlockEl.style.removeProperty('background-color')
  }

  if (style.color) {
    rootBlockEl.style.setProperty('color', style.color)
  } else {
    rootBlockEl.style.removeProperty('color')
  }
}


export function resolveRootBlockContentAttributes(
  content: ProseMirrorNode | null | undefined
): Record<string, string> {
  if (!content) return {}
  const attributes: Record<string, string> = {
    [ROOT_BLOCK_CONTENT_ATTRS.contentType]: content.type.name,
  }
  if (content.type.name === 'headingBlock') {
    const level: unknown = content.attrs.level
    if (typeof level === 'number') attributes[ROOT_BLOCK_CONTENT_ATTRS.headingLevel] = String(level)
  }
  if (content.type.name === 'listItemBlock') {
    const listType: unknown = content.attrs.listType
    if (typeof listType === 'string') attributes[ROOT_BLOCK_CONTENT_ATTRS.listType] = listType
  }
  return attributes
}

