import type { WebFailureKind } from '../../../src/tools/web/shared/webFailure';

export type WebReadCaseCategory =
  | 'static_article'
  | 'official_docs'
  | 'recent_news'
  | 'js_heavy'
  | 'pdf'
  | 'table_or_code'
  | 'long_page'
  | 'redirect'
  | 'gov_notice'
  | 'spa_hash'
  | 'spa_iframe'
  | 'nav_trap'
  | 'access_blocked'
  | 'canvas_visual';

export type WebReadExpectedOutcome = 'content' | 'resources_only' | 'blocked';
export type WebReadExpectedRoute = 'local_http' | 'local_render' | 'any';

export interface ExpectedTableCell {
  text: string;
  rowSpan?: number;
  colSpan?: number;
}

/** 冻结来源中的关键内容；只评价声明过的检查项，不代表整页已验证。 */
export type WebContentAssertion = { id: string } & (
  | { kind: 'link'; url: string }
  | { kind: 'code'; text: string }
  | { kind: 'strikethrough'; text: string }
  | { kind: 'table'; rows: ExpectedTableCell[][] }
  | { kind: 'text_present'; text: string }
  | { kind: 'text_absent'; text: string }
);

export interface WebReadReliabilityCase {
  id: string;
  language: 'zh' | 'en';
  category: WebReadCaseCategory;
  url: string;
  minChars: number;
  expectedAnyKeywords: string[];
  expectCodeBlock?: boolean;
  expectTable?: boolean;
  contentAssertions?: WebContentAssertion[];
  expectedOutcome?: WebReadExpectedOutcome;
  expectedFailureKind?: WebFailureKind | readonly WebFailureKind[];
  expectedRoute?: WebReadExpectedRoute;
}

