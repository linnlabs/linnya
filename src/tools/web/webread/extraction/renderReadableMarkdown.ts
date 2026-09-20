import TurndownService from 'turndown';

// 表格无法无损表达为 GFM 时保留原始跨度/标题关系；不按属性数字展开网格。
const CONTENT_ATTRIBUTES = new Set([
  'href', 'src', 'alt', 'title', 'rowspan', 'colspan', 'scope', 'headers', 'id',
  'span', 'start', 'value', 'reversed',
]);

const converter = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
  preformattedCode: true,
});
converter.addRule('sourceTables', {
  filter: 'table',
  replacement: (_content, node) => `\n\n${node.outerHTML}\n\n`,
});
converter.addRule('withdrawnText', {
  filter: node => ['DEL', 'S', 'STRIKE'].includes(node.nodeName),
  replacement: content => content ? `~~${content}~~` : '',
});
converter.addRule('explicitListNumbers', {
  filter: node => node.nodeName === 'OL'
    && (node.hasAttribute('reversed') || node.querySelector('li[value]') !== null),
  replacement: (_content, node) => `\n\n${node.outerHTML}\n\n`,
});
converter.keep(['ins', 'sup', 'sub']);

/** 只转换已选中的正文，普通 Markdown 交给库处理，表格保留精简 HTML。 */
export function renderReadableMarkdown(element: Element): string {
  const content = element.ownerDocument.createElement('div');
  content.appendChild(element.cloneNode(true));
  // 保留的 HTML 只携带内容属性；不能把事件、样式或其他页面行为带进 observation。
  for (const node of content.querySelectorAll('*')) {
    for (const attribute of [...node.attributes]) {
      if (!CONTENT_ATTRIBUTES.has(attribute.name)) node.removeAttribute(attribute.name);
    }
  }
  return converter.turndown(content);
}
