import type { EditorMessageKey, EditorMessageResolver } from '../../../definitions/editorMessages'
import type { CitationSourceType } from '../types'

export type CitationWebManualValidationErrorCode =
  | 'titleRequired'
  | 'urlRequired'
  | 'urlInvalid'

const sourceTypeMessageKey: Readonly<Record<CitationSourceType, EditorMessageKey>> = {
  knowledge_base: 'editor.citation.source.knowledgeBase',
  web: 'editor.citation.source.web',
  manual: 'editor.citation.source.manual',
}

const validationErrorMessageKey: Readonly<Record<CitationWebManualValidationErrorCode, EditorMessageKey>> = {
  titleRequired: 'editor.citation.form.error.titleRequired',
  urlRequired: 'editor.citation.form.error.urlRequired',
  urlInvalid: 'editor.citation.form.error.urlInvalid',
}

export function resolveCitationSourceTypeLabel(
  sourceType: CitationSourceType,
  editorMessage: EditorMessageResolver,
): string {
  return editorMessage(sourceTypeMessageKey[sourceType] ?? 'editor.citation.source.fallback')
}

export function formatCitationAuthors(
  authors: ReadonlyArray<string>,
  editorMessage: EditorMessageResolver,
): string {
  if (authors.length === 0) return ''
  if (authors.length === 1) return authors[0]
  if (authors.length === 2) return `${authors[0]} & ${authors[1]}`

  return `${authors[0]} ${editorMessage('editor.citation.author.othersSuffix')}`
}

export function formatCitationDate(date: string): string {
  const yearMatch = date.match(/\d{4}/)
  return yearMatch ? yearMatch[0] : date
}

export function formatCitationKbInsertLabel(
  selectedCount: number,
  editorMessage: EditorMessageResolver,
): string {
  if (selectedCount > 0) {
    return editorMessage('editor.citation.kb.insertWithCount', { count: selectedCount })
  }

  return editorMessage('editor.citation.kb.insert')
}

export function formatCitationPageLabel(
  page: number | string,
  editorMessage: EditorMessageResolver,
): string {
  return editorMessage('editor.citation.kb.page', { page })
}

export function resolveCitationValidationError(
  errorCode: CitationWebManualValidationErrorCode,
  editorMessage: EditorMessageResolver,
): string {
  return editorMessage(validationErrorMessageKey[errorCode])
}

export function resolveCitationValidationErrorMap<TField extends string>(
  errors: Partial<Record<TField, CitationWebManualValidationErrorCode>>,
  editorMessage: EditorMessageResolver,
): Partial<Record<TField, string>> {
  const resolvedErrors: Partial<Record<TField, string>> = {}

  for (const [field, errorCode] of Object.entries(errors) as Array<[TField, CitationWebManualValidationErrorCode]>) {
    resolvedErrors[field] = resolveCitationValidationError(errorCode, editorMessage)
  }

  return resolvedErrors
}

export function formatCitationSameSourceNotice(
  count: number,
  editorMessage: EditorMessageResolver,
): string {
  return editorMessage('editor.citation.edit.sameSourceNotice', { count })
}
