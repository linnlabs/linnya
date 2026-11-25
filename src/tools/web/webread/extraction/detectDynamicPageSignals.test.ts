import { describe, expect, it } from 'vitest';
import { extractArticle } from './extractArticle';
import { assessWebReadQuality } from '../functions/assessWebReadQuality';
import { createWebReadResult } from '../functions/createWebReadResult';

function assessHttpHtml(url: string, html: string) {
  const extracted = extractArticle(html, { url });
  const result = createWebReadResult({
    url,
    finalUrl: url,
    status: 200,
    contentType: 'text/html; charset=utf-8',
    title: extracted.title || 'Fixture',
    content: extracted.text,
    contentFormat: 'markdown',
    extractor: extracted.extractor,
    renderMode: 'http',
    provider: 'local_http',
    rawLength: html.length,
    qualityScore: extracted.qualityScore,
    warnings: extracted.warnings,
    resources: extracted.resources,
    latencyMs: 1,
  });
  return { extracted, quality: assessWebReadQuality(result) };
}

describe('Phase 1B 动态页面升级信号与资源提取', () => {
  it('同源内容 iframe 记为正式资源并越过 metadata_only 升级，同站跨源 iframe 仅交付链接', () => {
    const sameOriginHtml = `<!doctype html><html><head><title>政务公告壳</title></head><body>
      <header><nav>政务公开 <a href="/home">首页</a></nav></header>
      <main>
        <iframe src="/sub/bulletin-body.html" title="公告正文框" width="900" height="600"></iframe>
        <iframe src="https://tracker.other.test/pixel" width="1" height="1"></iframe>
        <iframe src="https://ads.thirdparty.test/banner" width="300" height="250"></iframe>
        <nav><iframe src="/nav-frame.html" width="200" height="100"></iframe></nav>
        <div style="display: none"><iframe src="/hidden-frame.html" width="400" height="400"></iframe></div>
      </main></body></html>`;
    const sameOrigin = assessHttpHtml('https://www.gov.example.test/notices/index.html', sameOriginHtml);
    expect(sameOrigin.extracted.resources).toEqual([
      { kind: 'source', url: 'https://www.gov.example.test/sub/bulletin-body.html', label: '公告正文框' },
    ]);
    expect(sameOrigin.extracted.warnings).toContain('metadata_only');
    expect(sameOrigin.extracted.warnings).toContain('embedded_same_origin_iframe');
    expect(sameOrigin.quality).toMatchObject({ shouldEscalate: true, reason: 'js_required' });

    const crossOriginSameSiteHtml = `<!doctype html><html><head><title>跨子域嵌框</title></head><body>
      <main><iframe src="https://bulletin.gov.example.test/detail/2026.html" title="子域正文"></iframe></main>
    </body></html>`;
    const crossOriginSameSite = assessHttpHtml('https://www.gov.example.test/portal.html', crossOriginSameSiteHtml);
    expect(crossOriginSameSite.extracted.resources).toEqual([
      { kind: 'source', url: 'https://bulletin.gov.example.test/detail/2026.html', label: '子域正文' },
    ]);
    expect(crossOriginSameSite.extracted.warnings).toContain('metadata_only');
    expect(crossOriginSameSite.extracted.warnings).not.toContain('embedded_same_origin_iframe');
    expect(crossOriginSameSite.quality).toMatchObject({ shouldEscalate: false });
  });

  it('主区内内联隐藏的长正文容器产出 hidden_main_content 信号，绝不直接保留隐藏文本，且不误伤已展开折叠正文', () => {
    const hiddenParagraph = 'This article body is hidden inline until script execution finishes. '.repeat(12);
    const hiddenHtml = `<!doctype html><html><head><title>隐藏正文页</title></head><body>
      <main>
        <h1>Article Title</h1>
        <div id="js_content" style="visibility: hidden"><p>${hiddenParagraph}</p></div>
        <a href="/attachment.pdf">下载原文附件</a>
      </main></body></html>`;
    const hidden = assessHttpHtml('https://mp.example.test/s/article1', hiddenHtml);
    expect(hidden.extracted.text).not.toContain('hidden inline until script');
    expect(hidden.extracted.warnings).toContain('hidden_main_content');
    expect(hidden.quality).toMatchObject({ shouldEscalate: true, reason: 'js_required' });

    const disclosureBody = 'Confirmed disclosure text that users can legitimately expand and read. '.repeat(15);
    const disclosureHtml = `<!doctype html><html><head><title>折叠正文页</title></head><body><article>
      <h1>Disclosure Report</h1><p>${disclosureBody}</p>
      <button aria-expanded="false" aria-controls="more-details">展开阅读</button>
      <section id="more-details" hidden style="display: none"><p>${disclosureBody}</p></section>
      <p style="display: none">HIDDEN_OLD_REVISION_DO_NOT_ADMIT</p>
    </article></body></html>`;
    const disclosed = assessHttpHtml('https://example.test/disclosure', disclosureHtml);
    expect(disclosed.extracted.text).toContain('Confirmed disclosure text');
    expect(disclosed.extracted.text).not.toContain('HIDDEN_OLD_REVISION_DO_NOT_ADMIT');
    expect(disclosed.extracted.warnings).not.toContain('hidden_main_content');
    expect(disclosed.quality).toMatchObject({ shouldEscalate: false });
  });

  it('JSON-LD articleBody 只作升级信号，绝不写入正文；空挂载节点与 aria-busy 触发 dynamic_content_pending', () => {
    const secretIndexOnlyText = 'INDEX_ONLY_ARTICLE_BODY_NEVER_ADMIT_TO_EVIDENCE '.repeat(25);
    const jsonLdHtml = `<!doctype html><html><head><title>需登录全文元数据页</title>
      <script type="application/ld+json">${JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'NewsArticle',
        headline: 'Subscriber Report',
        articleBody: secretIndexOnlyText,
      })}</script></head>
      <body><article><h1>Subscriber Report</h1><p>Short public lead paragraph.</p></article></body></html>`;
    const jsonLdOnly = assessHttpHtml('https://news.example.test/paywall-preview', jsonLdHtml);
    expect(jsonLdOnly.extracted.text).not.toContain('INDEX_ONLY_ARTICLE_BODY_NEVER_ADMIT_TO_EVIDENCE');
    expect(jsonLdOnly.extracted.excerpt ?? '').not.toContain('INDEX_ONLY_ARTICLE_BODY');
    expect(jsonLdOnly.extracted.warnings).toContain('dynamic_content_pending');
    expect(jsonLdOnly.quality).toMatchObject({ shouldEscalate: true, reason: 'js_required' });

    const busyShellHtml = `<!doctype html><html><head><title>慢水合半静态壳</title></head><body>
      <header><div>本站由公共服务平台提供技术支持与备案信息查询入口。</div></header>
      <main><div aria-busy="true">Loading...</div><div id="app"></div></main>
      <p>${'公共导航说明与免责声明摘要文字，超过两百字但主区尚未挂载正文。'.repeat(6)}</p>
      <script src="/a.js"></script><script src="/b.js"></script><script src="/c.js"></script>
    </body></html>`;
    const busyShell = assessHttpHtml('https://spa.example.test/app-shell', busyShellHtml);
    expect(busyShell.extracted.warnings).toContain('dynamic_content_pending');
    expect(busyShell.quality).toMatchObject({ shouldEscalate: true, reason: 'js_required' });

    const longStaticText = 'Complete static article body already rendered on server with full facts. '.repeat(25);
    const normalStaticWithWidget = `<!doctype html><html><head><title>正常静态页</title></head><body>
      <article><h1>Static Article</h1><p>${longStaticText}</p></article>
      <div id="app"></div>
      <script src="/a.js"></script><script src="/b.js"></script><script src="/c.js"></script>
    </body></html>`;
    const normalStatic = assessHttpHtml('https://blog.example.test/static', normalStaticWithWidget);
    expect(normalStatic.extracted.warnings).not.toContain('dynamic_content_pending');
    expect(normalStatic.quality).toMatchObject({ shouldEscalate: false });
  });
});
