import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';
import { expect, it, vi } from 'vitest';

const protocolHandlers = vi.hoisted(
  () => new Map<string, (request: Request) => Response | Promise<Response>>()
);
vi.mock('electron', () => ({
  net: { fetch },
  protocol: {
    handle: (scheme: string, handler: (request: Request) => Response | Promise<Response>) =>
      protocolHandlers.set(scheme, handler),
  },
}));
import { registerPluginProtocolHandler } from '../pluginProtocol';

it('磁盘插件使用同一 Vue 的作用域释放、只读状态与已注册指令', async () => {
  registerPluginProtocolHandler();
  const handler = protocolHandlers.get('plugin');
  if (!handler) throw new Error('Plugin protocol handler not registered');
  const response = await handler(new Request('plugin://host/vue.js'));
  expect(response.status).toBe(200);
  const shimUrl = `data:text/javascript;base64,${Buffer.from(await response.text()).toString('base64')}`;
  const require = createRequire(import.meta.url);
  // 浏览器原生 ESM 会在执行前检查 named exports；Worker 同样真实链接协议返回的模块，避免 Vite alias 绕过它。
  const worker = new Worker(
    `
    const { parentPort, workerData } = require('node:worker_threads');
    const { createRequire } = require('node:module');
    const vue = require(workerData.vuePath);
    globalThis.__LINNYA_RENDERER_PLUGIN_HOST_MODULES__ = { vue };
    const plugin = 'import { effectScope, readonly, ref, watch, resolveDirective } from '+JSON.stringify(workerData.shimUrl)+'; export { effectScope, readonly, ref, watch, resolveDirective };';
    (async () => {
      const api = await import('data:text/javascript;base64,'+Buffer.from(plugin).toString('base64'));
      const state = api.ref(0);
      const readOnlyState = api.readonly(state);
      let updates = 0;
      const scope = api.effectScope();
      scope.run(() => api.watch(state, () => updates++, { flush: 'sync' }));
      state.value++;
      scope.stop();
      state.value++;
      const app = vue.createSSRApp({ render() {
        const directive = api.resolveDirective('plugin-label');
        return vue.withDirectives(vue.h('span', 'Plugin'), [[directive]]);
      }});
      app.directive('plugin-label', { getSSRProps: () => ({ 'data-plugin-label': 'registered' }) });
      const { renderToString } = createRequire(workerData.vuePath)('@vue/server-renderer');
      parentPort.postMessage({ updates, value: readOnlyState.value, isReadonly: vue.isReadonly(readOnlyState), html: await renderToString(app) });
    })().catch(error => { throw error; });
  `,
    { eval: true, workerData: { shimUrl, vuePath: require.resolve('vue') } }
  );
  try {
    const result = await new Promise<unknown>((resolve, reject) => {
      worker.once('message', resolve);
      worker.once('error', reject);
      worker.once('exit', code => {
        if (code !== 0) reject(new Error(`Vue protocol Worker exited ${code}`));
      });
    });
    expect(result).toEqual({
      updates: 1,
      value: 2,
      isReadonly: true,
      html: '<span data-plugin-label="registered">Plugin</span>',
    });
  } finally {
    await worker.terminate();
  }
});
