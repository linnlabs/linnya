import { DOMSerializer, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { WorkspaceMarkdownPreview } from '@app/schemas';
import { renderWorkspaceLatex } from './workspaceLatexPresentation';
import { deriveCitations, getBibliographyStyleId, formatBibliographyAuthors, formatCitationDate, type CitationDerivationResult } from '../../workspace-citations';
import { renderWorkspaceImageBlock, renderWorkspaceRootBlock, renderWorkspaceTextBlock } from './workspaceBlockPresentation';
import { isCompactTableCellNode, WORKSPACE_TABLE_CLASS, WORKSPACE_TABLE_COMPACT_CELL_CLASS, workspaceTableStyleAttributes } from '../../workspace-table';
import { documentReferenceLabel } from '../../../references';

function string(node: ProseMirrorNode, key: string): string {
  const value: unknown = node.attrs[key];
  return typeof value === 'string' ? value : '';
}
function math(node: ProseMirrorNode, document: Document): HTMLElement {
  const displayMode = node.type.name === 'latexBlock';
  const element = document.createElement(displayMode ? 'div' : 'span');
  element.className = displayMode ? 'workspace-preview-math' : 'workspace-preview-inline-math';
  element.innerHTML = renderWorkspaceLatex(string(node, 'latexSource'), displayMode);
  return element;
}
function documentReference(node: ProseMirrorNode, content: WorkspaceMarkdownPreview, document: Document, locale: string, referenceIcon?: (nodeType: string | null) => Node): HTMLElement {
  const element = document.createElement('span');
  const id = string(node, 'documentId'), presentation = content.references[id];
  element.className = 'markdown-document-reference';
  element.setAttribute('data-document-id', id);
  element.setAttribute('data-reference-id', string(node, 'referenceId'));
  element.setAttribute('data-reference-status', presentation?.status ?? 'deleted');
  // 图标位与编辑器、画布同一 DOM 合同；portable core 不带图标资源，由呈现宿主提供，须在量高前就位。
  const icon = document.createElement('span');
  icon.className = 'markdown-document-reference-icon';
  icon.setAttribute('data-document-reference-icon', '');
  icon.setAttribute('aria-hidden', 'true');
  const available = presentation?.status === 'available' || presentation?.status === 'plugin_unavailable';
  if (referenceIcon) icon.append(referenceIcon(available ? presentation.nodeType : null));
  element.append(icon);
  const label = document.createElement('span');
  label.className = 'markdown-document-reference-label';
  label.setAttribute('data-document-reference-label', '');
  // 预览内容里查不到这条引用的展示信息，说明目标已经不在：与已删除同样显示。
  label.textContent = documentReferenceLabel(presentation ?? { status: 'deleted', title: null }, locale);
  element.append(label);
  return element;
}
function bibliography(citations: CitationDerivationResult, style: string, document: Document, locale: string): HTMLElement {
  const section = document.createElement('section');
  section.className = 'workspace-preview-bibliography';
  const title = document.createElement('h3');
  title.textContent = locale.startsWith('zh') ? '参考文献' : 'References';
  section.append(title);
  const list = document.createElement('ul');
  for (const entry of citations.entries) {
    const item = document.createElement('li');
    const prefix = style === 'numeric' ? `[${entry.numericIndex}] ` : '';
    item.textContent = prefix + [formatBibliographyAuthors(entry.authors, locale.startsWith('zh') ? '等' : 'et al.'), entry.title, entry.containerTitle, formatCitationDate(entry.date)].filter(Boolean).join('. ');
    if (entry.url) {
      const link = document.createElement('a');
      link.textContent = entry.url;
      link.setAttribute('href', entry.url);
      item.append(document.createTextNode('. '), link);
    }
    list.append(item);
  }
  section.append(list);
  return section;
}
function tableCell(node: ProseMirrorNode, document: Document) {
  const cell = document.createElement(node.type.name === 'tableHeader' ? 'th' : 'td');
  // 与编辑器同一短格判定，两边分列一致。
  if (isCompactTableCellNode(node)) cell.classList.add(WORKSPACE_TABLE_COMPACT_CELL_CLASS);
  for (const key of ['colspan', 'rowspan']) {
    const value: unknown = node.attrs[key];
    if (typeof value === 'number') cell.setAttribute(key, String(value));
  }
  // 正式编辑器将对齐写入 style；只读表格不能丢掉用户实际保存的排版。
  const authoredStyle = document.createElement('span').style;
  authoredStyle.cssText = string(node, 'style');
  // 单元格只投影排版/颜色属性，不接纳粘贴 HTML 中可自行加载网络资源的 CSS。
  for (const property of ['text-align', 'vertical-align', 'color', 'background-color']) {
    const value = authoredStyle.getPropertyValue(property);
    if (value) cell.style.setProperty(property, value);
  }
  const align = string(node, 'align');
  if (align) cell.style.textAlign = align;
  const widths: unknown = node.attrs.colwidth;
  if (Array.isArray(widths) && widths.every((width: unknown): width is number => typeof width === 'number')) {
    cell.setAttribute('data-colwidth', widths.join(','));
    const width = widths.reduce((total: number, value: number) => total + value, 0);
    if (width > 0) cell.style.width = `${width}px`;
  }
  return { dom: cell, contentDOM: cell };
}

/** 使用正式 schema 的节点/mark，不反解析 Agent Markdown；动态重内容另由准备阶段完成。 */
export function createWorkspacePreviewSerializer(input: {
  readonly content: WorkspaceMarkdownPreview;
  readonly node: ProseMirrorNode;
  readonly document: Document;
  readonly locale: string;
  readonly referenceIcon?: (nodeType: string | null) => Node;
}): DOMSerializer {
  const { content, node: root, document, locale, referenceIcon } = input;
  const style = getBibliographyStyleId(root), citations = deriveCitations(root, style);
  const textBlock = (node: ProseMirrorNode) => renderWorkspaceTextBlock(node, document);
  return new DOMSerializer({
    rootBlock: node => renderWorkspaceRootBlock(node, document),
    baseBlock: textBlock, headingBlock: textBlock, listItemBlock: textBlock, quoteBlock: textBlock,
    hardBreak: () => ['br'],
    horizontalRuleBlock: () => ['hr'],
    codeBlock: node => ['pre', { class: 'workspace-preview-code', 'data-language': string(node, 'language') }, ['code', 0]],
    latexBlock: node => math(node, document), inlineLatex: node => math(node, document),
    chartBlock: node => ['figure', { 'data-workspace-chart-id': string(node, 'id'), class: 'workspace-preview-chart' }],
    imageBlock: node => {
      const id = string(node, 'assetId') || string(node, 'id'), size = content.images[id];
      // 清单里没有这张图，说明它没有正式来源（受管资产或文档媒体目录）：不伪装成完整预览。
      if (string(node, 'src') && !size) throw new Error(`preview_image_resource_missing:${id || string(node, 'id')}`);
      return renderWorkspaceImageBlock(node, document, { imageSource: '', pendingImage: size, emptyImageLabel: locale.startsWith('zh') ? '未添加图片' : 'No image' });
    },
    table: node => ['div', { class: 'workspace-preview-table' }, ['table', { class: WORKSPACE_TABLE_CLASS, ...workspaceTableStyleAttributes(node.attrs.tableStyle) }, ['tbody', 0]]],
    tableRow: () => ['tr', 0], tableCell: node => tableCell(node, document), tableHeader: node => tableCell(node, document),
    tableCellContentBlock: () => ['p', { class: 'table-cell-content-block' }, 0],
    documentReference: node => documentReference(node, content, document, locale, referenceIcon),
    citationNode: node => ['span', { class: 'citation-mark' }, citations.labelByCitationId.get(string(node, 'citationId')) ?? '[?]'],
    bibliographyBlock: () => bibliography(citations, style, document, locale),
    columnReference: node => ['span', { class: 'workspace-preview-column-reference' }, string(node, 'label') || string(node, 'refKey')],
  }, {
    bold: () => ['strong', 0], italic: () => ['em', 0], strike: () => ['s', 0], code: () => ['code', 0],
    link: mark => ['a', { href: typeof mark.attrs.href === 'string' ? mark.attrs.href : '', rel: 'noopener noreferrer nofollow' }, 0],
    textColor: mark => ['span', { style: `color:${typeof mark.attrs.color === 'string' ? mark.attrs.color : 'inherit'}` }, 0],
    textHighlight: mark => ['mark', { style: `background-color:${typeof mark.attrs.color === 'string' ? mark.attrs.color : 'transparent'}` }, 0],
    revisionMark: () => ['span', 0],
  });
}
