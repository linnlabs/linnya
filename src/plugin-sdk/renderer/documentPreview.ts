import { DocumentPreviewTypesSchema, DocumentPreviewRequestSchema, DocumentPreviewResultSchema, type DocumentPreviewRequest, type DocumentPreviewResult } from '@app/schemas';

/** 只开放只读预览，不将 Electron API 或数据库传给插件。 */
export async function readDocumentPreview(input: DocumentPreviewRequest): Promise<DocumentPreviewResult> {
  const api: unknown = Reflect.get(window, 'electronAPI');
  if (typeof api !== 'object' || api === null) throw new Error('Document preview API unavailable');
  const read: unknown = Reflect.get(api, 'document-preview:read');
  if (typeof read !== 'function') throw new Error('Document preview API unavailable');
  const result: unknown = await Reflect.apply(read, api, [DocumentPreviewRequestSchema.parse(input)]);
  return DocumentPreviewResultSchema.parse(result);
}

export async function listDocumentPreviewTypes() {
  const api: unknown = Reflect.get(window, 'electronAPI');
  if (typeof api !== 'object' || api === null) throw new Error('Document preview API unavailable');
  const list: unknown = Reflect.get(api, 'document-preview:types');
  if (typeof list !== 'function') throw new Error('Document preview API unavailable');
  return DocumentPreviewTypesSchema.parse(await Reflect.apply(list, api, []));
}
