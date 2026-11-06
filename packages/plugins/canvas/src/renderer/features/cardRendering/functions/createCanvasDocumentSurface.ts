import type { CanvasDocumentSurfacePresentation } from '../definitions/canvasDocumentSurface';

const messages = {
  deleted: '文档已删除',
  outside_project: '目标在其他项目，当前不可访问',
  plugin_unavailable: '需要启用或安装文档插件',
  preview_unavailable: '暂时没有可用预览',
  ready: '',
};

export function canvasDocumentPreviewMessage(
  status: NonNullable<CanvasDocumentSurfacePresentation['status']>
): string {
  return messages[status];
}

/** 文档身份与内容已由调用方授权；此处不查Host、不递归预览，也不把内部ID放进正文。 */
export function createCanvasDocumentSurface(
  presentation: CanvasDocumentSurfacePresentation | undefined,
  document: Document
): HTMLElement {
  const element = document.createElement('div');
  element.className = 'markdown-document-content canvas-card-content canvas-document-content';
  const title = document.createElement('strong');
  title.className = 'canvas-card-title';
  title.textContent = presentation?.title ?? '文档当前不可访问';
  element.append(title);
  const available =
    presentation !== undefined &&
    (presentation.status === undefined || presentation.status === 'ready');
  if (available && presentation.image) {
    const image = document.createElement('img');
    image.src = presentation.image;
    image.alt = presentation.title ?? '';
    element.append(image);
  } else if ((available || presentation?.status === 'plugin_unavailable') && presentation.summary) {
    const summary = document.createElement('p');
    summary.className = 'canvas-document-summary';
    summary.textContent = presentation.summary;
    element.append(summary);
  }
  const message = presentation?.status && canvasDocumentPreviewMessage(presentation.status);
  if (message) {
    const status = document.createElement('small');
    status.className = 'canvas-card-auxiliary';
    status.textContent = message;
    element.append(status);
  }
  return element;
}
