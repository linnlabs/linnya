import { load } from 'cheerio';
import { parseHTML } from 'linkedom';
import { WebFailureError } from '../../shared/webFailure';

function isElement(node: Node): node is Element {
  return node.nodeType === 1;
}

function assertCanonicalDocument(document: Document): void {
  const rootElements = [...document.childNodes].filter(isElement);
  const htmlChildren = [...document.documentElement.children];
  const heads = htmlChildren.filter(element => element.tagName === 'HEAD');
  const bodies = htmlChildren.filter(element => element.tagName === 'BODY');
  const unexpected = htmlChildren.filter(element => element.tagName !== 'HEAD' && element.tagName !== 'BODY');

  if (rootElements.length !== 1
    || rootElements[0] !== document.documentElement
    || heads.length !== 1
    || bodies.length !== 1
    || unexpected.length > 0
    || document.head !== heads[0]
    || document.body !== bodies[0]) {
    throw new Error('HTML parser did not produce one canonical html/head/body tree.');
  }
}

/**
 * 先用 WHATWG HTML tree builder 修复浏览器可容错的 tag soup，再创建 Readability
 * 所需的轻量 DOM。禁止在这里按站点或标签文本做正则修补；节点归属和顺序必须由
 * 标准 HTML 解析算法决定。
 */
export function parseCanonicalHtmlDocument(html: string): Document {
  try {
    const canonicalHtml = load(html).html();
    const { document } = parseHTML(canonicalHtml);
    assertCanonicalDocument(document);
    return document;
  } catch (cause: unknown) {
    throw new WebFailureError(
      'extraction_error',
      '[WEB_READ_EXTRACTION_FAILED] 网页 HTML 无法规范化为可抽取文档（stage=dom_canonicalization）。',
      {
        details: { extractionStage: 'dom_canonicalization' },
        cause,
      },
    );
  }
}
