import { renderReadableMarkdown } from './renderReadableMarkdown';

export interface SemanticDomExtraction {
  readonly text: string;
  readonly textLength: number;
  readonly title?: string;
}

export function normalizeExtractedText(value: string | null | undefined): string {
  return (value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractCandidate(element: Element): SemanticDomExtraction {
  const text = renderReadableMarkdown(element);
  const title = normalizeExtractedText(element.querySelector('h1')?.textContent);
  return {
    text,
    textLength: normalizeExtractedText(element.textContent).length,
    ...(title ? { title } : {}),
  };
}

/**
 * Readability 无法覆盖应用型页面时，只从页面声明的主内容区域读取可访问文本。
 * 禁止回退到整个 body，否则导航、侧栏和页脚会被误当成正文。
 */
export function extractSemanticDom(document: Document): SemanticDomExtraction {
  let selected: SemanticDomExtraction = { text: '', textLength: 0 };
  for (const candidate of document.querySelectorAll('article, main, [role="main"]')) {
    const extracted = extractCandidate(candidate);
    if (extracted.textLength > selected.textLength) selected = extracted;
  }
  return selected;
}
