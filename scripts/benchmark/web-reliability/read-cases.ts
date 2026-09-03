export type WebReadCaseCategory =
  | 'static_article'
  | 'official_docs'
  | 'recent_news'
  | 'js_heavy'
  | 'pdf'
  | 'table_or_code'
  | 'long_page'
  | 'redirect';

export interface WebReadReliabilityCase {
  id: string;
  language: 'zh' | 'en';
  category: WebReadCaseCategory;
  url: string;
  minChars: number;
  expectedAnyKeywords: string[];
  expectCodeBlock?: boolean;
  expectTable?: boolean;
  /** 当前产品明确不支持的内容类型，用于验证稳定终态而非正文质量。 */
  expectedFailureKind?: 'unsupported_mime';
}

export const WEB_READ_RELIABILITY_CASES: WebReadReliabilityCase[] = [
  { id: 'zh-static-wikipedia', language: 'zh', category: 'static_article', url: 'https://zh.wikipedia.org/wiki/超文本传输协议', minChars: 800, expectedAnyKeywords: ['超文本传输协议', 'HTTP'] },
  { id: 'zh-docs-vue', language: 'zh', category: 'official_docs', url: 'https://cn.vuejs.org/guide/introduction.html', minChars: 1000, expectedAnyKeywords: ['Vue'], expectCodeBlock: true },
  { id: 'zh-news-gov', language: 'zh', category: 'recent_news', url: 'https://www.gov.cn/yaowen/', minChars: 500, expectedAnyKeywords: ['国务院', '中国政府网'] },
  { id: 'zh-js-ant', language: 'zh', category: 'js_heavy', url: 'https://ant-design.antgroup.com/components/overview-cn', minChars: 800, expectedAnyKeywords: ['Ant Design', '组件'] },
  { id: 'zh-pdf-w3c', language: 'zh', category: 'pdf', url: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf', minChars: 20, expectedAnyKeywords: ['Dummy PDF'], expectedFailureKind: 'unsupported_mime' },
  { id: 'zh-code-mdn', language: 'zh', category: 'table_or_code', url: 'https://developer.mozilla.org/zh-CN/docs/Web/API/Fetch_API/Using_Fetch', minChars: 1000, expectedAnyKeywords: ['Fetch'], expectCodeBlock: true },
  { id: 'zh-long-wikipedia', language: 'zh', category: 'long_page', url: 'https://zh.wikipedia.org/wiki/JavaScript', minChars: 3000, expectedAnyKeywords: ['JavaScript', '脚本语言'], expectCodeBlock: true },
  { id: 'zh-redirect-httpbin', language: 'zh', category: 'redirect', url: 'https://httpbin.org/redirect-to?url=https%3A%2F%2Fexample.com%2F', minChars: 50, expectedAnyKeywords: ['Example Domain'] },
  { id: 'en-static-wikipedia', language: 'en', category: 'static_article', url: 'https://en.wikipedia.org/wiki/Hypertext_Transfer_Protocol', minChars: 1200, expectedAnyKeywords: ['Hypertext Transfer Protocol', 'HTTP'] },
  { id: 'en-docs-node', language: 'en', category: 'official_docs', url: 'https://nodejs.org/api/globals.html', minChars: 3000, expectedAnyKeywords: ['Global objects'], expectCodeBlock: true },
  { id: 'en-news-nasa', language: 'en', category: 'recent_news', url: 'https://www.nasa.gov/news/', minChars: 500, expectedAnyKeywords: ['NASA'] },
  { id: 'en-js-react', language: 'en', category: 'js_heavy', url: 'https://react.dev/reference/react', minChars: 800, expectedAnyKeywords: ['React'], expectCodeBlock: true },
  { id: 'en-pdf-arxiv', language: 'en', category: 'pdf', url: 'https://arxiv.org/pdf/1706.03762', minChars: 3000, expectedAnyKeywords: ['Attention Is All You Need', 'Transformer'], expectedFailureKind: 'unsupported_mime' },
  { id: 'en-table-mdn', language: 'en', category: 'table_or_code', url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status', minChars: 1200, expectedAnyKeywords: ['HTTP response status codes'], expectTable: true },
  { id: 'en-long-rfc', language: 'en', category: 'long_page', url: 'https://www.rfc-editor.org/rfc/rfc9110.html', minChars: 5000, expectedAnyKeywords: ['HTTP Semantics'] },
  { id: 'en-redirect-httpbin', language: 'en', category: 'redirect', url: 'https://httpbin.org/redirect-to?url=https%3A%2F%2Fexample.com%2F', minChars: 50, expectedAnyKeywords: ['Example Domain'] },
];
