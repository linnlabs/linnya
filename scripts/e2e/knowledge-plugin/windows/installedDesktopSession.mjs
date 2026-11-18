import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { connectCdp } from '../../../development/features/desktop-probe/infrastructure/cdpClient.mjs';

export async function until(read, ready, label, timeout = 120_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (ready(value)) return value;
    await delay(100);
  }
  throw new Error(`Timed out: ${label}`);
}

/** 安装目录中的真实 Main/Preload；所有业务动作经正式接口，不给 App 注入替身入口。 */
export async function launchInstalledDesktop(executable, root) {
  const profile = path.join(root, 'profile');
  const workspace = path.join(root, 'workspace');
  await mkdir(profile, { recursive: true });
  await mkdir(workspace, { recursive: true });
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (
      /^(?:LINNYA_|VITE_|MODEL_REGISTRY_|ELECTRON_RUN_AS_NODE$|NODE_OPTIONS$|NODE_PATH$)/.test(key)
    )
      delete environment[key];
  }
  Object.assign(environment, {
    NODE_ENV: 'production',
    LINNYA_DEV_MODE: 'false',
    LINNYA_DISABLE_UPDATE_CHECKS: '1',
    LINNYA_WORKSPACE_DIR: workspace,
    LINNYA_CLI_CONNECTION_FILE: path.join(profile, 'connection.json'),
  });
  const child = spawn(
    executable,
    [
      `--user-data-dir=${profile}`,
      '--remote-debugging-address=127.0.0.1',
      '--remote-debugging-port=0',
      '--enable-logging=stderr',
    ],
    {
      cwd: root,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  let output = '';
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', value => {
      output = `${output}${value}`.slice(-2_000_000);
    });
  const exited = new Promise((resolve, reject) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
    child.once('error', reject);
  });
  void exited.catch(() => {});
  let cdp;
  const errors = [];
  const application = {
    child,
    workspace,
    profile,
    errors,
    get log() {
      return output;
    },
    async evaluate(expression) {
      const result = await cdp.send(
        'Runtime.evaluate',
        { expression, returnByValue: true, awaitPromise: true },
        120_000
      );
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    },
    invoke(method, ...args) {
      return this.evaluate(
        `window.electronAPI[${JSON.stringify(method)}](...${JSON.stringify(args)})`
      );
    },
    async plugin(channel, payload = {}) {
      const result = await this.invoke('plugin:invoke', 'knowledge', channel, payload);
      assert.equal(result.success, true, JSON.stringify(result.error));
      return result.data;
    },
    async api(route, options = {}) {
      const session = await this.invoke('invoke', 'api:get-port');
      const headers = {
        'X-API-Token': session.token,
        ...(options.json ? { 'content-type': 'application/json' } : {}),
      };
      const response = await fetch(`http://127.0.0.1:${session.port}${route}`, {
        method: options.method ?? 'GET',
        headers,
        body: options.json ? JSON.stringify(options.json) : options.body,
        signal: AbortSignal.timeout(120_000),
      });
      const result = await response.json();
      assert.equal(response.ok, true, `${route}: ${response.status}: ${JSON.stringify(result)}`);
      return result;
    },
    async clickElement(expression) {
      const point = await until(
        () =>
          this.evaluate(
            `(()=>{const target=(${expression});if(!target)return null;target.scrollIntoView({block:'nearest'});const r=target.getBoundingClientRect();return r.width&&r.height?{x:r.x+r.width/2,y:r.y+r.height/2}:null;})()`
          ),
        Boolean,
        'Visible click target',
        30_000
      );
      assert.ok(point, 'Visible click target missing');
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        ...point,
        button: 'left',
        clickCount: 1,
      });
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        ...point,
        button: 'left',
        clickCount: 1,
      });
    },
    clickText(text) {
      return this.clickElement(
        `[...document.querySelectorAll('button,a,[role="button"],.card-title')].find(e=>e.textContent.trim()===${JSON.stringify(text)}||e.getAttribute('aria-label')===${JSON.stringify(text)})`
      );
    },
    async typeText(text) {
      await cdp.send('Input.insertText', { text });
    },
    async screenshot(file) {
      const image = await cdp.send('Page.captureScreenshot', { format: 'png' });
      await writeFile(file, Buffer.from(image.data, 'base64'));
    },
    async stop() {
      try {
        if (child.exitCode === null && child.signalCode === null) {
          if (cdp?.connected) await this.evaluate('void window.electronAPI.windowAction("close")');
          else child.kill();
          await Promise.race([
            exited,
            delay(30_000, undefined, { ref: false }).then(() => {
              throw new Error('App did not exit normally');
            }),
          ]);
        }
      } finally {
        cdp?.close();
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGKILL');
          await exited;
        }
      }
    },
  };
  try {
    const debuggerUrl = await until(
      () => {
        assert.equal(child.exitCode, null, 'App exited before debugger readiness');
        return output.match(/DevTools listening on (ws:\/\/\S+)/)?.[1];
      },
      Boolean,
      'App debugger'
    );
    const origin = new URL(debuggerUrl);
    const target = await until(
      async () => {
        const targets =
          await // 首次安装会在 Main 同步登记随包插件；同一个启动预算内等待 CDP，而非误判为网络故障。
          (
            await fetch(`http://${origin.host}/json/list`, { signal: AbortSignal.timeout(120_000) })
          ).json();
        return targets.find(item => item.type === 'page' && /^(file:|app:)/.test(item.url));
      },
      Boolean,
      'App page'
    );
    cdp = await connectCdp(target.webSocketDebuggerUrl);
    cdp.onEvent(event => {
      if (event.method === 'Runtime.exceptionThrown') errors.push(event.params.exceptionDetails);
    });
    await cdp.send('Runtime.enable');
    await until(
      () =>
        application.evaluate(
          'Boolean(window.electronAPI && document.querySelector("#app")?.childElementCount)'
        ),
      Boolean,
      'App UI'
    );
    await until(
      () => application.invoke('invoke', 'api:get-port'),
      value => Number.isInteger(value?.port),
      'App backend'
    );
    return application;
  } catch (error) {
    await application.stop();
    await mkdir(path.join(root, '..', 'evidence'), { recursive: true });
    await writeFile(path.join(root, '..', 'evidence/desktop.log'), output);
    throw new Error(`${error.message}\n${output.slice(-6000)}`, { cause: error });
  }
}
