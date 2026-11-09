import { createVNode, render, type Component } from 'vue';
import {
  createMarkdownDocumentFragment,
  parseMarkdownDocument,
} from '@linnya/markdown-document-core';
import { DocumentIcon } from '@linnya/renderer-ui/icons';
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

const iconTemplates = new WeakMap<Component, Node>();
/** 图标复用公开组件，只渲染一次后克隆；出图与选中详情用同一个 SVG。 */
function readIcon(component: Component, document: Document): Node {
  let template = iconTemplates.get(component);
  if (!template) {
    const host = document.createElement('span');
    render(createVNode(component), host);
    const icon = host.querySelector('svg');
    if (!icon) throw new Error('document_type_icon_missing');
    template = icon.cloneNode(true);
    render(null, host);
    iconTemplates.set(component, template);
  }
  return template.cloneNode(true);
}

/** 卡片顶部的小标签：类型图标加文件名。未选中出图与选中详情共用，两种状态看起来一致。 */
export function createCanvasDocumentLabel(
  title: string,
  icon: Component | undefined,
  document: Document
): HTMLElement {
  const label = document.createElement('div');
  label.className = 'canvas-document-label';
  const mark = document.createElement('span');
  mark.className = 'canvas-document-label-icon';
  mark.setAttribute('aria-hidden', 'true');
  mark.append(readIcon(icon ?? DocumentIcon, document));
  const name = document.createElement('span');
  name.className = 'canvas-document-label-text';
  name.textContent = title;
  label.append(mark, name);
  return label;
}

/** 正文按文档自己的排版渲染；卡片出图拿不到托管图片，正文里的图片不进卡片。 */
function createBody(
  body: NonNullable<CanvasDocumentSurfacePresentation['body']>,
  document: Document
): HTMLElement {
  const element = document.createElement('div');
  element.className = 'canvas-document-markdown';
  if (body.format === 'text') {
    const text = document.createElement('p');
    text.className = 'canvas-document-text';
    text.textContent = body.text;
    element.append(text);
    return element;
  }
  element.append(createMarkdownDocumentFragment(parseMarkdownDocument(body.text), document));
  for (const image of element.querySelectorAll('img')) image.remove();
  return element;
}

/** 正文、封面或摘要三选一：有正文且内容方未声明缩略图时排正文，否则用封面，再退到摘要。 */
function appendDocumentPreview(
  element: HTMLElement,
  presentation: CanvasDocumentSurfacePresentation | undefined,
  available: boolean,
  document: Document
): void {
  if (!presentation) return;
  const body = available && !presentation.thumbnail ? presentation.body : undefined;
  if (body) {
    element.append(createBody(body, document));
    // 正文常比卡片长，底部统一淡出；内容短时淡出落在空白上看不见。
    element.classList.add('canvas-card-content-clipped');
  } else if (available && presentation.image) {
    const image = document.createElement('img');
    image.className = 'canvas-document-cover';
    image.src = presentation.image;
    image.alt = presentation.title ?? '';
    element.append(image);
  } else if ((available || presentation.status === 'plugin_unavailable') && presentation.summary) {
    const summary = document.createElement('p');
    summary.className = 'canvas-document-summary';
    summary.textContent = presentation.summary;
    element.append(summary);
  }
}

/** 文档身份与内容已由调用方授权；此处不查Host、不递归预览，也不把内部ID放进正文。 */
export function createCanvasDocumentSurface(
  presentation: CanvasDocumentSurfacePresentation | undefined,
  document: Document,
  height?: number
): HTMLElement {
  const element = document.createElement('div');
  element.className = 'markdown-document-content canvas-card-content canvas-document-content';
  // 固定为卡片高度：正文超出时裁在卡内，底部淡出才落在卡片下沿。
  if (height !== undefined) element.style.height = `${height}px`;
  element.append(
    createCanvasDocumentLabel(
      presentation?.title ?? '文档当前不可访问',
      presentation?.icon,
      document
    )
  );
  const available =
    presentation !== undefined &&
    (presentation.status === undefined || presentation.status === 'ready');
  appendDocumentPreview(element, presentation, available, document);
  const message = presentation?.status && canvasDocumentPreviewMessage(presentation.status);
  if (message) {
    const status = document.createElement('small');
    status.className = 'canvas-card-auxiliary';
    status.textContent = message;
    element.append(status);
  }
  return element;
}
