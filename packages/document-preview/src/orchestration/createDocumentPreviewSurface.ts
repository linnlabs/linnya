import type { DocumentPreviewDetail } from '@app/schemas';
import type {
  DocumentPreviewSurface,
  DocumentPreviewSurfaceInput,
} from '../definitions/documentPreviewSurface';
import { DOCUMENT_PREVIEW_LAYOUT as layout } from '../definitions/documentPreviewSurface';
import {
  createDocumentPreviewIcon,
  documentPreviewText,
} from '../functions/documentPreviewPresentation';

const releases = new WeakMap<HTMLElement, () => void>();
/** 光栅消费方在 paint 完成/失败后和 live 预览在卸载时走同一释放口。 */
export function disposeDocumentPreviewSurface(element: HTMLElement): void {
  releases.get(element)?.();
}

async function renderBody(detail: DocumentPreviewDetail, input: DocumentPreviewSurfaceInput) {
  const widthPx = Math.max(1, input.widthPx - layout.paddingInline * 2);
  // 首屏正文一直排到表面底边，由淡出收尾；底部留白只属于读到文末的详情，否则正文会在留白上方被切开。
  const maxHeight =
    input.maxHeight === undefined
      ? undefined
      : Math.max(
          1,
          input.maxHeight -
            layout.paddingTop -
            layout.titleHeight -
            layout.titleGap -
            (input.visibleInsetPx ?? 0)
        );
  if (detail.format === 'workspace-markdown') {
    const { createWorkspaceMarkdownPreview } = await import(
      '@linnya/markdown-document-core/workspace-preview'
    );
    input.signal.throwIfAborted();
    return createWorkspaceMarkdownPreview({
      content: detail,
      document: input.document,
      widthPx,
      maxHeight,
      theme: input.theme,
      signal: input.signal,
      ...(input.locale ? { locale: input.locale } : {}),
      referenceIcon: nodeType =>
        createDocumentPreviewIcon(
          input.document,
          (nodeType ? input.referenceTypeIcon?.(nodeType) : null) ?? undefined
        ),
    });
  }
  const element = input.document.createElement('div');
  element.className = 'markdown-document-content document-preview-portable';
  if (detail.format === 'markdown') {
    const markdown = await import('@linnya/markdown-document-core');
    input.signal.throwIfAborted();
    element.append(
      markdown.createMarkdownDocumentFragment(
        markdown.parseMarkdownDocument(detail.text),
        input.document
      )
    );
  } else {
    element.classList.add('document-preview-plain');
    element.textContent = detail.text;
  }
  return { element, dispose: () => element.remove() };
}

/** 行内引用、对话引用、画布位图和 live 详情的唯一用户预览呈现，不处理持久化或导航授权。 */
export async function createDocumentPreviewSurface(
  input: DocumentPreviewSurfaceInput
): Promise<DocumentPreviewSurface> {
  input.signal.throwIfAborted();
  const { document, preview } = input;
  const text = documentPreviewText(input.locale);
  const element = document.createElement('section');
  element.className = 'document-preview-surface';
  element.setAttribute('data-linnya-ui-theme', input.theme);
  element.dataset.documentId = preview.documentId;
  element.style.width = `${input.widthPx}px`;
  for (const [key, value] of Object.entries(layout))
    element.style.setProperty(`--preview-${key}`, `${value}px`);
  if (input.visibleInsetPx)
    element.style.setProperty('--document-preview-fade-inset', `${input.visibleInsetPx}px`);
  if (input.maxHeight !== undefined) {
    element.style[input.fitContentHeight ? 'maxHeight' : 'height'] = `${input.maxHeight}px`;
    element.classList.add('document-preview-first-screen');
  }
  const title = document.createElement(input.onOpen ? 'button' : 'div');
  title.className = 'document-preview-title';
  title.title = preview.title ?? text.status[preview.status];
  if (input.onOpen) {
    title.setAttribute('type', 'button');
    title.addEventListener('click', () => input.onOpen?.());
    title.setAttribute('aria-label', text.openLabel(preview.title ?? ''));
  }
  const icon = document.createElement('span');
  icon.className = 'document-preview-type-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.append(createDocumentPreviewIcon(document, input.icon ?? undefined));
  const name = document.createElement('span');
  name.className = 'document-preview-name';
  name.textContent = preview.title ?? text.unavailableTitle;
  title.append(icon, name);
  const body = document.createElement('div');
  body.className = 'document-preview-body';
  element.append(title, body);
  let releaseBody: (() => void) | undefined;
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    releaseBody?.();
    element.remove();
    releases.delete(element);
  };
  try {
    if (
      !input.externalBody &&
      preview.status === 'ready' &&
      preview.content?.detail &&
      preview.content.overview !== 'thumbnail'
    ) {
      const rendered = await renderBody(preview.content.detail, input);
      releaseBody = rendered.dispose;
      body.append(rendered.element);
      element.classList.toggle(
        'document-preview-clipped',
        rendered.element.getAttribute('data-preview-clipped') === 'true'
      );
    } else if (preview.status === 'ready' && preview.content?.image) {
      // externalBody 时封面也先放着：类型自己的详情组件挂进来之前（首次还要加载代码）正文容器不留空，
      // 详情的根元素一出现，样式就让封面让位（style.css）。
      const image = document.createElement('img');
      image.className = 'document-preview-cover';
      // 先给出像素尺寸，图片解码前就按真实比例占位；否则封面解码完成时表面高度会再变一次。
      image.width = preview.content.image.widthPx;
      image.height = preview.content.image.heightPx;
      image.src = preview.content.image.dataUri;
      image.alt = preview.title ?? '';
      body.append(image);
    } else if (!input.externalBody) {
      const text = document.createElement('p');
      text.className = 'document-preview-summary';
      text.textContent =
        preview.status === 'ready' || preview.status === 'plugin_unavailable'
          ? (preview.content?.summary ?? '')
          : '';
      body.append(text);
    }
    if (preview.status !== 'ready') {
      const status = document.createElement('p');
      status.className = 'document-preview-status';
      status.setAttribute('role', 'status');
      status.textContent = text.status[preview.status];
      if (preview.status === 'plugin_unavailable' && preview.content?.summary) body.append(status);
      else body.replaceChildren(status);
    }
    input.signal.throwIfAborted();
    releases.set(element, dispose);
    return { element, body, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
