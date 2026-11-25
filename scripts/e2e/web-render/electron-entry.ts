import { app } from 'electron';
import { createServer } from 'node:http';
import { WebPageRenderManager } from '../../../src/electron-main/web-render/WebPageRenderManager';
import { WebPageRenderWorker } from '../../../src/electron-main/web-render/WebPageRenderWorker';
import { createElectronWebPageRenderRuntime } from '../../../src/electron-main/web-render/electronWebPageRenderRuntime';
import { LocalRenderProvider } from '../../../src/tools/web/webread/providers/localRender';
import { LocalHttpProvider } from '../../../src/tools/web/webread/providers/localHttp';
import { readWebPageWithLadder } from '../../../src/tools/web/webread/orchestration/readLadder';
import { runReadWebPage } from '../../../src/tools/web/webread/orchestration/readWebPage';
import { MemoryWebCache } from '../../../src/tools/web/shared/cache/adapters/memoryWebCache';
import { createWebCacheRuntime } from '../../../src/tools/web/shared/cache/webCacheFactory';
import type { WebEvidenceCaptureItem } from '../../../src/tools/web/shared/definitions/webEvidenceCapture';
import { attachCitationRefAllocator, attachCitationSequence } from '../../../src/domains/citation';
import { createCitationRefAllocatorFixture } from '../../../src/domains/citation/testkit/citationRefAllocatorFixture';
import type { ToolContext } from '../../../src/tools/types';
import { WebFailureError, getWebFailureDiagnostics } from '../../../src/tools/web/shared/webFailure';
import { buildWebReadFailureFeedback } from '../../../src/tools/web/webread/functions/buildWebReadFailureFeedback';

interface FixtureState {
  popupRequests: number;
  downloadRequests: number;
  challengeExecutionRequests: number;
  heavyResourceRequests: number;
}

function readFailure(error: unknown): { kind: string; status?: number; headers?: unknown } {
  if (!error || typeof error !== 'object') return { kind: '' };
  const mainResponse: unknown = Reflect.get(error, 'mainResponse');
  return {
    kind: String(Reflect.get(error, 'kind') ?? ''),
    ...(mainResponse && typeof mainResponse === 'object'
      ? { status: Number(Reflect.get(mainResponse, 'status')), headers: Reflect.get(mainResponse, 'headers') }
      : {}),
  };
}

function readSubresourceFailures(error: unknown): { count: number; sampleError: string } {
  const failures: unknown = error && typeof error === 'object' ? Reflect.get(error, 'subresourceFailures') : undefined;
  if (!failures || typeof failures !== 'object') return { count: 0, sampleError: '' };
  return {
    count: Number(Reflect.get(failures, 'count') ?? 0),
    sampleError: String(Reflect.get(failures, 'sampleError') ?? ''),
  };
}

function listen(server: ReturnType<typeof createServer>): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('渲染 fixture 未返回端口。');
      resolve(address.port);
    });
  });
}

function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  server.closeAllConnections();
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