export const WEB_READ_RELIABILITY_CASES: WebReadReliabilityCase[] = [
  { id: 'zh-static-wikipedia', language: 'zh', category: 'static_article', url: 'https://zh.wikipedia.org/wiki/超文本传输协议', minChars: 800, expectedAnyKeywords: ['超文本传输协议', 'HTTP'], expectedOutcome: 'content', expectedRoute: 'local_http' },
  { id: 'zh-docs-vue', language: 'zh', category: 'official_docs', url: 'https://cn.vuejs.org/guide/introduction.html', minChars: 1000, expectedAnyKeywords: ['Vue'], expectCodeBlock: true, expectedOutcome: 'content', expectedRoute: 'local_http' },
  { id: 'zh-news-gov', language: 'zh', category: 'recent_news', url: 'https://www.gov.cn/yaowen/', minChars: 500, expectedAnyKeywords: ['国务院', '中国政府网'], expectedOutcome: 'content', expectedRoute: 'any' },
  { id: 'zh-js-ant', language: 'zh', category: 'js_heavy', url: 'https://ant-design.antgroup.com/components/overview-cn', minChars: 800, expectedAnyKeywords: ['Ant Design', '组件'], expectedOutcome: 'content', expectedRoute: 'any' },
  { id: 'zh-pdf-w3c', language: 'zh', category: 'pdf', url: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf', minChars: 10, expectedAnyKeywords: ['Dummy PDF'], expectedOutcome: 'content', expectedRoute: 'local_http' },
  { id: 'zh-code-mdn', language: 'zh', category: 'table_or_code', url: 'https://developer.mozilla.org/zh-CN/docs/Web/API/Fetch_API/Using_Fetch', minChars: 1000, expectedAnyKeywords: ['Fetch'], expectCodeBlock: true, expectedOutcome: 'content', expectedRoute: 'local_http' },
  { id: 'zh-long-wikipedia', language: 'zh', category: 'long_page', url: 'https://zh.wikipedia.org/wiki/JavaScript', minChars: 3000, expectedAnyKeywords: ['JavaScript', '脚本语言'], expectCodeBlock: true, expectedOutcome: 'content', expectedRoute: 'local_http' },
  { id: 'zh-redirect-httpbin', language: 'zh', category: 'redirect', url: 'https://httpbin.org/redirect-to?url=https%3A%2F%2Fexample.com%2F', minChars: 50, expectedAnyKeywords: ['Example Domain'], expectedOutcome: 'content', expectedRoute: 'local_http' },
  { id: 'en-static-wikipedia', language: 'en', category: 'static_article', url: 'https://en.wikipedia.org/wiki/Hypertext_Transfer_Protocol', minChars: 1200, expectedAnyKeywords: ['Hypertext Transfer Protocol', 'HTTP'], expectedOutcome: 'content', expectedRoute: 'local_http' },
  { id: 'en-docs-node', language: 'en', category: 'official_docs', url: 'https://nodejs.org/api/globals.html', minChars: 3000, expectedAnyKeywords: ['Global objects'], expectCodeBlock: true, expectedOutcome: 'content', expectedRoute: 'local_http' },
  { id: 'en-news-nasa', language: 'en', category: 'recent_news', url: 'https://www.nasa.gov/news/', minChars: 500, expectedAnyKeywords: ['NASA'], expectedOutcome: 'content', expectedRoute: 'any' },
  { id: 'en-js-react', language: 'en', category: 'js_heavy', url: 'https://react.dev/reference/react', minChars: 800, expectedAnyKeywords: ['React'], expectCodeBlock: true, expectedOutcome: 'content', expectedRoute: 'any' },
  { id: 'en-pdf-arxiv', language: 'en', category: 'pdf', url: 'https://arxiv.org/pdf/1706.03762', minChars: 3000, expectedAnyKeywords: ['Attention Is All You Need', 'Transformer'], expectedOutcome: 'content', expectedRoute: 'local_http' },
  { id: 'en-table-mdn', language: 'en', category: 'table_or_code', url: 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status', minChars: 1200, expectedAnyKeywords: ['HTTP response status codes'], expectTable: true, expectedOutcome: 'content', expectedRoute: 'local_http' },
  { id: 'en-long-rfc', language: 'en', category: 'long_page', url: 'https://www.rfc-editor.org/rfc/rfc9110.html', minChars: 5000, expectedAnyKeywords: ['HTTP Semantics'], expectedOutcome: 'content', expectedRoute: 'local_http' },
  { id: 'en-redirect-httpbin', language: 'en', category: 'redirect', url: 'https://httpbin.org/redirect-to?url=https%3A%2F%2Fexample.com%2F', minChars: 50, expectedAnyKeywords: ['Example Domain'], expectedOutcome: 'content', expectedRoute: 'local_http' },
];

/** 阶段 0 动态网页摸底样本（A-E 组机构公开站点，供 --suite dynamic|all 使用）。 */
export const WEB_READ_PHASE0_PROBE_CASES: WebReadReliabilityCase[] = [
  // A 组：政府与公共机构网页
  {
    id: 'zh-gov-policy-detail',
    language: 'zh',
    category: 'gov_notice',
    url: 'https://www.gov.cn/zhengce/content/2022-01/04/content_5666340.htm',
    minChars: 800,
    expectedAnyKeywords: ['要素市场化配置', '国务院'],
    expectedOutcome: 'content',
    expectedRoute: 'any',
  },
  {
    id: 'zh-gov-latest-js-shell',
    language: 'zh',
    category: 'gov_notice',
    url: 'https://www.gov.cn/zhengce/zuixin.htm',
    minChars: 300,
    expectedAnyKeywords: ['最新政策', '国务院', '政策'],
    expectedOutcome: 'content',
    expectedRoute: 'local_render',
  },
  {
    id: 'zh-stats-communique-2025',
    language: 'zh',
    category: 'gov_notice',
    url: 'https://www.stats.gov.cn/sj/zxfb/202602/t20260228_1962662.html',
    minChars: 3000,
    expectedAnyKeywords: ['国民经济和社会发展统计公报', '国内生产总值'],
    expectTable: true,
    expectedOutcome: 'content',
    expectedRoute: 'any',
  },
  {
    id: 'zh-ndrc-notice-detail',
    language: 'zh',
    category: 'gov_notice',
    url: 'https://www.ndrc.gov.cn/xxgk/zcfb/tz/202611/t20261123_1409024.html',
    minChars: 300,
    expectedAnyKeywords: ['国家发展改革委', '通知'],
    expectedOutcome: 'content',
    expectedRoute: 'any',
  },
  {
    id: 'zh-csrc-dynamic-list',
    language: 'zh',
    category: 'gov_notice',
    url: 'https://www.csrc.gov.cn/csrc/c101954/common_list.shtml',
    minChars: 300,
    expectedAnyKeywords: ['证监会', '公告'],
    expectedOutcome: 'content',
    expectedRoute: 'local_render',
  },
  {
    id: 'zh-pbc-policy-page',
    language: 'zh',
    category: 'gov_notice',
    url: 'https://www.pbc.gov.cn/zhengcehuobisi/125207/125213/125431/index.html',
    minChars: 300,
    expectedAnyKeywords: ['中国人民银行', '货币政策'],
    expectedOutcome: 'content',
    expectedRoute: 'any',
  },
  {
    id: 'en-who-fact-sheet',
    language: 'en',
    category: 'gov_notice',
    url: 'https://www.who.int/news-room/fact-sheets/detail/adolescents-health-risks-and-solutions',
    minChars: 1200,
    expectedAnyKeywords: ['WHO', 'Adolescent'],
    expectedOutcome: 'content',
    expectedRoute: 'any',
  },
  // B 组：现代 SPA / Hash 路由 / Shadow DOM / CSR
  {
    id: 'en-spa-hash-docsify-quickstart',
    language: 'en',
    category: 'spa_hash',
    url: 'https://docsify.js.org/#/quickstart',
    minChars: 500,
    expectedAnyKeywords: ['Quick start', 'docsify-cli'],
    contentAssertions: [
      { id: 'has-quickstart', kind: 'text_present', text: 'Quick start' },
      { id: 'not-config-only', kind: 'text_absent', text: 'loadSidebar' },
    ],
    expectedOutcome: 'content',
    expectedRoute: 'local_render',
  },
  {
    id: 'en-spa-hash-docsify-config',
    language: 'en',
    category: 'spa_hash',
    url: 'https://docsify.js.org/#/configuration',
    minChars: 800,
    expectedAnyKeywords: ['Configuration', 'loadSidebar'],
    contentAssertions: [
      { id: 'has-config', kind: 'text_present', text: 'loadSidebar' },
    ],
    expectedOutcome: 'content',
    expectedRoute: 'local_render',
  },
  {
    id: 'en-spa-swagger-petstore',
    language: 'en',
    category: 'js_heavy',
    url: 'https://petstore.swagger.io/',
    minChars: 400,
    expectedAnyKeywords: ['Swagger Petstore', 'pet'],
    expectedOutcome: 'content',
    expectedRoute: 'local_render',
  },
  {
    id: 'en-shadow-lit-components',
    language: 'en',
    category: 'js_heavy',
    url: 'https://lit.dev/docs/components/overview/',
    minChars: 800,
    expectedAnyKeywords: ['Lit', 'Shadow DOM', 'component'],
    expectCodeBlock: true,
    expectedOutcome: 'content',
    expectedRoute: 'any',
  },
  // C 组：国内公开协作文档与资讯 SPA
  {
    id: 'zh-yuque-help-csr',
    language: 'zh',
    category: 'js_heavy',
    url: 'https://www.yuque.com/yuque/help',
    minChars: 400,
    expectedAnyKeywords: ['语雀', '文档'],
    expectedOutcome: 'content',
    expectedRoute: 'local_render',
  },
  {
    id: 'zh-cls-telegraph-csr',
    language: 'zh',
    category: 'js_heavy',
    url: 'https://www.cls.cn/telegraph',
    minChars: 500,
    expectedAnyKeywords: ['财联社', '电报'],
    expectedOutcome: 'content',
    expectedRoute: 'local_render',
  },
  // D 组：国内金融与交易所公开页
  {
    id: 'zh-sse-disclosure-list',
    language: 'zh',
    category: 'js_heavy',
    url: 'https://www.sse.com.cn/disclosure/listedinfo/announcement/',
    minChars: 300,
    expectedAnyKeywords: ['上海证券交易所', '公告'],
    expectedOutcome: 'content',
    expectedRoute: 'local_render',
  },
  {
    id: 'zh-eastmoney-notices',
    language: 'zh',
    category: 'js_heavy',
    url: 'https://data.eastmoney.com/notices/',
    minChars: 500,
    expectedAnyKeywords: ['公告', '东方财富'],
    expectedOutcome: 'content',
    expectedRoute: 'any',
  },
  // E 组：诚实负向边界与 Canvas 对照
  {
    id: 'zh-blocked-zhihu-question',
    language: 'zh',
    category: 'access_blocked',
    url: 'https://www.zhihu.com/question/19550225',
    minChars: 0,
    expectedAnyKeywords: [],
    expectedOutcome: 'blocked',
    expectedFailureKind: ['http_403', 'login_required', 'captcha'],
    expectedRoute: 'any',
  },
  {
    id: 'en-canvas-echarts-editor',
    language: 'en',
    category: 'canvas_visual',
    url: 'https://echarts.apache.org/examples/en/editor.html?c=line-simple',
    minChars: 100,
    expectedAnyKeywords: ['ECharts', 'option'],
    expectedOutcome: 'content',
    expectedRoute: 'local_render',
  },
];
