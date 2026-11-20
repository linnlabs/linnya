import assert from 'node:assert/strict';

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
  assert.equal(knowledge?.state, 'missing');
  await openKnowledgeStoreDetail(run, true);
  await clickNamed(run, 'button', '安装', 'main');
  await run('wait', '--selector', knowledgeSidebar);
  await clickNamed(run, 'button', '新对话', 'aside');
}