async function run(): Promise<void> {
  const state: FixtureState = {
    popupRequests: 0,
    downloadRequests: 0,
    challengeExecutionRequests: 0,
    heavyResourceRequests: 0,
  };
  let port = 0;
  const server = createServer((request, response) => {
    const route = request.url ?? '/';
    if (route === '/redirect-same') {
      response.writeHead(302, { Location: '/spa' });
      response.end();
      return;
    }
    if (route === '/redirect-cross') {
      response.writeHead(302, { Location: `http://localhost:${port}/spa` });
      response.end();
      return;
    }
    if (route === '/redirect-external') {
      response.writeHead(302, { Location: `http://other-site.test:${port}/spa` });
      response.end();
      return;
    }
    if (route === '/redirect-to-script-escape') {
      response.writeHead(302, { Location: `http://other-site.test:${port}/escape-to-third` });
      response.end();
      return;
    }
    if (route === '/redirect-denied-dns') {
      response.writeHead(302, { Location: `http://blocked-by-dns.test:${port}/spa` });
      response.end();
      return;
    }
    if (route === '/escape-to-third') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(`<!doctype html><html><body><div id="app">Redirecting</div><script>
        setTimeout(() => {
          window.location.href = 'http://third-site.test:${port}/static';
        }, 10);
      </script></body></html>`);
      return;
    }
    if (route === '/hidden-reveal') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(`<!doctype html><html><head><title>Hidden Reveal</title></head><body><main>
        <h1>Hidden Container</h1>
        <div id="js_content" style="visibility: hidden">PENDING</div>
        <script>setTimeout(() => {
          const el = document.querySelector('#js_content');
          el.textContent = ${JSON.stringify('REVEALED MAIN BODY '.repeat(35))};
          el.style.visibility = 'visible';
        }, 30);</script></main></body></html>`);
      return;
    }
    if (route === '/redirect-site') {
      response.writeHead(302, { Location: `http://web-render.test:${port}/spa` });
      response.end();
      return;
    }
    if (route === '/popup') {
      state.popupRequests += 1;
      response.end('popup must stay blocked');
      return;
    }
    if (route === '/download') {
      state.downloadRequests += 1;
      response.writeHead(200, {
        'Content-Disposition': 'attachment; filename="blocked.txt"',
        'Content-Type': 'text/plain',
      });
      response.end('download must be cancelled');
      return;
    }
    if (route === '/challenge-script-executed' || route === '/challenge-subresource') {
      state.challengeExecutionRequests += 1;
      response.end('challenge page must not run');
      return;
    }
    if (route === '/aws-challenge' || route === '/cf-challenge') {
      const aws = route === '/aws-challenge';
      response.writeHead(aws ? 202 : 403, {
        'Content-Type': 'text/html; charset=utf-8',
        ...(aws ? { 'x-amzn-waf-action': 'challenge' } : { 'cf-mitigated': 'challenge' }),
      });
      response.end(`<!doctype html><html><body><div id="challenge-container"></div>
        <img src="/challenge-subresource"><script>fetch('/challenge-script-executed');</script>
        </body></html>`);
      return;
    }
    if (route === '/data-delayed') {
      setTimeout(() => {
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ text: 'DELAYED_XHR_CONTENT' }));
      }, 1_500);
      return;
    }
    if (route === '/data-empty') {
      response.setHeader('Content-Type', 'application/json');
      response.end('{}');
      return;
    }
    if (route === '/data-hang' || route === '/hang-style.css') {
      // 故意不结束响应：模拟永不完成的数据请求或拖住 load 事件的样式表。
      return;
    }
    if (
      route === '/hang-image'
      || route === '/blocked-hero.jpg'
      || route === '/blocked-hero-csp.jpg'
      || route === '/blocked.mp4'
      || route === '/blocked.woff2'
    ) {
      state.heavyResourceRequests += 1;
      response.writeHead(404);
      response.end();
      return;
    }
    if (route === '/data-slow-3200') {
      setTimeout(() => {
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({ text: 'SLOW HYDRATED ARTICLE '.repeat(45) }));
      }, 3_200);
      return;
    }
    if (route === '/spa-hash') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(`<!doctype html><html><head><title>政务发布大厅</title></head><body>
        <nav>首页 | 政务公开 | 政策解读</nav>
        <main><div id="app">Loading...</div></main>
        <script>window.__a=1;</script><script>window.__b=2;</script>
        <script>
          function renderRoute() {
            var h = location.hash || '';
            var el = document.getElementById('app');
            if (h.indexOf('/notice/b') >= 0) {
              el.innerHTML = '<h1>关于财政预算调整的通知</h1><p>NOTICE B FISCAL CIRCULAR 2026-02。' + '财政公告B正文详情。'.repeat(25) + '</p>';
            } else {
              el.innerHTML = '<h1>关于人事任免的通知</h1><p>NOTICE A PERSONNEL 2026-01。' + '人事公告A正文详情。'.repeat(25) + '</p>';
            }
          }
          renderRoute();
        </script></body></html>`);
      return;
    }
    if (route === '/anchor-article') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(`<!doctype html><html><head><title>普通文章</title></head><body><article>
        <h1>普通锚点文章标题</h1>
        <p>${'普通静态文章正文段落内容。'.repeat(40)}</p>
      </article></body></html>`);
      return;
    }
    if (route === '/disclosures-ok') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(`<!doctype html><html><head><title>折叠正文与遮罩对照</title>
        <style>.stale-css { display: none; } .panel-collapsed { display: none; }</style>
      </head><body><main>
        <h1>公开详情</h1>
        <button aria-expanded="false" aria-controls="sec-a">展开第一部分</button>
        <div id="sec-a" class="panel-collapsed">
          <p>${'EXPANDED ARIA BODY ITEM '.repeat(20)}</p>
          <div hidden>NESTED HIDDEN SECRET</div>
          <span class="stale-css">STALE CSS SECRET</span>
        </div>
        <button class="read-more-btn">阅读更多</button>
        <div class="read-more-panel" style="display: none">${'READ MORE EXPANDED BODY '.repeat(18)}</div>
        <details><summary>展开细节</summary><p>${'DETAILS BODY TEXT '.repeat(18)}</p></details>
      </main></body></html>`);
      return;
    }
    if (route === '/login-mask') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(`<!doctype html><html><head><title>会员专享</title></head><body>
        <article><h1>会员报告</h1><p>${'页面背后被遮挡的预览占位段落。'.repeat(30)}</p></article>
        <div role="dialog" aria-modal="true" style="position: fixed; inset: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7);">
          <p>请先登录后查看完整正文</p>
          <input type="password" placeholder="密码">
        </div>
      </body></html>`);
      return;
    }
    if (route === '/jsonld-empty-body') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(`<!doctype html><html><head><title>Empty Shell</title>
        <script type="application/ld+json">${JSON.stringify({
          headline: 'JsonLd Headline',
          articleBody: 'JSONLD NEVER EVIDENCE '.repeat(35),
        })}</script>
      </head><body><main><p>Please subscribe.</p></main></body></html>`);
      return;
    }
    if (route === '/gov-iframe-shell') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(`<!doctype html><html><head><title>政务公文系统</title></head><body>
        <nav>政务公开 | 政策文件 | 办事指南</nav>
        <main><iframe src="/sub/bulletin.html" title="公文正文"></iframe></main>
      </body></html>`);
      return;
    }
    if (route === '/sub/bulletin.html') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(`<!doctype html><html><head><title>关于印发试点方案的通知</title></head><body>
        <article>
          <h1>关于印发试点方案的通知</h1>
          <p>发文字号：国办发〔2026〕12号。${'同源政务公告正文内容详情。'.repeat(25)}</p>
          <table>
            <tr><th>部门</th><th colspan="2">预算详情</th></tr>
            <tr><td rowspan="2">财政厅</td><td>项目A</td><td>580万元</td></tr>
            <tr><td>项目B</td><td>420万元</td></tr>
          </table>
          <a href="../files/attach.pdf">下载正式附件 PDF</a>
        </article>
      </body></html>`);
      return;
    }
    if (route === '/gov-attach-dir') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(`<!doctype html><html><head><title>附件下载目录</title></head><body>
        <main><a href="/files/circular.pdf" title="下载规范性文件附件"></a></main>
      </body></html>`);
      return;
    }
    if (route === '/gov-cross-origin-iframe') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(`<!doctype html><html><head><title>跨源政务引用页</title></head><body>
        <main><iframe src="http://docs.web-render.test:${port}/frame-notice.html" title="跨源附件框架"></iframe></main>
      </body></html>`);
      return;
    }
    if (route === '/shadow-and-css') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(`<!doctype html><html><head><title>Shadow DOM与样式剪枝</title>
        <style>
          .cookie-overlay { position: fixed; bottom: 0; left: 0; right: 0; padding: 12px; }
          .tab-hidden { display: none; }
          .scroll-fade { opacity: 0; }
        </style>
      </head><body>
        <div class="cookie-overlay">COOKIE BANNER NOISE 同意并使用 Cookie</div>
        <main>
          <x-doc id="doc">
            <p slot="summary">${'SHADOW SUMMARY ONCE '.repeat(12)}</p>
            <p>${'SHADOW DEFAULT ONCE '.repeat(12)}</p>
            <span slot="unused">UNSLOTTED SECRET</span>
          </x-doc>
          <div class="tab-hidden">INACTIVE TAB NOISE</div>
          <div class="scroll-fade"><p>${'SCROLL FADE KEEP '.repeat(12)}</p></div>
        </main>
        <script>
          const host = document.getElementById('doc');
          const root = host.attachShadow({ mode: 'open' });
          root.innerHTML = '<div class="card"><h1>Shadow Doc</h1><slot name="summary"></slot><slot></slot></div>';
        </script>
      </body></html>`);
      return;
    }
    if (route === '/slow-hydration') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(`<!doctype html><html><head><title>慢水合页面</title></head><body>
        <nav>${'全站顶部导航菜单项目 '.repeat(40)}</nav>
        <main></main>
        <script>window.__boot=1;</script><script>window.__boot2=2;</script>
        <script>
          fetch('/data-slow-3200').then(r => r.json()).then(d => {
            document.querySelector('main').innerHTML = '<article><h1>慢水合正文</h1><p>' + d.text + '</p></article>';
          });
        </script>
      </body></html>`);
      return;
    }
    if (route === '/polling-ticker') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(`<!doctype html><html><head><title>轮询与行情跳动页</title></head><body>
        <main>
          <h1>实质主区正文</h1>
          <p>${'POLLING MAIN STABLE CONTENT '.repeat(36)}</p>
          <p>指数：<span id="ticker">100.0</span></p>
        </main>
        <script>window.__p1=1;</script><script>window.__p2=2;</script>
        <script>
          let n = 0;
          setInterval(() => {
            n += 1;
            document.getElementById('ticker').textContent = (100 + (n % 9)).toFixed(2);
          }, 120);
          setInterval(() => { fetch('/data-empty').catch(() => {}); }, 300);
        </script>
      </body></html>`);
      return;
    }
    if (route === '/lazy-3screens') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(`<!doctype html><html><head><title>三屏懒加载列表</title></head><body>
        <main>
          <section style="min-height: 1200px"><h1>第1屏内容</h1><p>${'SCREEN ONE ITEM '.repeat(25)}</p></section>
          <section id="s2" style="min-height: 900px"></section>
          <section id="s3" style="min-height: 400px"></section>
        </main>
        <script>
          let stage = 0;
          window.addEventListener('scroll', () => {
            if (stage === 0 && window.scrollY > 200) {
              stage = 1;
              document.getElementById('s2').innerHTML = '<h2>第2屏内容</h2><p>' + 'SCREEN TWO DATA '.repeat(20) + '</p>';
            } else if (stage === 1 && window.scrollY > 900) {
              stage = 2;
              document.getElementById('s3').innerHTML = '<h2>第3屏内容</h2><p>' + 'SCREEN THREE DATA '.repeat(20) + '</p>';
            }
          });
        </script>
      </body></html>`);
      return;
    }
    if (route === '/infinite-append') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(`<!doctype html><html><head><title>无限追加列表</title></head><body>
        <main id="feed">
          <div style="min-height: 1500px"><h1>起始列表</h1><p>${'INFINITE HEAD ITEM '.repeat(35)}</p></div>
        </main>
        <script>
          let batch = 0;
          window.addEventListener('scroll', () => {
            batch += 1;
            const d = document.createElement('div');
            d.style.minHeight = '950px';
            d.innerHTML = '<p>INFINITE BATCH NO ' + batch + ' ' + '追加条目内容。'.repeat(12) + '</p>';
            document.getElementById('feed').appendChild(d);
          });
        </script>
      </body></html>`);
      return;
    }
    if (route === '/heavy-onerror' || route === '/heavy-onerror-csp') {
      if (route === '/heavy-onerror-csp') {
        response.setHeader('Content-Security-Policy', "img-src 'self'");
      }
      const imgPath = route === '/heavy-onerror-csp' ? '/blocked-hero-csp.jpg' : '/blocked-hero.jpg';
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(`<!doctype html><html><head><title>重资源拦截与图候选保护</title>
        <style>@font-face { font-family: TestF; src: url('/blocked.woff2'); } body { font-family: TestF, sans-serif; }</style>
      </head><body><main>
        <article>
          <h1>含图表与媒体文章</h1>
          <p>${'重资源拦截下主文档正文与图片候选保持完整。'.repeat(25)}</p>
          <figure>
            <img src="${imgPath}" width="800" height="600" alt="Hero Chart" onerror="this.remove()">
            <figcaption>Hero Chart Caption</figcaption>
          </figure>
          <video src="/blocked.mp4"></video>
        </article>
      </main></body></html>`);
      return;
    }
    if (route === '/app-delayed' || route === '/app-hanging-data' || route === '/app-settled-blank') {
      const dataRoute = route === '/app-delayed' ? '/data-delayed'
        : route === '/app-hanging-data' ? '/data-hang' : '/data-empty';
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(`<!doctype html><html><body><div id="app">Loading</div>
        <script>window.__boot = 1;</script><script>window.__config = {};</script>
        <script>
          fetch('${dataRoute}').then((reply) => reply.json()).then((data) => {
            if (data.text) document.querySelector('#app').textContent = data.text.repeat(30);
          });
        </script></body></html>`);
      return;
    }
    if (route === '/broken-script.js' || route === '/broken-data') {
      // 直接断开连接：模拟脚本或正文数据下载在传输层失败。
      request.socket.destroy();
      return;
    }
    if (route === '/app-broken-data') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(`<!doctype html><html><body><div id="app">Loading</div>
        <script>window.__boot = 1;</script><script>window.__config = {};</script>
        <script>
          fetch('/broken-data').catch(() => {});
          const request = new XMLHttpRequest();
          request.open('GET', '/broken-data');
          request.send();
        </script></body></html>`);
      return;
    }
    if (route === '/app-broken-script') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(`<!doctype html><html><body><div id="app">Loading</div>
        <script>window.__boot = 1;</script><script>window.__config = {};</script>
        <script src="/broken-script.js"></script></body></html>`);
      return;
    }
    if (route === '/hanging-load') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end(`<!doctype html><html><head><link rel="stylesheet" href="/hang-style.css"></head><body><article>${'HANGING_LOAD_CONTENT '.repeat(20)}</article>
        <img src="/hang-image"></body></html>`);
      return;
    }
    if (route === '/empty-static') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end('<!doctype html><html><body></body></html>');
      return;
    }
    if (route === '/accepted') {
      response.writeHead(202, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><html><body>accepted fixture</body></html>');
      return;
    }
    if (route === '/forbidden-long') {
      response.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(`<!doctype html><html><head><title>403 Forbidden</title></head><body><article><h1>Access Denied</h1><p>${'Forbidden gateway error page details. '.repeat(40)}</p></article></body></html>`);
      return;
    }
    if (route === '/static') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.end('<!doctype html><html><body>static fixture</body></html>');
      return;
    }
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.end(`<!doctype html>
      <html><body><div id="app"></div><script>
        setTimeout(async () => {
          document.querySelector('#app').textContent = 'SPA_RENDERED_CONTENT';
          window.open('/popup');
          const link = document.createElement('a');
          link.href = '/download';
          link.download = 'blocked.txt';
          document.body.appendChild(link);
          link.click();
          if (typeof Notification !== 'undefined') {
            document.body.dataset.permission = await Notification.requestPermission();
          }
        }, 30);
      </script></body></html>`);
  });

  port = await listen(server);
  const origin = `http://www.web-render.test:${port}`;
  const fixtureRuntime = createElectronWebPageRenderRuntime({
    validateRequestUrl: async () => undefined,
  });
  const worker = new WebPageRenderWorker({
    runtime: fixtureRuntime,
    partition: `web-render:e2e-${process.pid}`,
    settleDelayMs: 250,
    loadTimeoutMs: 2_000,
    renderTimeoutMs: 2_000,
    totalTimeoutMs: 5_000,
  });
  try {
    const spa = await worker.render({ url: `${origin}/spa` });
    const redirected = await worker.render({ url: `${origin}/redirect-same` });
    const siteRedirected = await worker.render({ url: `${origin}/redirect-site` });
    const timeoutWorker = new WebPageRenderWorker({
      runtime: fixtureRuntime,
      partition: `web-render:e2e-timeout-${process.pid}`,
      settleDelayMs: 1_000,
      loadTimeoutMs: 2_000,
      renderTimeoutMs: 2_000,
      totalTimeoutMs: 100,
    });
    let timeoutKind = '';
    try {
      await timeoutWorker.render({ url: `${origin}/static` });
    } catch (error: unknown) {
      timeoutKind = error && typeof error === 'object'
        ? String(Reflect.get(error, 'kind') ?? '')
        : '';
    } finally {
      await timeoutWorker.dispose();
    }

    const restrictedWorker = new WebPageRenderWorker({
      partition: `web-render:e2e-private-network-${process.pid}`,
      settleDelayMs: 0,
      loadTimeoutMs: 2_000,
      renderTimeoutMs: 2_000,
      totalTimeoutMs: 3_000,
    });
    let privateNetworkKind = '';
    let privateNetworkErrorCode: unknown;
    try {
      await restrictedWorker.render({ url: `http://127.0.0.1:${port}/static` });
    } catch (error: unknown) {
      privateNetworkKind = error && typeof error === 'object'
        ? String(Reflect.get(error, 'kind') ?? '')
        : '';
      privateNetworkErrorCode = error && typeof error === 'object' ? Reflect.get(error, 'netErrorCode') : undefined;
    } finally {
      await restrictedWorker.dispose();
    }

    let crossRedirectKind = '';
    try {
      await worker.render({ url: `${origin}/redirect-cross` });
    } catch (error: unknown) {
      crossRedirectKind = error && typeof error === 'object'
        ? String(Reflect.get(error, 'kind') ?? '')
        : '';
    }
    const recovered = await worker.render({ url: `${origin}/static` });
    const awsChallenge = await worker.render({ url: `${origin}/aws-challenge` })
      .then(() => ({ kind: 'rendered' }), readFailure);
    const cloudflareChallenge = await worker.render({ url: `${origin}/cf-challenge` })
      .then(() => ({ kind: 'rendered' }), readFailure);
    // 给已被取消的挑战页留出执行窗口；若脚本或子资源实际运行，这里会观察到请求。
    await new Promise((resolve) => setTimeout(resolve, 300));
    const accepted = await worker.render({ url: `${origin}/accepted` });
    const timedRender = async (path: string): Promise<{ kind: string; content: boolean; elapsedMs: number }> => {
      const started = Date.now();
      const outcome = await worker.render({ url: `${origin}${path}` }).then(
        (rendered) => ({ kind: 'rendered', content: /DELAYED_XHR_CONTENT|HANGING_LOAD_CONTENT/.test(rendered.html) }),
        (error: unknown) => ({ kind: readFailure(error).kind, content: false }),
      );
      return { ...outcome, elapsedMs: Date.now() - started };
    };
    const appDelayed = await timedRender('/app-delayed');
    const hangingLoad = await timedRender('/hanging-load');
    const appHangingData = await timedRender('/app-hanging-data');
    const appSettledBlank = await timedRender('/app-settled-blank');
    const emptyStatic = await timedRender('/empty-static');
    const brokenScript = await worker.render({ url: `${origin}/app-broken-script` }).then(
      () => ({ kind: 'rendered', subresourceFailures: { count: 0, sampleError: '' } }),
      (error: unknown) => ({ kind: readFailure(error).kind, subresourceFailures: readSubresourceFailures(error) }),
    );
    // 两种数据 API 都由真实 Chromium 报错；再经生产 Provider 验证模型建议，而非只核对内部计数。
    const brokenData = await new LocalRenderProvider({ renderer: worker })
      .read({ url: `${origin}/app-broken-data` }).then(
        () => null,
        (error: unknown) => {
          if (!(error instanceof WebFailureError)) throw error;
          return error;
        },
      );
    if (!brokenData) throw new Error('断开的数据请求应使空壳读取失败');
    const dataDiagnostics = getWebFailureDiagnostics(brokenData);
    const dataFeedback = buildWebReadFailureFeedback(brokenData, { hostname: 'www.web-render.test' });

    const forbiddenLongError = await new LocalRenderProvider({ renderer: worker })
      .read({ url: `${origin}/forbidden-long` })
      .then(() => null, (error: unknown) => (error instanceof WebFailureError ? error : null));
    if (!forbiddenLongError) throw new Error('渲染长 403 页面不得作为正文成功返回');
    const forbiddenLong = {
      kind: forbiddenLongError.kind,
      status: forbiddenLongError.status,
    };

    const managerPartitions: string[] = [];
    let managerSessionCalls = 0;
    const countingRuntime = {
      ...fixtureRuntime,
      createSession(partition: string) {
        managerSessionCalls += 1;
        managerPartitions.push(partition);
        return fixtureRuntime.createSession(partition);
      },
    };
    const slotManager = new WebPageRenderManager({
      maxConcurrency: 1,
      idleTimeoutMs: 100,
      runtime: countingRuntime,
      partitionPrefix: `web-render-e2e-slot-${process.pid}`,
    });
    const restrictedManager = new WebPageRenderManager({
      maxConcurrency: 1,
      idleTimeoutMs: 100,
      partitionPrefix: `web-render-e2e-restricted-${process.pid}`,
    });
    let spaAfterIdle = false;
    let restrictedBeforeIdle: { kind: string; netErrorCode?: number } = { kind: '' };
    let restrictedAfterIdle: { kind: string; netErrorCode?: number } = { kind: '' };
    try {
      await slotManager.render({ url: `${origin}/static` });
      await new Promise((resolve) => setTimeout(resolve, 250));
      const spaSecond = await slotManager.render({ url: `${origin}/spa` });
      spaAfterIdle = spaSecond.html.includes('SPA_RENDERED_CONTENT');

      const readRestrictedError = async (): Promise<{ kind: string; netErrorCode?: number }> => {
        try {
          await restrictedManager.render({ url: `http://127.0.0.1:${port}/static` });
          return { kind: 'rendered' };
        } catch (error: unknown) {
          const code = error && typeof error === 'object' ? Reflect.get(error, 'netErrorCode') : undefined;
          return {
            kind: error && typeof error === 'object' ? String(Reflect.get(error, 'kind') ?? '') : '',
            ...(typeof code === 'number' ? { netErrorCode: code } : {}),
          };
        }
      };
      restrictedBeforeIdle = await readRestrictedError();
      await new Promise((resolve) => setTimeout(resolve, 250));
      restrictedAfterIdle = await readRestrictedError();
    } finally {
      await slotManager.dispose();
      await restrictedManager.dispose();
    }

    const r6ValidatedHosts: string[] = [];
    const r6Worker = new WebPageRenderWorker({
      runtime: createElectronWebPageRenderRuntime({
        validateRequestUrl: async (rawUrl) => {
          const parsed = new URL(rawUrl);
          const host = parsed.hostname.toLowerCase();
          r6ValidatedHosts.push(host);
          if (host === 'blocked-by-dns.test') {
            throw new Error('Blocked fixture host');
          }
        },
      }),
      partition: `web-render:e2e-r6-${process.pid}`,
      settleDelayMs: 250,
      loadTimeoutMs: 2_000,
      renderTimeoutMs: 2_000,
      totalTimeoutMs: 5_000,
    });
    let externalRedirectResult = { rendered: false, finalUrlMatched: false, validatedBothHosts: false };
    let scriptEscapeAfterRedirectKind = '';
    let deniedDnsRedirect = { kind: '', netErrorCode: undefined as number | undefined };
    let hiddenRevealContent = false;
    try {
      const extRendered = await r6Worker.render({ url: `${origin}/redirect-external` });
      externalRedirectResult = {
        rendered: extRendered.html.includes('SPA_RENDERED_CONTENT'),
        finalUrlMatched: extRendered.finalUrl === `http://other-site.test:${port}/spa`,
        validatedBothHosts: r6ValidatedHosts.includes('www.web-render.test') && r6ValidatedHosts.includes('other-site.test'),
      };
      scriptEscapeAfterRedirectKind = await r6Worker.render({ url: `${origin}/redirect-to-script-escape` })
        .then(() => 'rendered', (err: unknown) => readFailure(err).kind);
      deniedDnsRedirect = await r6Worker.render({ url: `${origin}/redirect-denied-dns` })
        .then(
          () => ({ kind: 'rendered', netErrorCode: undefined }),
          (err: unknown) => {
            const code = err && typeof err === 'object' ? Reflect.get(err, 'netErrorCode') : undefined;
            return {
              kind: readFailure(err).kind,
              ...(typeof code === 'number' ? { netErrorCode: code } : {}),
            };
          },
        );
      const revealed = await new LocalRenderProvider({ renderer: worker }).read({ url: `${origin}/hidden-reveal` });
      hiddenRevealContent = revealed.content.includes('REVEALED MAIN BODY');
    } finally {
      await r6Worker.dispose();
    }

    const phase2Worker = new WebPageRenderWorker({
      runtime: fixtureRuntime,
      partition: `web-render:e2e-phase2-${process.pid}`,
      settleDelayMs: 100,
      loadTimeoutMs: 4_000,
      maxSettleDelayMs: 3_000,
      readinessTimeoutMs: 8_000,
      maxScrollSteps: 3,
      scrollStepDelayMs: 120,
      maxScrollDurationMs: 2_500,
      renderTimeoutMs: 3_000,
      totalTimeoutMs: 12_000,
    });
    const localHttp = new LocalHttpProvider({
      resolveHost: async (targetUrl) => ({
        hostname: targetUrl.hostname,
        addresses: [{ address: '127.0.0.1', family: 4 }],
      }),
    });
    const phase2RenderProvider = new LocalRenderProvider({ renderer: phase2Worker });

    let hashRouteE2e = {
      aHasNoticeA: false,
      bHasNoticeB: false,
      bExcludesNoticeA: false,
      distinctRefs: false,
      findHitB: false,
      snapshotBExcludesA: false,
      hashAnchorSharedRef: false,
    };
    let visibilityContract = {
      disclosuresKept: false,
      nestedHiddenExcluded: false,
      loginMaskKind: '',
      jsonLdExcluded: false,
    };
    let govIframeE2e = {
      selectedProvider: '',
      escalationReason: '',
      hasDocNo: false,
      hasTableValues: false,
      hasResolvedAttachment: false,
      hasInlinedWarning: false,
      hasFrameResource: false,
      hasAttachmentResource: false,
      attachDirStayedHttp: false,
      crossOriginStayedHttpWithLink: false,
    };
    let shadowAndCss = {
      summaryOnce: false,
      defaultOnce: false,
      unslottedExcluded: false,
      cookieExcluded: false,
      inactiveTabExcluded: false,
      opacityZeroKept: false,
    };
    let slowHydrationAndPolling = {
      slowHasContent: false,
      pollingFast: false,
      pollingHasContent: false,
    };
    let lazyAndInfiniteScroll = {
      lazyHasAll3Screens: false,
      lazyNoIncompleteWarning: false,
      infiniteCapturedBatch: false,
      infiniteHasWarning: false,
      infiniteTruncatedFalse: false,
    };
    let heavyBlockingAndOnerror = {
      heavyRequestsZero: false,
      onerrorPreservedImage: false,
      cspOnerrorPreservedImage: false,
    };

    try {
      // 1. SPA Hash Route E2E（贯穿正式 web_read + 内存缓存 + Citation + Evidence）
      const cacheRuntime = createWebCacheRuntime(new MemoryWebCache());
      const evidenceByUrl = new Map<string, string>();
      const e2eContext: ToolContext = {
        conversationId: 'e2e-phase2-conv',
        turnId: 'e2e-phase2-turn',
        research: { instanceId: 'e2e-phase2-inst' },
      };
      attachCitationSequence(e2eContext, { offset: 0 });
      attachCitationRefAllocator(e2eContext, createCitationRefAllocatorFixture());
      const hashDeps = {
        provider: localHttp,
        renderProvider: phase2RenderProvider,
        managedProvider: null,
        cacheRuntime,
        evidenceWriter: {
          save: async ({ items }: { readonly items: readonly WebEvidenceCaptureItem[] }) => {
            for (const item of items) {
              evidenceByUrl.set(item.canonicalUrl, item.contentText);
            }
            return { bundleId: 'e2e-bundle-1' };
          },
        },
      };
      const hashUrlA = `${origin}/spa-hash#/notice/a`;
      const hashUrlB = `${origin}/spa-hash#/notice/b`;
      const parsedA = JSON.parse(await runReadWebPage({ url: hashUrlA }, e2eContext, hashDeps));
      const parsedB = JSON.parse(await runReadWebPage({ url: hashUrlB }, e2eContext, hashDeps));
      const parsedFindB = JSON.parse(await runReadWebPage({ url: hashUrlB, find: 'NOTICE B FISCAL CIRCULAR' }, e2eContext, hashDeps));
      const sec1 = JSON.parse(await runReadWebPage({ url: `${origin}/anchor-article#sec-1` }, e2eContext, hashDeps));
      const sec2 = JSON.parse(await runReadWebPage({ url: `${origin}/anchor-article#sec-2` }, e2eContext, hashDeps));
      const snapB = evidenceByUrl.get(`${origin}/spa-hash#/notice/b`) ?? '';
      hashRouteE2e = {
        aHasNoticeA: String(parsedA.observation).includes('NOTICE A PERSONNEL'),
        bHasNoticeB: String(parsedB.observation).includes('NOTICE B FISCAL CIRCULAR'),
        bExcludesNoticeA: !String(parsedB.observation).includes('NOTICE A PERSONNEL'),
        distinctRefs: parsedA.data.citations.citations[0].ref !== parsedB.data.citations.citations[0].ref,
        findHitB: (parsedFindB.data.find?.hit_count ?? 0) >= 1
          && String(parsedFindB.observation).includes('NOTICE B FISCAL CIRCULAR'),
        snapshotBExcludesA: snapB.includes('NOTICE B FISCAL CIRCULAR') && !snapB.includes('NOTICE A PERSONNEL'),
        hashAnchorSharedRef: sec1.data.citations.citations[0].ref === sec2.data.citations.citations[0].ref
          && sec2.data.cacheStatus === 'hit',
      };

      // 2. 可见正文合同双夹具（折叠正文保留 + 内部隐藏/CSS隐藏排除 + 登录遮罩先判 + JSON-LD 不入正文）
      const disclosuresRes = await phase2RenderProvider.read({ url: `${origin}/disclosures-ok` });
      const loginMaskKind = await phase2RenderProvider.read({ url: `${origin}/login-mask` })
        .then(() => 'rendered', (err: unknown) => (err instanceof WebFailureError ? err.kind : ''));
      const jsonLdErrText = await phase2RenderProvider.read({ url: `${origin}/jsonld-empty-body` })
        .then((res) => res.content, (err: unknown) => (err instanceof Error ? err.message : ''));
      visibilityContract = {
        disclosuresKept: disclosuresRes.content.includes('EXPANDED ARIA BODY ITEM')
          && disclosuresRes.content.includes('READ MORE EXPANDED BODY')
          && disclosuresRes.content.includes('DETAILS BODY TEXT'),
        nestedHiddenExcluded: !disclosuresRes.content.includes('NESTED HIDDEN SECRET')
          && !disclosuresRes.content.includes('STALE CSS SECRET'),
        loginMaskKind,
        jsonLdExcluded: !jsonLdErrText.includes('JSONLD NEVER EVIDENCE'),
      };

      // 3. 政务同源 iframe 端到端 + 纯附件目录 + 同站跨源对照
      const govRes = await readWebPageWithLadder(
        { url: `${origin}/gov-iframe-shell` },
        { provider: localHttp, renderProvider: phase2RenderProvider, managedProvider: null },
      );
      const attachDirRes = await readWebPageWithLadder(
        { url: `${origin}/gov-attach-dir` },
        { provider: localHttp, renderProvider: phase2RenderProvider, managedProvider: null },
      );
      const crossFrameRes = await readWebPageWithLadder(
        { url: `${origin}/gov-cross-origin-iframe` },
        { provider: localHttp, renderProvider: phase2RenderProvider, managedProvider: null },
      );
      govIframeE2e = {
        selectedProvider: govRes.selectedProvider,
        escalationReason: govRes.escalationReason ?? '',
        hasDocNo: govRes.readResult.content.includes('国办发〔2026〕12号'),
        hasTableValues: govRes.readResult.content.includes('580万元') && govRes.readResult.content.includes('420万元'),
        hasResolvedAttachment: govRes.readResult.content.includes(`${origin}/files/attach.pdf`),
        hasInlinedWarning: govRes.readResult.warnings.includes('inlined_same_origin_iframe'),
        hasFrameResource: Boolean(govRes.readResult.resources?.some((r) => r.url === `${origin}/sub/bulletin.html` && r.kind === 'source')),
        hasAttachmentResource: Boolean(govRes.readResult.resources?.some((r) => r.url === `${origin}/files/attach.pdf` && r.kind === 'document')),
        attachDirStayedHttp: attachDirRes.selectedProvider === 'local_http' && attachDirRes.readResult.warnings.includes('metadata_only'),
        crossOriginStayedHttpWithLink: crossFrameRes.selectedProvider === 'local_http'
          && Boolean(crossFrameRes.readResult.resources?.some((r) => r.url === `http://docs.web-render.test:${port}/frame-notice.html`)),
      };

      // 4. Shadow DOM <slot> + CSS 遮罩/Tab + opacity: 0 保留
      const shadowRes = await phase2RenderProvider.read({ url: `${origin}/shadow-and-css` });
      shadowAndCss = {
        summaryOnce: shadowRes.content.match(/SHADOW SUMMARY ONCE/g)?.length === 12,
        defaultOnce: shadowRes.content.match(/SHADOW DEFAULT ONCE/g)?.length === 12,
        unslottedExcluded: !shadowRes.content.includes('UNSLOTTED SECRET'),
        cookieExcluded: !shadowRes.content.includes('COOKIE BANNER NOISE'),
        inactiveTabExcluded: !shadowRes.content.includes('INACTIVE TAB NOISE'),
        opacityZeroKept: shadowRes.content.includes('SCROLL FADE KEEP'),
      };

      // 5. 慢水合（>300 字导航 + 3.2s XHR）与高频轮询 + 数字跳动
      const slowRes = await phase2RenderProvider.read({ url: `${origin}/slow-hydration` });
      const pollStartedAt = Date.now();
      const pollRes = await phase2RenderProvider.read({ url: `${origin}/polling-ticker` });
      slowHydrationAndPolling = {
        slowHasContent: slowRes.content.includes('SLOW HYDRATED ARTICLE'),
        pollingFast: Date.now() - pollStartedAt < 2_500,
        pollingHasContent: pollRes.content.includes('POLLING MAIN STABLE CONTENT'),
      };

      // 6. 3 屏懒加载与无限追加刹车
      const lazyRes = await phase2RenderProvider.read({ url: `${origin}/lazy-3screens` });
      const infRes = await phase2RenderProvider.read({ url: `${origin}/infinite-append` });
      lazyAndInfiniteScroll = {
        lazyHasAll3Screens: lazyRes.content.includes('SCREEN ONE ITEM')
          && lazyRes.content.includes('SCREEN TWO DATA')
          && lazyRes.content.includes('SCREEN THREE DATA'),
        lazyNoIncompleteWarning: !lazyRes.warnings.includes('lazy_content_incomplete'),
        infiniteCapturedBatch: infRes.content.includes('INFINITE BATCH NO 1') && infRes.content.includes('INFINITE BATCH NO 2'),
        infiniteHasWarning: infRes.warnings.includes('lazy_content_incomplete'),
        infiniteTruncatedFalse: infRes.truncated === false,
      };

      // 7. 重资源拦截（image/media/font 零服务端请求）+ onerror 删图与严格 CSP 对照
      const heavyRes = await phase2RenderProvider.read({ url: `${origin}/heavy-onerror` });
      const heavyCspRes = await phase2RenderProvider.read({ url: `${origin}/heavy-onerror-csp` });
      heavyBlockingAndOnerror = {
        heavyRequestsZero: state.heavyResourceRequests === 0,
        onerrorPreservedImage: Boolean(heavyRes.images?.some((img) => img.url === `${origin}/blocked-hero.jpg`)),
        cspOnerrorPreservedImage: Boolean(heavyCspRes.images?.some((img) => img.url === `${origin}/blocked-hero-csp.jpg`)),
      };
    } finally {
      await phase2Worker.dispose();
    }

    const result = {
      spaRendered: spa.html.includes('SPA_RENDERED_CONTENT'),
      permissionDenied: spa.html.includes('data-permission="denied"'),
      sameHostRedirected: redirected.finalUrl === `${origin}/spa`,
      sameSiteRedirected: siteRedirected.finalUrl === `http://web-render.test:${port}/spa`,
      crossRedirectKind,
      timeoutKind,
      privateNetworkKind,
      // 本地 URL/DNS 准入拒绝主框架：Chromium ERR_BLOCKED_BY_CLIENT。
      privateNetworkErrorCode,
      recoveredAfterBlockedNavigation: recovered.html.includes('static fixture'),
      spaMainStatus: spa.mainResponse.status,
      redirectedMainStatus: redirected.mainResponse.status,
      awsChallenge,
      cloudflareChallenge,
      challengeExecutionRequests: state.challengeExecutionRequests,
      acceptedRendered: accepted.html.includes('accepted fixture'),
      acceptedMainStatus: accepted.mainResponse.status,
      // 延迟数据的应用壳要等到正文；拖住 load 的子资源不再使整页失败。
      appDelayed: { kind: appDelayed.kind, content: appDelayed.content },
      hangingLoad: { kind: hangingLoad.kind, content: hangingLoad.content },
      // 数据请求不结束的空壳在预算内报告未渲染；数据已结束仍为空壳则不必等到截止。
      appHangingDataKind: appHangingData.kind,
      appSettledBlank: { kind: appSettledBlank.kind, beforeDeadline: appSettledBlank.elapsedMs < 2_500 },
      // 没有脚本的真实空页按原快速路径返回，由 Web 抽取判定空正文。
      emptyStatic: { kind: emptyStatic.kind, fast: emptyStatic.elapsedMs < 1_500 },
      // 脚本在传输层失败的应用壳：报告未渲染并附子资源失败事实。
      brokenScript: {
        kind: brokenScript.kind,
        failed: brokenScript.subresourceFailures.count >= 1,
        sampleIsNetError: /^net::ERR_[A-Z0-9_]+$/.test(brokenScript.subresourceFailures.sampleError),
      },
      brokenData: {
        kind: brokenData.kind,
        renderKind: dataDiagnostics.renderFailureKind,
        failed: (dataDiagnostics.dataRequestFailureCount ?? 0) >= 2,
        sampleIsNetError: /^net::ERR_[A-Z0-9_]+$/.test(dataDiagnostics.dataRequestError ?? ''),
        scriptFailuresAbsent: dataDiagnostics.subresourceFailureCount === undefined,
        suggestsRetry: dataFeedback.includes('可稍后重试'),
        claimsRetryUseless: dataFeedback.includes('重复读取同一地址通常不会改变结果'),
      },
      forbiddenLong,
      slotIdleReuse: {
        createSessionCalls: managerSessionCalls,
        uniquePartitions: new Set(managerPartitions).size,
        spaAfterIdle,
        restrictedBeforeIdle,
        restrictedAfterIdle,
      },
      preCommitCrossSiteRedirect: externalRedirectResult,
      scriptEscapeAfterRedirectKind,
      deniedDnsRedirect,
      hiddenRevealContent,
      hashRouteE2e,
      visibilityContract,
      govIframeE2e,
      shadowAndCss,
      slowHydrationAndPolling,
      lazyAndInfiniteScroll,
      heavyBlockingAndOnerror,
      popupRequests: state.popupRequests,
      downloadRequests: state.downloadRequests,
    };
    console.log(`WEB_RENDER_E2E_RESULT=${JSON.stringify(result)}`);
  } finally {
    await worker.dispose();
    await closeServer(server);
  }
}

app.commandLine.appendSwitch('disable-gpu');
// 合成域名只在夹具 Chromium 中解析到 localhost；生产 runtime 仍执行正常 URL/DNS 准入。
app.commandLine.appendSwitch('host-resolver-rules', 'MAP *.web-render.test 127.0.0.1, MAP web-render.test 127.0.0.1, MAP other-site.test 127.0.0.1, MAP third-site.test 127.0.0.1, MAP blocked-by-dns.test 127.0.0.1');
app.commandLine.appendSwitch('no-proxy-server');
// 安全测试会主动销毁最后一个隐藏窗；保持主进程存活以验证下一任务能否重建。
app.on('window-all-closed', () => undefined);
app.whenReady()
  .then(run)
  .then(() => app.quit())
  .catch((error: unknown) => {
    console.error('WEB_RENDER_E2E_ERROR', error);
    app.exit(1);
  });
