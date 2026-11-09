import { DOMSerializer, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { WorkspaceMarkdownPreview } from '@app/schemas';
import { renderWorkspaceLatex } from './workspaceLatexPresentation';
import { deriveCitations, getBibliographyStyleId, formatBibliographyAuthors, formatCitationDate, type CitationDerivationResult } from '../../workspace-citations';
import { renderWorkspaceImageBlock, renderWorkspaceRootBlock, renderWorkspaceTextBlock } from './workspaceBlockPresentation';

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
function documentReference(node: ProseMirrorNode, content: WorkspaceMarkdownPreview, document: Document, locale: string): HTMLElement {
  const element = document.createElement('span');
  const id = string(node, 'documentId'), presentation = content.references[id];
  element.className = 'markdown-document-reference';
  element.setAttribute('data-document-id', id);
  element.setAttribute('data-reference-id', string(node, 'referenceId'));
  element.setAttribute('data-reference-status', presentation?.status ?? 'deleted');
  const label = document.createElement('span');
  label.className = 'markdown-document-reference-label';
  label.setAttribute('data-document-reference-label', '');
  label.textContent = presentation?.status === 'outside_project' ? (locale.startsWith('zh') ? '项目外文档' : 'Outside this project')
    : presentation?.status === 'deleted' || !presentation ? (locale.startsWith('zh') ? '文档已删除' : 'Deleted document')
    : presentation.title ?? (locale.startsWith('zh') ? '文档' : 'Document');
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
}): DOMSerializer {
  const { content, node: root, document, locale } = input;
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
      const id = string(node, 'assetId') || string(node, 'id'), source = content.assets[id];
      if (string(node, 'src') && !source) throw new Error(`preview_image_resource_missing:${id || string(node, 'id')}`);
      return renderWorkspaceImageBlock(node, document, { imageSource: source ?? '', emptyImageLabel: locale.startsWith('zh') ? '未添加图片' : 'No image' });
    },
    table: () => ['div', { class: 'workspace-preview-table' }, ['table', ['tbody', 0]]],
    tableRow: () => ['tr', 0], tableCell: node => tableCell(node, document), tableHeader: node => tableCell(node, document),
    tableCellContentBlock: () => ['p', { class: 'table-cell-content-block' }, 0],
    documentReference: node => documentReference(node, content, document, locale),
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
