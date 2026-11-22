import assert from 'node:assert/strict';
import { startDevPluginCatalog } from '../plugin-remote/devPluginCatalog.fixture.mjs';

/**
 * 知识库不随安装包分发：场景里的安装、自动恢复与重装都走本机开发 catalog（远程安装同一条路径）。
 * 加载夹具即启动服务并设置环境变量，之后由本进程启动的探针实例都能从它安装。
 */
export const knowledgeCatalog = await startDevPluginCatalog({ plugin: 'knowledge' });

export const knowledgeSidebar = '.sidebar-entry:has(svg[data-icon="library"])';

export async function clickNamed(run, role, name, within) {
  const { entries } = await run('snapshot', '--json', '--role', role, '--max-lines', '120', '--within', within);
  const targets = entries.filter(entry => entry.name === name);
  assert.equal(targets.length, 1, `${role}: ${name}`);
  await run('click', targets[0].ref);
}

export async function openKnowledgeStoreDetail(run, market = false) {
  await clickNamed(run, 'button', '插件', 'aside');
  if (market) await run('click', 'text=插件市场');
  await clickNamed(run, 'heading', '知识库', 'main');
}

export async function installKnowledgeForScenario(run) {
  const { value: listing } = await run('eval', 'window.electronAPI.plugins.list()');
  assert.equal(listing.success, true);
  const knowledge = listing.data.find(item => item.meta.id === 'knowledge');
  if (knowledge?.state === 'enabled' && !knowledge.runtimeUnavailable) return;
  // 从未安装过的远程插件不在本机插件列表里，只在插件市场的 catalog 条目中。
  assert.ok(knowledge === undefined || knowledge.state === 'missing', `knowledge state: ${knowledge?.state}`);
  await openKnowledgeStoreDetail(run, true);
  await clickNamed(run, 'button', '安装', 'main');
  await run('wait', '--selector', knowledgeSidebar);
  await clickNamed(run, 'button', '新对话', 'aside');
}
