import { describe, expect, it } from 'vitest'
import type { EditorMessageResolver } from '../../../definitions/editorMessages'
import {
  formatCitationAuthors,
  formatCitationKbInsertLabel,
  formatCitationPageLabel,
  formatCitationSameSourceNotice,
  resolveCitationSourceTypeLabel,
  resolveCitationValidationError,
  resolveCitationValidationErrorMap,
} from './citationPresentation'

const testMessage: EditorMessageResolver = (key, params) => {
  const messages: Partial<Record<Parameters<EditorMessageResolver>[0], string>> = {
    'editor.citation.source.knowledgeBase': 'Knowledge base',
    'editor.citation.source.web': 'Web',
    'editor.citation.source.manual': 'Manual',
    'editor.citation.kb.insert': 'Insert citation',
    'editor.citation.kb.insertWithCount': 'Insert citation ({count})',
    'editor.citation.kb.page': 'Page {page}',
    'editor.citation.form.error.titleRequired': 'Title is required',
    'editor.citation.form.error.urlInvalid': 'URL format is invalid',
    'editor.citation.edit.sameSourceNotice': 'This source is cited {count} times.',
    'editor.citation.author.othersSuffix': 'et al.',
  }

  const raw = messages[key] ?? key
  if (!params) return raw

  return Object.entries(params).reduce((text, [paramKey, value]) => {
    return text.replace(`{${paramKey}}`, String(value))
  }, raw)
}

describe('citationPresentation', () => {
  it('解析 Citation 来源类型展示名', () => {
    expect(resolveCitationSourceTypeLabel('knowledge_base', testMessage)).toBe('Knowledge base')
    expect(resolveCitationSourceTypeLabel('web', testMessage)).toBe('Web')
    expect(resolveCitationSourceTypeLabel('manual', testMessage)).toBe('Manual')
  })

  it('格式化作者、页码和插入按钮文案', () => {
    expect(formatCitationAuthors(['Alice'], testMessage)).toBe('Alice')
    expect(formatCitationAuthors(['Alice', 'Bob'], testMessage)).toBe('Alice & Bob')
    expect(formatCitationAuthors(['Alice', 'Bob', 'Carol'], testMessage)).toBe('Alice et al.')
    expect(formatCitationPageLabel(3, testMessage)).toBe('Page 3')
    expect(formatCitationKbInsertLabel(0, testMessage)).toBe('Insert citation')
    expect(formatCitationKbInsertLabel(2, testMessage)).toBe('Insert citation (2)')
  })

  it('把稳定错误码解析为当前语言表单错误', () => {
    expect(resolveCitationValidationError('titleRequired', testMessage)).toBe('Title is required')
    expect(resolveCitationValidationErrorMap({ title: 'titleRequired', url: 'urlInvalid' }, testMessage)).toEqual({
      title: 'Title is required',
      url: 'URL format is invalid',
    })
  })

  it('格式化同源引用提示', () => {
    expect(formatCitationSameSourceNotice(4, testMessage)).toBe('This source is cited 4 times.')
  })
})
