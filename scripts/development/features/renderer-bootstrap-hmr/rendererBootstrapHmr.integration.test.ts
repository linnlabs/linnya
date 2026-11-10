import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import vue from '@vitejs/plugin-vue';
import { createServer } from 'vite';
import { expect, it, vi } from 'vitest';
import { createRendererBootstrapHmrPlugin } from './createRendererBootstrapHmrPlugin';

it('真实模块图在启动装配重执行前重载页面，普通Vue子组件仍独立热更新', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'renderer-bootstrap-hmr-')));
  const source = path.join(root, 'apps/renderer/app');
  await mkdir(source, { recursive: true });
  const files = {
    'App.vue': '<script setup lang="ts">import { install } from "./bootstrap"; import Child from "./Child.vue"; install();</script><template><Child/></template>',
    'bootstrap.ts': 'import { version } from "./deep"; export function install() { return version; }',
    'deep.ts': 'export const version = 1;',
    'Child.vue': '<script setup lang="ts">import { value } from "./child";</script><template><p>{{ value }}</p></template>',
    'child.ts': 'export const value = 1;',
  };
  await Promise.all(Object.entries(files).map(([file, text]) => writeFile(path.join(source, file), text)));
  await writeFile(path.join(root, 'main.ts'), 'import { createApp } from "vue"; import App from "./apps/renderer/app/App.vue"; createApp(App);');
  const require = createRequire(import.meta.url);
  const server = await createServer({ configFile: false, root, logLevel: 'silent',
    plugins: [vue(), createRendererBootstrapHmrPlugin(root)],
    resolve: { alias: { vue: require.resolve('vue/dist/vue.runtime.esm-bundler.js') } },
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { port: 0, watch: { ignored: ['**/*'] } },
  });
  const sent: unknown[] = [];
  const send = vi.spyOn(server.ws, 'send').mockImplementation(payload => { sent.push(payload); });
  const transform = () => Promise.all(['/main.ts', ...Object.keys(files).map(file => '/apps/renderer/app/' + file)].map(file => server.transformRequest(file)));
  try {
    await server.listen(); await transform();
    await writeFile(path.join(source, 'deep.ts'), 'export const version = 2;');
    server.watcher.emit('change', path.join(source, 'deep.ts'));
    await vi.waitFor(() => expect(sent).toContainEqual({ type: 'full-reload', path: '*' }));
    expect(sent.some(payload => typeof payload === 'object' && payload !== null && Reflect.get(payload, 'type') === 'update')).toBe(false);
    sent.length = 0; await transform();
    await writeFile(path.join(source, 'child.ts'), 'export const value = 2;');
    server.watcher.emit('change', path.join(source, 'child.ts'));
    await vi.waitFor(() => expect(sent.some(payload => typeof payload === 'object' && payload !== null && Reflect.get(payload, 'type') === 'update')).toBe(true));
    expect(sent).not.toContainEqual({ type: 'full-reload', path: '*' });
  } finally { send.mockRestore(); await server.close(); await rm(root, { recursive: true, force: true }); }
});
