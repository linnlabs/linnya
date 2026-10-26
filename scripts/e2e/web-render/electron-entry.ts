import { app } from 'electron';
import { createServer } from 'node:http';
import { WebPageRenderWorker } from '../../../src/electron-main/web-render/WebPageRenderWorker';
import { createElectronWebPageRenderRuntime } from '../../../src/electron-main/web-render/electronWebPageRenderRuntime';

interface FixtureState {
  popupRequests: number;
  downloadRequests: number;
  challengeExecutionRequests: number;
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
  const state: FixtureState = { popupRequests: 0, downloadRequests: 0, challengeExecutionRequests: 0 };
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
    if (route === '/data-hang' || route === '/hang-image') {
      // 故意不结束响应：模拟永不完成的数据请求或拖住 load 事件的子资源。
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
    if (route === '/broken-script.js') {
      // 直接断开连接：模拟脚本下载在传输层失败。
      request.socket.destroy();
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
      response.end(`<!doctype html><html><body><article>${'HANGING_LOAD_CONTENT '.repeat(20)}</article>
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
app.commandLine.appendSwitch('host-resolver-rules', 'MAP *.web-render.test 127.0.0.1, MAP web-render.test 127.0.0.1');
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
