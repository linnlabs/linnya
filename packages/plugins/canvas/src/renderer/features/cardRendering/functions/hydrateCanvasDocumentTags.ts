import { createVNode, render } from 'vue';
import { DocumentIcon } from '@linnya/renderer-ui/icons';
import type { DocumentReferencePresentation } from '@app/schemas';

let iconTemplate: Node | null = null;
function readIcon(document: Document): Node {
  if (!iconTemplate) {
    const host = document.createElement('span'); render(createVNode(DocumentIcon), host);
    const icon = host.querySelector('svg');
    if (!icon) throw new Error('document_reference_icon_missing');
    iconTemplate = icon.cloneNode(true); render(null, host);
  }
  return iconTemplate.cloneNode(true);
}
/** 只消费调用方已授权的当前标题；图标复用公开组件，不复制path或递归查询其他文档。 */
export function hydrateCanvasDocumentTags(element: HTMLElement, presentations: Readonly<Record<string, { readonly title: string; readonly status?: DocumentReferencePresentation['status'] }>>): void {
  for (const tag of element.querySelectorAll<HTMLElement>('[data-document-id][data-reference-id]')) {
    const documentId = tag.getAttribute('data-document-id');
    const presentation = documentId ? presentations[documentId] : undefined;
    const label = tag.querySelector<HTMLElement>('[data-document-reference-label]'), icon = tag.querySelector<HTMLElement>('[data-document-reference-icon]');
    if (!label || !icon) throw new Error('document_reference_dom_contract_missing');
    label.textContent = presentation?.title ?? '文档当前不可访问';
    if (!icon.firstChild) icon.append(readIcon(element.ownerDocument));
    if (presentation) tag.dataset.status = presentation.status ?? 'available'; else delete tag.dataset.status;
    tag.setAttribute('aria-label', label.textContent);
    tag.classList.add('markdown-document-reference');
  }
}
