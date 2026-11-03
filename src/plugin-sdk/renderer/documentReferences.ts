import { DocumentReferenceCandidatesSchema, DocumentReferenceDeletionRequestSchema, DocumentReferenceDeletionPreviewSchema, type DocumentReferenceDeletionPreview, DocumentReferencePresentationRequestSchema, DocumentReferencePresentationSchema, DocumentReferenceSearchRequestSchema, type DocumentReferenceCandidate, type DocumentReferencePresentation } from '@app/schemas';

async function invoke(channel: string, request: unknown): Promise<unknown> {
  const api: unknown = Reflect.get(window, 'electronAPI');
  if (typeof api !== 'object' || api === null) throw new Error('Document reference API unavailable');
  const handler: unknown = Reflect.get(api, channel);
  if (typeof handler !== 'function') throw new Error('Document reference API unavailable');
  return Reflect.apply(handler, api, [request]);
}
export async function queryDocumentReferences(input: { readonly projectId: string; readonly keyword: string; readonly limit?: number }): Promise<readonly DocumentReferenceCandidate[]> {
  return DocumentReferenceCandidatesSchema.parse(await invoke('document-references:search', DocumentReferenceSearchRequestSchema.parse(input)));
}
export async function readDocumentReference(input: { readonly projectId: string; readonly documentId: string }): Promise<DocumentReferencePresentation> {
  return DocumentReferencePresentationSchema.parse(await invoke('document-references:resolve', DocumentReferencePresentationRequestSchema.parse(input)));
}

export async function previewDocumentDeletionReferences(input: { readonly nodeIds: readonly string[] }): Promise<DocumentReferenceDeletionPreview> {
  return DocumentReferenceDeletionPreviewSchema.parse(await invoke('document-references:deletion-preview', DocumentReferenceDeletionRequestSchema.parse(input)));
}
