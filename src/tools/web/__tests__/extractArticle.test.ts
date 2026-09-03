import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { extractArticle } from '../webread/extraction/extractArticle';

async function readFixture(name: string): Promise<string> {
  return readFile(new URL(`./fixtures/html/${name}`, import.meta.url), 'utf-8');
}

describe('extractArticle 确定性正文抽取', () => {
  it('从真实文章 HTML 提取正文与页面元数据', async () => {
    const result = extractArticle(await readFixture('static-article.html'));
    expect(result.title).toBe('本地网页抓取的安全边界');
    expect(result.text).toContain('DNS 校验结果还需要绑定到真正的网络连接');
    expect(result).toMatchObject({
      byline: '林雅研究组',
      publishedAt: '2026-07-18T06:00:00Z',
      siteName: 'Linnya 技术观察',
      language: 'zh-CN',
    });
    expect(result.qualityScore).toBeGreaterThanOrEqual(0.8);
    expect(result.warnings).not.toContain('js_shell');
  });

  it('识别只有应用壳和脚本的 JS 页面', async () => {
    const result = extractArticle(await readFixture('js-shell.html'));
    expect(result.warnings).toContain('js_shell');
    expect(result.qualityScore).toBeLessThan(0.5);
  });

  it('显式标记 Readability 不擅长的表格主导页面', async () => {
    const result = extractArticle(await readFixture('table-page.html'));
    expect(result.warnings).toContain('table_dominant');
    expect(result.title).toBe('季度数据表');
  });

  it('正文稀疏时仍从 JSON-LD 保留标题、作者和发布时间', async () => {
    const result = extractArticle(await readFixture('jsonld-page.html'));
    expect(result).toMatchObject({
      title: 'Structured Metadata Survives Sparse Pages',
      byline: 'Ada Example',
      publishedAt: '2026-07-17T12:30:00Z',
      siteName: 'Example Newsroom',
    });
    expect(result.warnings).toContain('content_too_short');
  });

  it('Readability 明显遗漏正文时改用语义主区域，并排除不可访问与导航内容', () => {
    const result = extractArticle(`<!doctype html><html><head><title>语义页面</title></head><body>
      <nav>${'导航噪声'.repeat(200)}</nav>
      <main role="main">
        <h1>语义 DOM 正文</h1>
        <div aria-hidden="true">不可访问的隐藏指令</div>
        <textarea readonly>${'应用页面中的可访问正文内容。'.repeat(80)}</textarea>
        <pre>const answer = 42;</pre>
      </main>
      <footer>${'页脚噪声'.repeat(100)}</footer>
    </body></html>`);

    expect(result.extractor).toBe('semantic_dom');
    expect(result.title).toBe('语义 DOM 正文');
    expect(result.text).toContain('应用页面中的可访问正文内容');
    expect(result.text).toContain('const answer = 42;');
    expect(result.text).not.toContain('不可访问的隐藏指令');
    expect(result.text).not.toContain('导航噪声');
    expect(result.text).not.toContain('页脚噪声');
  });

  it('Readability 修改 DOM 前保留无显式 head 的文档标题', () => {
    const result = extractArticle(`<!doctype html><html lang="en"><meta charset="utf-8">
      <title>Global objects | Node.js Documentation</title>
      <body class="apidoc"><div id="content">
        <div role="navigation">${'Navigation '.repeat(100)}</div>
        <div role="main" id="apicontent"><section><h2>Global objects</h2>
          <p>${'Official Node.js API documentation. '.repeat(80)}</p>
        </section></div>
      </div></body></html>`);

    expect(result.title).toBe('Global objects | Node.js Documentation');
    expect(result.text).toContain('Official Node.js API documentation');
  });

  it('按浏览器语义规范化提前关闭 html 与 head 后 style 的组合结构', async () => {
    const result = extractArticle(await readFixture('malformed-government-template.html'));

    expect(result).toMatchObject({
      extractor: 'readability',
      title: '浏览器可容错的政策正文',
      warnings: [],
    });
    expect(result.text).toContain('标准 HTML 解析器应当把提前关闭根元素之后的正文重新归入唯一的文档主体');
    expect(result.text).toContain('缓存身份、结构化日志和工具错误文本必须同步新抽取语义');
  });

  it('Readability 抛错时保留已经取得的语义正文', () => {
    const result = extractArticle(`<!doctype html><html><head><title>Semantic Recovery</title></head><body>
      <main><h1>语义正文恢复</h1><p>${'已经取得的语义正文不能被增强抽取器失败推翻。'.repeat(40)}</p></main>
    </body></html>`, {
      parseReadability() {
        throw new TypeError('third-party internal failure');
      },
    });

    expect(result.extractor).toBe('semantic_dom');
    expect(result.warnings).toContain('readability_failed');
    expect(result.text).toContain('已经取得的语义正文');
  });

  it('Readability 抛错且没有语义正文时返回稳定抽取错误', () => {
    expect(() => extractArticle(`<!doctype html><html><head><title>Extraction Failure</title></head><body>
      <div>${'普通正文容器。'.repeat(40)}</div>
    </body></html>`, {
      parseReadability() {
        throw new TypeError('Cannot read properties of null (reading tagName)');
      },
    })).toThrow(expect.objectContaining({
      kind: 'extraction_error',
      message: expect.stringContaining('[WEB_READ_EXTRACTION_FAILED]'),
      details: { extractionStage: 'readability' },
    }));
  });
});
