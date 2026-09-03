import { app } from 'electron';
import { createServer } from 'node:http';
import { WebPageRenderWorker } from '../../../src/electron-main/web-render/WebPageRenderWorker';
import { createElectronWebPageRenderRuntime } from '../../../src/electron-main/web-render/electronWebPageRenderRuntime';

interface FixtureState {
  popupRequests: number;
  downloadRequests: number;
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
  const state: FixtureState = { popupRequests: 0, downloadRequests: 0 };
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
  const origin = `http://127.0.0.1:${port}`;
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
    try {
      await restrictedWorker.render({ url: `${origin}/static` });
    } catch (error: unknown) {
      privateNetworkKind = error && typeof error === 'object'
        ? String(Reflect.get(error, 'kind') ?? '')
        : '';
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

    const result = {
      spaRendered: spa.html.includes('SPA_RENDERED_CONTENT'),
      permissionDenied: spa.html.includes('data-permission="denied"'),
      sameHostRedirected: redirected.finalUrl === `${origin}/spa`,
      crossRedirectKind,
      timeoutKind,
      privateNetworkKind,
      recoveredAfterBlockedNavigation: recovered.html.includes('static fixture'),
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
// 安全测试会主动销毁最后一个隐藏窗；保持主进程存活以验证下一任务能否重建。
app.on('window-all-closed', () => undefined);
app.whenReady()
  .then(run)
  .then(() => app.quit())
  .catch((error: unknown) => {
    console.error('WEB_RENDER_E2E_ERROR', error);
    app.exit(1);
  });
