export interface WebReliabilityCase {
  id: string;
  language: 'zh' | 'en';
  query: string;
  minResults: number;
  recencyDays?: number;
  requiredAnyDomain?: string[];
  requiredAnyKeyword?: string[];
}

export const WEB_RELIABILITY_CASES: WebReliabilityCase[] = [
  { id: 'zh-official-node', language: 'zh', query: 'Node.js 官方文档 fetch', minResults: 3, requiredAnyDomain: ['nodejs.org'] },
  { id: 'zh-official-ts', language: 'zh', query: 'TypeScript 官方文档 handbook', minResults: 3, requiredAnyDomain: ['typescriptlang.org'] },
  { id: 'zh-official-mdn', language: 'zh', query: 'MDN AbortSignal 文档', minResults: 3, requiredAnyDomain: ['developer.mozilla.org'] },
  { id: 'zh-official-electron', language: 'zh', query: 'Electron webContents 官方文档', minResults: 3, requiredAnyDomain: ['electronjs.org'] },
  { id: 'zh-official-openai', language: 'zh', query: 'OpenAI API 官方文档', minResults: 3, requiredAnyDomain: ['openai.com'] },
  { id: 'zh-tech-http', language: 'zh', query: 'HTTP 429 Retry-After 标准', minResults: 3, requiredAnyKeyword: ['429', 'retry-after'] },
  { id: 'zh-tech-ssrf', language: 'zh', query: 'OWASP SSRF 防护指南', minResults: 3, requiredAnyDomain: ['owasp.org'] },
  { id: 'zh-tech-wilson', language: 'zh', query: 'Wilson score interval 公式', minResults: 3, requiredAnyKeyword: ['wilson'] },
  { id: 'zh-tech-readability', language: 'zh', query: 'Mozilla Readability GitHub', minResults: 3, requiredAnyDomain: ['github.com'] },
  { id: 'zh-tech-undici', language: 'zh', query: 'Undici fetch Node.js GitHub', minResults: 3, requiredAnyDomain: ['github.com', 'nodejs.org'] },
  { id: 'zh-entity-beijing', language: 'zh', query: '北京故宫博物院 官方网站', minResults: 3, requiredAnyDomain: ['dpm.org.cn'] },
  { id: 'zh-entity-nasa', language: 'zh', query: 'NASA 官方网站 中文介绍', minResults: 3, requiredAnyDomain: ['nasa.gov'] },
  { id: 'zh-longtail-dns', language: 'zh', query: 'DNS rebinding SSRF 重定向校验', minResults: 3, requiredAnyKeyword: ['dns', 'ssrf'] },
  { id: 'zh-longtail-cgnat', language: 'zh', query: '100.64.0.0/10 CGNAT 地址范围', minResults: 3, requiredAnyKeyword: ['100.64', 'cgnat'] },
  { id: 'zh-longtail-citation', language: 'zh', query: '学术引用可追溯证据链 设计', minResults: 3, requiredAnyKeyword: ['引用', '证据'] },
  { id: 'zh-site-node', language: 'zh', query: 'site:nodejs.org AbortController', minResults: 3, requiredAnyDomain: ['nodejs.org'] },
  { id: 'zh-site-github', language: 'zh', query: 'site:github.com mozilla readability', minResults: 3, requiredAnyDomain: ['github.com'] },
  { id: 'zh-news-ai', language: 'zh', query: '人工智能 最新 官方公告', minResults: 3, recencyDays: 30, requiredAnyKeyword: ['AI', '人工智能'] },
  { id: 'zh-news-browser', language: 'zh', query: '浏览器安全 最新漏洞公告', minResults: 3, recencyDays: 30, requiredAnyKeyword: ['浏览器', '安全'] },
  { id: 'zh-news-node', language: 'zh', query: 'Node.js 最新版本发布', minResults: 3, recencyDays: 180, requiredAnyKeyword: ['node'] },
  { id: 'en-official-node', language: 'en', query: 'Node.js fetch official documentation', minResults: 3, requiredAnyDomain: ['nodejs.org'] },
  { id: 'en-official-ts', language: 'en', query: 'TypeScript handbook official', minResults: 3, requiredAnyDomain: ['typescriptlang.org'] },
  { id: 'en-official-mdn', language: 'en', query: 'MDN AbortSignal documentation', minResults: 3, requiredAnyDomain: ['developer.mozilla.org'] },
  { id: 'en-official-electron', language: 'en', query: 'Electron webContents official docs', minResults: 3, requiredAnyDomain: ['electronjs.org'] },
  { id: 'en-official-openai', language: 'en', query: 'OpenAI API official documentation', minResults: 3, requiredAnyDomain: ['openai.com'] },
  { id: 'en-tech-http', language: 'en', query: 'HTTP 429 Retry-After specification', minResults: 3, requiredAnyKeyword: ['429', 'retry-after'] },
  { id: 'en-tech-ssrf', language: 'en', query: 'OWASP SSRF prevention cheat sheet', minResults: 3, requiredAnyDomain: ['owasp.org'] },
  { id: 'en-tech-wilson', language: 'en', query: 'Wilson score interval formula', minResults: 3, requiredAnyKeyword: ['wilson'] },
  { id: 'en-tech-readability', language: 'en', query: 'Mozilla Readability GitHub', minResults: 3, requiredAnyDomain: ['github.com'] },
  { id: 'en-tech-undici', language: 'en', query: 'Undici fetch documentation', minResults: 3, requiredAnyDomain: ['github.com', 'nodejs.org'] },
  { id: 'en-entity-nasa', language: 'en', query: 'NASA official website', minResults: 3, requiredAnyDomain: ['nasa.gov'] },
  { id: 'en-entity-who', language: 'en', query: 'World Health Organization official website', minResults: 3, requiredAnyDomain: ['who.int'] },
  { id: 'en-longtail-dns', language: 'en', query: 'DNS rebinding SSRF redirect validation', minResults: 3, requiredAnyKeyword: ['dns', 'ssrf'] },
  { id: 'en-longtail-cgnat', language: 'en', query: '100.64.0.0/10 CGNAT address range', minResults: 3, requiredAnyKeyword: ['100.64', 'cgnat'] },
  { id: 'en-longtail-citation', language: 'en', query: 'traceable citation evidence architecture', minResults: 3, requiredAnyKeyword: ['citation', 'evidence'] },
  { id: 'en-site-node', language: 'en', query: 'site:nodejs.org AbortController', minResults: 3, requiredAnyDomain: ['nodejs.org'] },
  { id: 'en-site-github', language: 'en', query: 'site:github.com mozilla readability', minResults: 3, requiredAnyDomain: ['github.com'] },
  { id: 'en-news-ai', language: 'en', query: 'artificial intelligence latest official announcement', minResults: 3, recencyDays: 30, requiredAnyKeyword: ['AI', 'artificial intelligence'] },
  { id: 'en-news-browser', language: 'en', query: 'browser security latest vulnerability advisory', minResults: 3, recencyDays: 30, requiredAnyKeyword: ['browser', 'security'] },
  { id: 'en-news-node', language: 'en', query: 'Node.js latest release', minResults: 3, recencyDays: 180, requiredAnyKeyword: ['node'] },
];
