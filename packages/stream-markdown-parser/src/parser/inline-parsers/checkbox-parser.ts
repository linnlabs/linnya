import type { CheckboxInputNode, CheckboxNode, MarkdownToken } from '../../types'

export function parseCheckboxToken(token: MarkdownToken): CheckboxNode {
  const tokenMeta = (token.meta ?? {}) as unknown as { checked?: boolean }
  return {
    type: 'checkbox',
    checked: tokenMeta.checked === true,
    raw: tokenMeta.checked ? '[x]' : '[ ]',
  }
}

export function parseCheckboxInputToken(token: any): CheckboxInputNode {
  const tokenAny = token as unknown as { attrGet?: (name: string) => string | undefined }
  const rawAttr = tokenAny.attrGet ? tokenAny.attrGet('checked') : undefined
  const checked = rawAttr === '' || rawAttr === 'true'
  return {
    type: 'checkbox_input',
    checked,
    raw: checked ? '[x]' : '[ ]',
  }
}
