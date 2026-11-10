/**
 * 信息获取基准的冻结任务。每题只声明“必须取得什么”，不规定怎么查；
 * 检查项在 2026-11-10 逐项对原件核实过（URL 与原文片段见各题 note）。
 */

export type WebAcquisitionLayer =
  | 'primary_source'
  | 'recency'
  | 'long_page'
  | 'pdf'
  | 'language'
  | 'site'
  | 'api'
  | 'image';

/** content：原文片段确实出现在某次成功读取的输出里；source 限定该来源被成功取得过。fetch：成功取得过匹配的地址。 */
export type WebAcquisitionCheck =
  | { readonly kind: 'content'; readonly id: string; readonly label: string; readonly needle: string; readonly source?: string }
  | { readonly kind: 'fetch'; readonly id: string; readonly label: string; readonly pattern: string };

export interface WebAcquisitionTask {
  readonly key: string;
  readonly layers: readonly WebAcquisitionLayer[];
  readonly prompt: string;
  readonly checks: readonly WebAcquisitionCheck[];
  readonly note: string;
}

const tail = '不用问我，直接查完，给出答案、原文出处和你实际是怎么取得的。';

export const WEB_ACQUISITION_TASKS: readonly WebAcquisitionTask[] = [
  {
    key: 'zh-policy-136',
    layers: ['primary_source', 'site'],
    prompt: `国家发改委、国家能源局关于新能源上网电价市场化改革的“136号文”，原文在哪里？完整发文字号和印发日期是什么？${tail}`,
    checks: [
      { kind: 'content', id: 'number', label: '原文发文字号', needle: '发改价格〔2025〕136号', source: 'ndrc\\.gov\\.cn|www\\.gov\\.cn|nea\\.gov\\.cn' },
      { kind: 'content', id: 'date', label: '原文落款日期', needle: '2025年1月27日', source: 'ndrc\\.gov\\.cn|www\\.gov\\.cn|nea\\.gov\\.cn' },
    ],
    note: 'https://www.ndrc.gov.cn/xxgk/zcfb/tz/202502/t20250209_1396066.html 正文末尾落款 2025年1月27日；转载页多以发布日 2 月 9 日为日期。',
  },
  {
    key: 'recent-parallel-mcp',
    layers: ['recency', 'primary_source'],
    prompt: `Parallel（parallel.ai）最近发布的新版 MCP 是哪天发布的？免 Key 使用有什么限制？${tail}`,
    checks: [{ kind: 'content', id: 'date', label: '官方博客发布日期', needle: 'November 5, 2026', source: 'parallel\\.ai' }],
    note: 'https://parallel.ai/blog/parallel-mcp-2 标注 November 5, 2026。',
  },
  {
    key: 'long-rfc-421',
    layers: ['long_page', 'primary_source'],
    prompt: `HTTP 状态码 421 Misdirected Request 在 RFC 9110 里的原文定义是什么？请引用原文句子。${tail}`,
    checks: [{
      kind: 'content', id: 'definition', label: 'RFC 9110 §15.5.20 原文',
      needle: 'unable or unwilling to produce an authoritative response', source: 'rfc9110|rfc-editor\\.org|httpwg\\.org',
    }],
    note: 'rfc-editor.org 的 HTML 正文约 47 万字，该句位于约 36 万字处，超过单页 5 万字上限。',
  },
  {
    key: 'pdf-meti-self-sufficiency',
    layers: ['pdf', 'language', 'primary_source'],
    prompt: `日本第7次能源基本计划（第7次エネルギー基本計画）里，2040 年度的能源自给率预计是多少？请以经济产业省的原文为准。${tail}`,
    checks: [
      { kind: 'content', id: 'ratio', label: '本文 PDF 第 17 页原句', needle: '2040年度エネルギー自給率は3~4割程度', source: 'enecho\\.meti\\.go\\.jp|meti\\.go\\.jp' },
    ],
    note: 'https://www.enecho.meti.go.jp/category/others/basic_plan/pdf/20250218_01.pdf 第 17 页，原文为全角数字，比较前做 NFKC 规范化。',
  },
  {
    key: 'en-paper-transformer',
    layers: ['primary_source'],
    prompt: `论文 "Attention Is All You Need" 里 big Transformer 训练了多久、用了什么硬件？请以论文原文为准。${tail}`,
    checks: [{ kind: 'content', id: 'training', label: '论文训练时间', needle: '3.5 days', source: 'arxiv\\.org|ar5iv|neurips\\.cc|papers\\.nips\\.cc' }],
    note: 'arXiv 1706.03762 §5.2：big models were trained for 300,000 steps (3.5 days)。',
  },
  {
    key: 'site-sec-apple-10k',
    layers: ['site', 'api', 'primary_source'],
    prompt: `只用美国 SEC（sec.gov）上的资料：Apple 最近一份 10-K 是哪天提交的，accession number 是多少？${tail}`,
    checks: [{ kind: 'content', id: 'accession', label: '2026 财年 10-K accession', needle: '0000320193-26-000026', source: 'sec\\.gov' }],
    note: 'data.sec.gov/submissions/CIK0000320193.json：10-K 2026-11-03，0000320193-26-000026。',
  },
  {
    key: 'image-houmuwu',
    layers: ['image'],
    prompt: `给一页讲商代青铜器的演示文稿找一张后母戊鼎的清晰照片：下载到会话目录，并写明来源页、作者和许可。${tail}`,
    checks: [
      { kind: 'fetch', id: 'download', label: '从图库或馆方取得原图', pattern: '(upload\\.wikimedia\\.org|chnmuseum\\.cn|openverse)[^\\s"]*\\.(jpe?g|png|webp|tiff?)' },
      { kind: 'fetch', id: 'license', label: '读过来源页或许可信息', pattern: 'commons\\.wikimedia\\.org/wiki/File:|api\\.openverse|chnmuseum\\.cn' },
    ],
    note: '只检查取得行为，图片是否适合入稿由人看。',
  },
];
