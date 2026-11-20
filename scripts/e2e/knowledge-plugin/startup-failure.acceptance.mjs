import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { acceptance } from '../../development/features/desktop-probe/acceptance/probeAcceptance.mjs';
import { observeTree } from '../../development/features/desktop-probe/infrastructure/processTree.mjs';
import { createEvidence } from '../../test-runner/features/acceptance-evidence/createEvidence.mjs';
import { installKnowledgeForScenario } from './knowledgeStore.fixture.mjs';

const mode = process.env.KNOWLEDGE_PLUGIN_MODE || 'dev';
if (mode === 'bundled') process.env.LINNYA_PLUGIN_RENDERER_BUNDLE = 'disk';

// 只改本脚本新建的隔离库：实际 SQLite 失败经正式 artifact activation，不替换产品服务。
const evidence = createEvidence('knowledge-startup-fault-isolation', { files: [
  'scripts/e2e/knowledge-plugin/startup-failure.acceptance.mjs',
] });
const test = acceptance(`knowledge-fault-${process.pid}`, { evidence });
const { run, probe } = test;
const exec = promisify(execFile);
const evaluate = async code => (await run('eval', `(async()=>{${code}})()`)).value;
const fixtures = [];
let up;
let failed;
try {
  up = await run('up', '--mode', mode, '--size', '1440x1100');
  await installKnowledgeForScenario(run);
  const entries = await evaluate('return await window.electronAPI.plugins.rendererEntries();');
  if (mode === 'bundled') {
    const entry = entries.data.find(item => item.pluginId === 'knowledge');
    assert.equal(entry?.sourceKind, 'active');
    assert.equal(entry?.entryUrl, 'plugin://knowledge/dist/renderer/index.js');
  }
  evidence.json('candidate', { gitHead: up.gitHead, mode, entries });
  for (const [name, filename] of [['隔离验收 A', 'alpha.md'], ['隔离验收 B', 'beta.md']]) {
    const project = await evaluate(`return await window.electronAPI['workspace:create-project']({name:${JSON.stringify(name)}});`);
    assert.equal(project.success, true);
    const { stdout } = await exec('pnpm', ['-s', 'linnya:cli', 'tools', 'call', 'write_file', '--project', project.data.projectId,
      '--args-json', JSON.stringify({ locator: `workspace:/${filename}`, content: `# ${name}\n\nOrdinary project remains readable.` })],
    { env: { ...process.env, LINNYA_CLI_CONNECTION_FILE: up.connectionFile }, timeout: 30_000 });
    const receipt = JSON.parse(stdout);
    assert.equal(receipt.ok, true);
    fixtures.push({ projectId: project.data.projectId, filename, label: filename.replace(/\.md$/, ''), conversationId: receipt.conversation_id });
  }
  await run('stop');
  const damaged = new DatabaseSync(up.workspaceDb);
  try {
    damaged.exec("DELETE FROM knowledge_bases WHERE id='default'; CREATE TRIGGER fixture_kb_failure BEFORE INSERT ON knowledge_bases BEGIN SELECT RAISE(ABORT,'fixture knowledge metadata write failure'); END");
  } finally { damaged.close(); }
  await evidence.check('知识库元数据无法准备时 App 仍就绪，两个项目的既有对话可见', async () => {
    const restarted = await probe('up', '--mode', mode, '--size', '1440x1100');
    assert.equal(restarted.ok, true, `Knowledge fault must not block Desktop: ${JSON.stringify(restarted)}`);
    up = restarted;
    for (const item of fixtures) {
      await run('open', item.conversationId);
      await run('wait', '--text', item.label);
      const body = await evaluate('return document.body.innerText;');
      assert.ok(body.includes(item.label));
      await run('shot');
    }
    const result = await evaluate("return await window.electronAPI['plugin:invoke']('knowledge','list',{});");
    assert.equal(result.success, false);
    assert.equal(result.userMessage.key, 'knowledgeBase.runtime.error.preparationFailed');
    assert.equal([...observeTree(up.electron).values()].filter(entry => /(?:^|\/)qdrant(?: |$)/.test(entry.command)).length, 0);
    evidence.json('fault-state', { result, fixtures, readyMs: up.readyMs });
  });
  await evidence.check('真实入口显示恢复提示，当前对话保留', async () => {
    await run('click', '--selector', '.knowledge-base-button');
    await run('wait', '--selector', '.notification-content');
    const message = await evaluate("return document.querySelector('.notification-content')?.textContent;");
    assert.match(message, /停用再启用/);
    assert.ok((await evaluate('return document.body.innerText;')).includes('beta'));
    await run('shot');
  });
  await evidence.check('修复资料后停用再启用恢复知识库，普通对话未丢失且不启动向量', async () => {
    const repaired = new DatabaseSync(up.workspaceDb);
    try { repaired.exec('DROP TRIGGER fixture_kb_failure'); } finally { repaired.close(); }
    for (const enabled of [false, true]) {
      const result = await evaluate(`return await window.electronAPI.plugins.setEnabled('knowledge',${enabled});`);
      assert.equal(result.success, true);
    }
    const catalog = await evaluate("return await window.electronAPI['plugin:invoke']('knowledge','list',{});");
    assert.equal(catalog.success, true);
    assert.ok(catalog.data.some(item => item.id === 'default'));
    await run('click', '--selector', '.knowledge-base-button');
    await run('wait', '--selector', '.kb-list-view');
    await run('shot');
    await run('open', fixtures[0].conversationId);
    await run('wait', '--text', 'alpha');
    assert.equal([...observeTree(up.electron).values()].filter(entry => /(?:^|\/)qdrant(?: |$)/.test(entry.command)).length, 0);
  });
} catch (error) { failed = error; evidence.error(error); }
finally {
  try { evidence.json('cleanup', await test.finish({ clean: !failed })); }
  catch (error) { failed ??= error; evidence.error(error); }
}
console.log(JSON.stringify(evidence.finish()));
if (failed) throw failed;
