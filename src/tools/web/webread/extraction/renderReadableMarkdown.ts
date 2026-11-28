import TurndownService from 'turndown';
import { normalizeExtractedText } from './normalizeExtractedText';

// 表格无法无损表达为 GFM 时保留原始跨度/标题关系；不按属性数字展开网格。
const CONTENT_ATTRIBUTES = new Set([
  'href', 'src', 'alt', 'title', 'rowspan', 'colspan', 'scope', 'headers', 'id',
  'span', 'start', 'value', 'reversed',
]);
const VALID_CODE_LANGUAGE_PATTERN = /^[a-z0-9_+#.-]{1,32}$/i;
const CLASS_CODE_LANGUAGE_PATTERN = /(?:^|\s)(?:language|lang)-([a-z0-9_+#.-]{1,32})(?=\s|$)/i;
const TEX_ANNOTATION_ENCODINGS = new Set([
  'application/x-tex',
  'text/x-latex',
  'application/x-latex',
]);
const MATH_MARKER_ATTRIBUTE = 'data-linnya-math';
const MATH_WRAPPER_SELECTOR = '.katex-display, .katex, .mwe-math-element';

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
converter.addRule('mathLatex', {
  // 直接读取原始 LaTeX 源码，避免 Turndown 转义反斜杠、下划线和上标符号。
  filter: node => node.nodeName === 'SPAN' && node.hasAttribute(MATH_MARKER_ATTRIBUTE),
  replacement: (_content, node) => {
    const latex = node.textContent ?? '';
    if (!latex) return '';
    return node.getAttribute(MATH_MARKER_ATTRIBUTE) === 'block'
      ? `\n\n$$\n${latex}\n$$\n\n`
      : `$${latex}$`;
  },
});
converter.keep(['ins', 'sup', 'sub']);

function normalizeSafeLanguageToken(raw: string | null | undefined): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed || !VALID_CODE_LANGUAGE_PATTERN.test(trimmed)) return undefined;
  return trimmed.toLowerCase();
}

function readLanguageFromElement(element: Element | null): string | undefined {
  if (!element) return undefined;
  for (const attr of ['data-lang', 'data-language'] as const) {
    const token = normalizeSafeLanguageToken(element.getAttribute(attr));
    if (token) return token;
  }
  const className = element.getAttribute('class') ?? '';
  const match = CLASS_CODE_LANGUAGE_PATTERN.exec(className);
  return match?.[1] ? match[1].toLowerCase() : undefined;
}

function extractSafeCodeLanguage(code: Element, pre: Element | null): string | undefined {
  return readLanguageFromElement(code) ?? readLanguageFromElement(pre);
}

function collectPreCodeLanguages(content: Element): Map<Element, string> {
  const languages = new Map<Element, string>();
  for (const pre of content.querySelectorAll('pre')) {
    if (pre.children.length === 1 && pre.children[0]?.tagName === 'CODE') {
      const code = pre.children[0];
      // 移除 pretty-print 产生的纯空白兄弟文本节点，确保 Turndown 匹配 fencedCodeBlock。
      for (const child of [...pre.childNodes]) {
        if (child !== code && child.nodeType === 3 && !(child.textContent ?? '').trim()) {
          pre.removeChild(child);
        }
      }
      const language = extractSafeCodeLanguage(code, pre);
      if (language) languages.set(code, language);
    }
  }
  return languages;
}

/** 剥离 Wikipedia 等站点最外层成对的 `{\displaystyle ...}` 装饰包装。 */
function stripOuterDisplaystyleWrapper(latex: string): string {
  const trimmed = latex.trim();
  const prefix = '{\\displaystyle';
  if (!trimmed.startsWith(prefix) || !trimmed.endsWith('}')) return trimmed;
  let depth = 0;
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (char === '\\') {
      index += 1;
      continue;
    }
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        if (index === trimmed.length - 1) {
          return trimmed.slice(prefix.length, -1).trim();
        }
        return trimmed;
      }
    }
  }
  return trimmed;
}

function findSafeMathReplaceTarget(math: Element): Element {
  const candidates: Element[] = [];
  for (let current: Element | null = math.parentElement; current; current = current.parentElement) {
    if (current.matches(MATH_WRAPPER_SELECTOR)) candidates.push(current);
  }
  // 从外到内挑选专用数学包裹容器，仅当容器只包含这一个 math 且不含额外段落正文时替换。
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index];
    if (!candidate) continue;
    if (candidate.querySelectorAll('math').length !== 1) continue;
    if (candidate.querySelector('p, pre, table, ul, ol') !== null) continue;
    return candidate;
  }
  return math;
}

function isBlockMath(math: Element, target: Element): boolean {
  if (math.getAttribute('display')?.trim().toLowerCase() === 'block') return true;
  if (target.classList.contains('katex-display') || math.closest('.katex-display') !== null) {
    return true;
  }
  if (target.classList.contains('mwe-math-element')) {
    const parent = target.parentElement;
    if (parent) {
      const parentText = normalizeExtractedText(parent.textContent);
      const targetText = normalizeExtractedText(target.textContent);
      if (parentText.length > 0 && parentText === targetText) return true;
    }
  }
  return false;
}

function findTexAnnotation(math: Element): Element | undefined {
  for (const annotation of math.querySelectorAll('annotation')) {
    const encoding = annotation.getAttribute('encoding')?.trim().toLowerCase();
    if (encoding && TEX_ANNOTATION_ENCODINGS.has(encoding)) return annotation;
  }
  return undefined;
}

function normalizeMathElements(content: Element): void {
  const doc = content.ownerDocument;
  for (const math of [...content.querySelectorAll('math')]) {
    if (!content.contains(math)) continue;
    const annotation = findTexAnnotation(math);
    const rawLatex = annotation?.textContent?.trim();
    if (rawLatex) {
      const latex = stripOuterDisplaystyleWrapper(rawLatex);
      if (latex) {
        const target = findSafeMathReplaceTarget(math);
        const span = doc.createElement('span');
        span.setAttribute(MATH_MARKER_ATTRIBUTE, isBlockMath(math, target) ? 'block' : 'inline');
        span.textContent = latex;
        target.replaceWith(span);
        continue;
      }
    }
    // 无 TeX annotation 的裸 MathML：剥离非展示 annotation 节点，避免重复噪音拼接。
    for (const extra of [...math.querySelectorAll('annotation, annotation-xml')]) {
      extra.remove();
    }
  }
}

/** 只转换已选中的正文，普通 Markdown 交给库处理，表格保留精简 HTML。 */
export function renderReadableMarkdown(element: Element): string {
  const content = element.ownerDocument.createElement('div');
  content.appendChild(element.cloneNode(true));
  normalizeMathElements(content);
  const codeLanguages = collectPreCodeLanguages(content);
  // 保留的 HTML 只携带内容属性；不能把事件、样式或其他页面行为带进 observation。
  for (const node of content.querySelectorAll('*')) {
    for (const attribute of [...node.attributes]) {
      const keepMathMarker = node.tagName === 'SPAN' && attribute.name === MATH_MARKER_ATTRIBUTE;
      if (!keepMathMarker && !CONTENT_ATTRIBUTES.has(attribute.name)) {
        node.removeAttribute(attribute.name);
      }
    }
  }
  // 剥离完成后仅给 `pre > code` 回填经过白名单校验的语言类，供 Turndown 输出围栏语言标注。
  for (const [code, language] of codeLanguages) {
    code.setAttribute('class', `language-${language}`);
  }
  return converter.turndown(content);
}
