import { createVNode, render, type Component } from 'vue';
import { DocumentIcon } from '@linnya/renderer-ui/icons';
import type { DocumentReferencePresentation } from '@app/schemas';

const iconTemplates = new Map<Component, Node>();
function readIcon(document: Document, component: Component): Node {
  let template = iconTemplates.get(component);
  if (!template) {
    const host = document.createElement('span');
    render(createVNode(component), host);
    const icon = host.querySelector('svg');
    if (!icon) throw new Error('document_reference_icon_missing');
    template = icon.cloneNode(true);
    render(null, host);
    iconTemplates.set(component, template);
  }
  return template.cloneNode(true);
}
/**
 * 只消费调用方已授权的当前标题；图标复用公开组件，不复制path或递归查询其他文档。
 * 主界面传 typeIcon 时用与文件树同一的类型图标；渲染 worker 不传，用通用文件图标。
 */
export function hydrateCanvasDocumentTags(
  element: HTMLElement,
  presentations: Readonly<
    Record<
      string,
      {
        readonly title: string;
        readonly status?: DocumentReferencePresentation['status'];
        readonly nodeType?: string | null;
      }
    >
  >,
  /** 渲染 worker 不知道界面语言，沿用默认；主界面传入当前语言文案。 */
  unavailableLabel = '文档当前不可访问',
  typeIcon?: (nodeType: string) => Component | null
): void {
  for (const tag of element.querySelectorAll<HTMLElement>(
    '[data-document-id][data-reference-id]'
  )) {
    const documentId = tag.getAttribute('data-document-id');
    const presentation = documentId ? presentations[documentId] : undefined;
    const label = tag.querySelector<HTMLElement>('[data-document-reference-label]'),
      icon = tag.querySelector<HTMLElement>('[data-document-reference-icon]');
    if (!label || !icon) throw new Error('document_reference_dom_contract_missing');
    label.textContent = presentation?.title ?? unavailableLabel;
    const nodeType = presentation?.nodeType;
    const component = (nodeType ? typeIcon?.(nodeType) : null) ?? DocumentIcon;
    icon.replaceChildren(readIcon(element.ownerDocument, component));
    if (presentation) tag.dataset.status = presentation.status ?? 'available';
    else delete tag.dataset.status;
    tag.setAttribute('aria-label', label.textContent);
    tag.classList.add('markdown-document-reference');
  }
}
