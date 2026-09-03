export interface SemanticDomExtraction {
  readonly text: string;
  readonly title?: string;
}

const EXCLUDED_SELECTOR = [
  'script',
  'style',
  'noscript',
  'template',
  'nav',
  'aside',
  'footer',
  '[hidden]',
  '[inert]',
  '[aria-hidden="true"]',
  '[role="navigation"]',
  '[role="complementary"]',
  '[role="contentinfo"]',
].join(', ');

const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'BLOCKQUOTE', 'DD', 'DIV', 'DL', 'DT', 'FIGCAPTION', 'FIGURE',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'OL', 'P',
  'PRE', 'SECTION', 'TABLE', 'TBODY', 'TFOOT', 'THEAD', 'TR', 'UL',
]);

export function normalizeExtractedText(value: string | null | undefined): string {
  return (value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function isElement(node: Node): node is Element {
  return node.nodeType === 1;
}

function appendSemanticText(node: Node, output: string[]): void {
  if (node.nodeType === 3) {
    output.push((node.textContent ?? '').replace(/\s+/g, ' '));
    return;
  }
  if (!isElement(node) || node.matches(EXCLUDED_SELECTOR)) return;

  const tagName = node.tagName;
  if (tagName === 'BR') {
    output.push('\n');
    return;
  }
  if (tagName === 'PRE') {
    output.push('\n', node.textContent ?? '', '\n');
    return;
  }

  const isBlock = BLOCK_TAGS.has(tagName);
  if (isBlock) output.push('\n');
  if (tagName === 'LI') output.push('- ');

  for (const child of node.childNodes) appendSemanticText(child, output);

  if (tagName === 'TH' || tagName === 'TD') output.push('\t');
  if (isBlock) output.push('\n');
}

function extractCandidate(element: Element): SemanticDomExtraction {
  const output: string[] = [];
  appendSemanticText(element, output);
  const text = normalizeExtractedText(output.join(''));
  const title = normalizeExtractedText(element.querySelector('h1')?.textContent);
  return {
    text,
    ...(title ? { title } : {}),
  };
}

/**
 * Readability 无法覆盖应用型页面时，只从页面声明的主内容区域读取可访问文本。
 * 禁止回退到整个 body，否则导航、侧栏和页脚会被误当成正文。
 */
export function extractSemanticDom(document: Document): SemanticDomExtraction {
  let selected: SemanticDomExtraction = { text: '' };
  for (const candidate of document.querySelectorAll('article, main, [role="main"]')) {
    const extracted = extractCandidate(candidate);
    if (extracted.text.length > selected.text.length) selected = extracted;
  }
  return selected;
}
