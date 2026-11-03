/** 只消费调用方已授权的当前标题；不从静态DOM递归读取Workspace或其他文档正文。 */
export function hydrateCanvasDocumentTags(element: HTMLElement, presentations: Readonly<Record<string, { readonly title: string }>>): void {
  for (const tag of element.querySelectorAll<HTMLElement>('[data-document-id][data-reference-id]')) {
    const documentId = tag.getAttribute('data-document-id');
    const presentation = documentId ? presentations[documentId] : undefined;
    tag.textContent = presentation?.title ?? '文档当前不可访问';
    tag.classList.add('markdown-document-reference');
  }
}
