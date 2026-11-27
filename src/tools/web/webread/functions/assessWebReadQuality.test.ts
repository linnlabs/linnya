import { describe, expect, it } from 'vitest';
import { assessWebReadQuality } from './assessWebReadQuality';
import { createWebReadResult } from './createWebReadResult';
import { extractArticle } from '../extraction/extractArticle';

describe('assessWebReadQuality 短通知与正式附件放行合同', () => {
  it('完整短正式转文通知附带 document 正式附件时，在 local_http 合格返回而不触发 content_too_short 升级', () => {
    const html = `<!doctype html><html><head><title>关于印发实施方案的通知</title></head><body>
      <main>
        <h1>国家发展改革委等部门关于印发《“一老一小”服务体系建设实施方案》的通知</h1>
        <p>发改社会〔2026〕1623号</p>
        <p>各省、自治区、直辖市人民政府：《“一老一小”服务体系建设实施方案》已经国务院同意，现印发给你们，请认真贯彻执行。</p>
        <p>国家发展改革委 民政部 国家卫生健康委 教育部 2026年11月9日</p>
        <p><a href="https://www.ndrc.gov.cn/files/scheme.pdf">附件：实施方案.pdf</a></p>
      </main>
    </body></html>`;
    const extracted = extractArticle(html, { url: 'https://www.ndrc.gov.cn/notice.html' });
    const result = createWebReadResult({
      url: 'https://www.ndrc.gov.cn/notice.html',
      status: 200,
      contentType: 'text/html',
      title: extracted.title,
      content: extracted.text,
      contentFormat: 'markdown',
      extractor: extracted.extractor,
      renderMode: 'http',
      rawLength: html.length,
      warnings: extracted.warnings,
      resources: extracted.resources,
      latencyMs: 1,
    });
    expect(result.warnings).toContain('content_too_short');
    expect((result.resources ?? []).some((resource) => resource.kind === 'document')).toBe(true);
    expect(assessWebReadQuality(result)).toMatchObject({ shouldEscalate: false });
  });

  it('极短入口导语、超长 URL 伪装、无 document 附件页脚以及动态/屏障信号绝不绕过升级', () => {
    const shortLanding = createWebReadResult({
      url: 'https://entry.test/landing',
      status: 200,
      contentType: 'text/html',
      title: 'Report entry',
      content: 'Report entry\n\nA brief introduction. [Download report](https://entry.test/report.pdf)',
      contentFormat: 'markdown',
      extractor: 'readability',
      renderMode: 'http',
      rawLength: 300,
      warnings: ['content_too_short'],
      resources: [{ kind: 'document', url: 'https://entry.test/report.pdf', label: 'Download report' }],
      latencyMs: 0,
    });
    expect(assessWebReadQuality(shortLanding)).toMatchObject({ shouldEscalate: true, reason: 'content_too_short' });

    const longUrlDisguise = createWebReadResult({
      url: 'https://entry.test/disguise',
      status: 200,
      contentType: 'text/html',
      title: 'Link Only',
      content: `[Download PDF](https://entry.test/${'a'.repeat(500)}/file.pdf)`,
      contentFormat: 'markdown',
      extractor: 'semantic_dom',
      renderMode: 'http',
      rawLength: 800,
      warnings: ['content_too_short'],
      resources: [{ kind: 'document', url: 'https://entry.test/file.pdf' }],
      latencyMs: 0,
    });
    expect(assessWebReadQuality(longUrlDisguise)).toMatchObject({ shouldEscalate: true, reason: 'content_too_short' });

    const footerWithoutDocument = createWebReadResult({
      url: 'https://gov.test/list',
      status: 200,
      contentType: 'text/html',
      title: '公告列表',
      content: '主办单位：某监管机构 版权所有：某监管机构 网站识别码：bm000001 京ICP备05035542号 京公网安备11040102700080号 联系我们 法律声明 归档数据 请通过正式目录检索历年历史公告文档。',
      contentFormat: 'markdown',
      extractor: 'readability',
      renderMode: 'http',
      rawLength: 8000,
      warnings: ['content_too_short', 'low_text_ratio'],
      resources: [{ kind: 'source', url: 'https://gov.test/frame.html', label: 'list' }],
      latencyMs: 0,
    });
    expect(assessWebReadQuality(footerWithoutDocument)).toMatchObject({ shouldEscalate: true, reason: 'content_too_short' });

    const jsShellNotice = createWebReadResult({
      url: 'https://gov.test/shell-notice',
      status: 200,
      contentType: 'text/html',
      title: '通知',
      content: '各省、自治区、直辖市人民政府：请点击下方附件查阅完整正文内容，各部门于月底前按规范程序逐级报送年度执行进展与评估摘要材料。'.repeat(2),
      contentFormat: 'markdown',
      extractor: 'readability',
      renderMode: 'http',
      rawLength: 1000,
      warnings: ['content_too_short', 'js_shell'],
      resources: [{ kind: 'document', url: 'https://gov.test/file.pdf' }],
      latencyMs: 0,
    });
    expect(assessWebReadQuality(jsShellNotice)).toMatchObject({ shouldEscalate: true, reason: 'js_required' });

    const genericDownloadNavShell = createWebReadResult({
      url: 'https://finance.test/telegraph',
      status: 200,
      contentType: 'text/html',
      title: '电报',
      content: '### 全部\n\n### 加红\n\n### 公司\n\n### 看盘\n\n电报持续更新中 日期 加载更多 -.-- -.--(-.--%) 行业板块 概念板块 地域板块 板块名称 涨跌幅 资金流入 热门概念 实时资讯 财经日历 深度研报 自选行情 资讯频道 客户端下载',
      contentFormat: 'markdown',
      extractor: 'readability',
      renderMode: 'http',
      rawLength: 17000,
      warnings: ['content_too_short', 'low_text_ratio'],
      resources: [{ kind: 'document', url: 'https://finance.test/download', label: '下载' }],
      latencyMs: 0,
    });
    expect(assessWebReadQuality(genericDownloadNavShell)).toMatchObject({
      shouldEscalate: true,
      reason: 'content_too_short',
    });

    const fragmentOnlyWithPdf = createWebReadResult({
      url: 'https://gov.test/nav-fragments',
      status: 200,
      contentType: 'text/html',
      title: '公告栏目',
      content: '首页 政务公开 政策文件 通知公告 部门规章 规划计划 统计数据 政策解读 互动交流 监督检查 行政许可 办事指南 联系我们 网站地图 使用帮助 附件下载',
      contentFormat: 'markdown',
      extractor: 'readability',
      renderMode: 'http',
      rawLength: 4000,
      warnings: ['content_too_short'],
      resources: [{ kind: 'document', url: 'https://gov.test/files/notice.pdf', label: '附件.pdf' }],
      latencyMs: 0,
    });
    expect(assessWebReadQuality(fragmentOnlyWithPdf)).toMatchObject({
      shouldEscalate: true,
      reason: 'content_too_short',
    });
  });
});
