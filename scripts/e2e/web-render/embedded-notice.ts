import assert from 'node:assert/strict';
import type { ServerResponse } from 'node:http';
import { load } from 'cheerio';
import { readWebPageWithLadder } from '../../../src/tools/web/webread/orchestration/readLadder';
import type { WebReadProvider } from '../../../src/tools/web/webread/providers/types';

const inlineNotice = `<base href='../files/'><article><h2>INLINE BULLETIN</h2>
  <div role='grid' aria-colcount='3'>
    <div role='row'><b role='columnheader'>项目</b><b role='columnheader'>预算</b><b role='columnheader'>决算</b></div>
    <div role='row'><b role='cell'>年度支出</b><b role='cell' aria-colindex='3'>420</b></div></div>
  <a href='report.pdf'>正式附件</a><script>/* INTERNAL_SCRIPT_ONLY */</script></article>`;

export function serveEmbeddedNotice(route: string, response: ServerResponse): boolean {
  let body: string;
  if (route === '/embedded-notice') {
    body = `<base href='/agency/bulletins/'><main><p>${'公开的通知导语与办事说明。'.repeat(72)}</p>
      <iframe srcdoc="${inlineNotice}"></iframe>
      <iframe srcdoc="<p>SECOND INLINE NOTICE</p>"></iframe>
      <iframe sandbox srcdoc="<p>OPAQUE FRAME CONTENT</p>"></iframe>
      <iframe src='/comment-login'></iframe></main>`;
  } else if (route === '/account-frame-wall') {
    body = `<main><p>${'公开的文章预览。'.repeat(90)}</p></main><div style="position:fixed;inset:0">
      <iframe style="width:100%;height:100%" src='/comment-login'></iframe></div>`;
  } else if (route === '/comment-login') {
    body = '<main><p>请先登录后查看账户信息</p><input type="password"><p>ACCOUNT ONLY</p></main>';
  } else if (route === '/account-frame-only') {
    body = '<main><iframe src="/comment-login"></iframe></main>';
  } else {
    return false;
  }
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  response.end(`<!doctype html><html><head><title>公开公告</title></head><body>${body}</body></html>`);
  return true;
}

export async function verifyEmbeddedNotice(origin: string, provider: WebReadProvider, renderProvider: WebReadProvider): Promise<void> {
  const { readResult, selectedProvider } = await readWebPageWithLadder({ url: `${origin}/embedded-notice` }, {
    provider, renderProvider, managedProvider: null,
  });
  assert.equal(selectedProvider, 'local_render');
  assert.match(readResult.content, /公开的通知导语/);
  assert.ok(readResult.warnings.includes('embedded_frame_blocked'));
  assert.match(readResult.content, /INLINE BULLETIN/);
  assert.match(readResult.content, /SECOND INLINE NOTICE/);
  assert.doesNotMatch(readResult.content, /INTERNAL_SCRIPT_ONLY|ACCOUNT ONLY|OPAQUE FRAME CONTENT/);
  const dom = load(readResult.content);
  assert.deepEqual(dom('tbody tr').last().children().map((_, cell) => dom(cell).text()).get(), ['年度支出', '（未呈现）', '420']);
  assert.ok(readResult.resources?.some(resource => resource.url === `${origin}/agency/files/report.pdf`));
  assert.ok(!readResult.resources?.some(resource => resource.url.includes('about:srcdoc')));
  for (const path of ['/comment-login', '/account-frame-only', '/account-frame-wall']) {
    await assert.rejects(renderProvider.read({ url: `${origin}${path}` }), { kind: 'login_required' });
  }
}
