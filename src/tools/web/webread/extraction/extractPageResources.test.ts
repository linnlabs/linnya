import { describe, expect, it } from 'vitest';
import { extractArticle } from './extractArticle';

describe('landing page 资源提取', () => {
  it('在正文清理前保留 DOI、全文链接和正式来源', () => {
    const result = extractArticle(`<!doctype html><html><head>
      <meta name="citation_pdf_url" content="/files/report.pdf">
      <meta name="citation_doi" content="https://doi.org/10.1234/example">
      </head><body><nav><a href="/menu">Menu</a></nav>
      <main><h1>Report landing page</h1><p>${'Abstract text. '.repeat(30)}</p>
      <a class="fulltext-link" href="/download/report.pdf">View Technical Report</a>
      <a href="https://repository.example/paper">Official repository</a>
      <a href="https://www.linkedin.com/shareArticle?source=page">LinkedIn</a>
      <a href="javascript:alert(1)">Unsafe download</a>
      </main></body></html>`, { url: 'https://example.com/publication/1' });

    expect(result.resources).toEqual([
      { kind: 'document', url: 'https://example.com/files/report.pdf', label: '/files/report.pdf' },
      { kind: 'doi', url: 'https://doi.org/10.1234/example', label: 'https://doi.org/10.1234/example' },
      { kind: 'document', url: 'https://example.com/download/report.pdf', label: 'View Technical Report' },
      { kind: 'source', url: 'https://repository.example/paper', label: 'Official repository' },
    ]);
    expect(result.text).toContain('Unsafe download');
    expect(result.text).not.toContain('javascript:');
  });

  it('不把普通导航和任意页面链接提升为资源', () => {
    const result = extractArticle(`<html><body><article><h1>Article</h1>
      <p>${'Long article text. '.repeat(30)}</p>
      <a href="/about">About this site</a><a href="/search?q=report">Search</a>
    </article></body></html>`, { url: 'https://example.com/article' });

    expect(result.resources).toEqual([]);
  });

  it('读取 schema.org 中的 DOI、全文地址和正式来源', () => {
    const result = extractArticle(`<html><head><script type="application/ld+json">${JSON.stringify({
      '@type': 'Report',
      identifier: '10.1234/schema-report',
      encoding: { contentUrl: 'https://example.com/report.pdf' },
      sameAs: ['https://repository.example/report'],
    })}</script></head><body><article><h1>Report</h1>
      <p>${'Report abstract. '.repeat(30)}</p>
    </article></body></html>`, { url: 'https://example.com/report' });

    expect(result.resources).toEqual([
      { kind: 'doi', url: 'https://doi.org/10.1234/schema-report', label: '10.1234/schema-report' },
      { kind: 'document', url: 'https://example.com/report.pdf', label: 'https://example.com/report.pdf' },
      { kind: 'source', url: 'https://repository.example/report', label: 'https://repository.example/report' },
    ]);
  });
});
