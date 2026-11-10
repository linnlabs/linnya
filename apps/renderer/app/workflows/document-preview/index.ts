import './styles/documentPreview.css';
export { createDocumentPreviewRendererPort } from './orchestration/createDocumentPreviewRendererPort';
export type { DocumentPreviewTarget } from './definitions/documentPreview';
export async function loadReadonlyDocumentPreview() {
  return (await import('./ui/ReadonlyDocumentPreview.vue')).default;
}
