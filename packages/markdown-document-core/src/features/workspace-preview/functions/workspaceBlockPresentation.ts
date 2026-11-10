import { applyRootBlockColorStyle, resolveRootBlockContentAttributes } from './workspaceRootPresentation';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

export interface WorkspaceBlockDom {
  readonly dom: HTMLElement;
  readonly contentDOM?: HTMLElement;
}
export interface WorkspaceBlockPresentationOptions {
  readonly imageSource?: string;
  readonly emptyImageLabel?: string;
}

function attribute(node: ProseMirrorNode, name: string): string {
  const value: unknown = node.attrs[name];
  return typeof value === 'string' ? value : '';
}
function number(node: ProseMirrorNode, name: string, fallback = 0): number {
  const value: unknown = node.attrs[name];
  return typeof value === 'number' ? value : fallback;
}
/** 文本块的结构由正式 Editor 与只读呈现共同使用；交互和命令不进入这里。 */
export function renderWorkspaceTextBlock(node: ProseMirrorNode, document: Document, htmlAttributes: Record<string, unknown> = {}): WorkspaceBlockDom {
  const kind = node.type.name;
  const names: Record<string, string> = {
    baseBlock: 'base-block', headingBlock: 'heading-block', listItemBlock: 'list-item-block', quoteBlock: 'quote-block',
  };
  const name = names[kind];
  if (!name) throw new Error(`Unsupported text block: ${kind}`);
  const heading = kind === 'headingBlock', list = kind === 'listItemBlock';
  const level = number(node, 'level', heading ? 1 : 0);
  const indent = list ? level : number(node, 'indent');
  const outer = document.createElement('div');
  outer.className = `${name}-outer${heading ? ` heading-level-${level}` : ''}`;
  outer.setAttribute('data-node-type', `${kind}Outer`);
  const inner = document.createElement(heading ? `h${level}` : 'div');
  for (const [key, value] of Object.entries(htmlAttributes)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') inner.setAttribute(key, String(value));
  }
  inner.className = [...new Set(`${inner.className} ${name} editor-block${heading ? ` heading-level-${level}` : list ? ` level-${level}` : ''}`.trim().split(/\s+/))].join(' ');
  inner.setAttribute('data-node-type', kind);
  inner.setAttribute('data-type', name);
  inner.setAttribute('data-block-id', attribute(node, 'id'));
  inner.setAttribute('data-block-type', attribute(node, 'blockType'));
  inner.setAttribute('data-is-empty', String(node.content.size === 0));
  if (indent > 0 || list) {
    outer.setAttribute('data-indent', String(indent));
    inner.setAttribute('data-indent', String(indent));
  }
  const alignment = attribute(node, 'textAlign');
  if (alignment && alignment !== 'left') inner.style.textAlign = alignment;
  const color = attribute(node, 'textColor');
  if (color) {
    outer.setAttribute('data-text-color', color);
    outer.style.setProperty('--local-block-text-color', `var(--block-text-${color.replace('_text', '')})`);
  }
  if (heading) {
    outer.setAttribute('data-block-id', attribute(node, 'id'));
    inner.setAttribute('data-heading-level', String(level));
    if (node.attrs.collapsible) inner.setAttribute('data-collapsible', 'true');
    if (node.attrs.collapsed) inner.setAttribute('data-collapsed', 'true');
  }
  if (list) {
    for (const element of [outer, inner]) element.setAttribute('data-list-type', attribute(node, 'listType'));
    inner.setAttribute('data-list-level', String(level));
    if (attribute(node, 'marker')) inner.setAttribute('data-list-marker', attribute(node, 'marker'));
    if (attribute(node, 'separatorBefore')) inner.setAttribute('data-list-separator', attribute(node, 'separatorBefore'));
    if (node.attrs.start !== null && node.attrs.start !== undefined) inner.setAttribute('data-list-start', String(node.attrs.start));
  }
  outer.append(inner);
  return { dom: outer, contentDOM: inner };
}

/** 图片源由调用方决定：正式 Editor 用持久src，预览只传 Host 已准入字节。 */
export function renderWorkspaceImageBlock(
  node: ProseMirrorNode, document: Document, options: WorkspaceBlockPresentationOptions = {},
): WorkspaceBlockDom {
  const outer = document.createElement('div');
  outer.className = 'image-block-outer';
  outer.setAttribute('data-node-type', 'imageBlockOuter');
  const figure = document.createElement('figure');
  figure.className = 'image-block editor-block';
  figure.setAttribute('data-node-type', 'imageBlock');
  figure.setAttribute('data-type', 'image-block');
  figure.setAttribute('data-block-id', attribute(node, 'id'));
  figure.setAttribute('data-block-type', attribute(node, 'blockType'));
  figure.setAttribute('data-caption', attribute(node, 'caption'));
  if (node.attrs.uploadedAt != null) figure.setAttribute('data-uploaded-at', String(node.attrs.uploadedAt));
  const width = number(node, 'width'), height = number(node, 'height');
  if (width > 0) figure.style.width = `${width}px`;
  const assetId = attribute(node, 'assetId');
  if (assetId) figure.setAttribute('data-asset-id', assetId);
  const alignment = attribute(node, 'alignment');
  if (alignment) {
    figure.setAttribute('data-alignment', alignment);
    figure.classList.add(`align-${alignment}`);
  }
  const source = options.imageSource ?? attribute(node, 'src');
  if (source) {
    const image = document.createElement('img');
    image.src = source;
    image.alt = attribute(node, 'alt');
    if (attribute(node, 'title')) image.title = attribute(node, 'title');
    if (width > 0) image.width = width;
    if (height > 0) image.height = height;
    image.style.maxWidth = '100%';
    image.className = 'image-block-img';
    figure.append(image);
  } else {
    figure.classList.add('empty-image');
    figure.textContent = options.emptyImageLabel ?? '未添加图片';
  }
  const caption = attribute(node, 'caption');
  if (caption) {
    const element = document.createElement('figcaption');
    element.className = 'figure-caption';
    element.textContent = caption;
    figure.append(element);
  }
  outer.append(figure);
  return { dom: outer };
}

export function renderWorkspaceRootBlock(node: ProseMirrorNode, document: Document): WorkspaceBlockDom {
  const outer = document.createElement('div');
  outer.className = 'root-block-outer';
  outer.setAttribute('data-node-type', 'rootBlockOuter');
  outer.setAttribute('data-id', attribute(node, 'id'));
  for (const [name, value] of Object.entries(resolveRootBlockContentAttributes(node.firstChild))) outer.setAttribute(name, value);
  const inner = document.createElement('div');
  inner.className = 'root-block';
  inner.setAttribute('data-node-type', 'rootBlock');
  applyRootBlockColorStyle(inner, node.attrs);
  outer.append(inner);
  return { dom: outer, contentDOM: inner };
}

export { workspaceListNumbers } from './workspaceListNumbers';

export * from './workspaceRootPresentation';
export { renderWorkspaceLatex } from './workspaceLatexPresentation';
