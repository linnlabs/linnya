import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { acceptance } from '../../development/features/desktop-probe/acceptance/probeAcceptance.mjs';
import { createEvidence } from '../../test-runner/features/acceptance-evidence/createEvidence.mjs';
import { startCustomCapabilityProtocolServer } from '../../../src/app-hosts/linnya/application/custom-api-onboarding/__tests__/fixtures/customCapabilityProtocolServer.ts';
import { installKnowledgeForScenario, knowledgeSidebar } from './knowledgeStore.fixture.mjs';

const kind = process.argv[2];
assert.ok(['missing-binary', 'invalid-storage'].includes(kind));
// Qdrant 改为远程运行时组件：缺失可执行文件应针对已安装组件，且源码运行的 extraResources 回退会掩盖故障。
// 改写为针对运行时组件之前，missing-binary 明确拒绝运行。
if (kind === 'missing-binary') {
  console.error('[knowledge-qdrant] Qdrant 已改为远程运行时组件，missing-binary 场景待改写为针对已安装组件。');
  process.exit(2);
}
const repository = realpathSync(fileURLToPath(new URL('../../..', import.meta.url)));
assert.match(basename(dirname(repository)), /^linnya-knowledge-upgrade\.[\w]+$/u);
assert.equal(dirname(dirname(repository)), realpathSync(tmpdir()));
process.env.LINNYA_PLUGIN_RENDERER_BUNDLE = 'disk';
const evidence = createEvidence(`knowledge-qdrant-${kind}`, {
  files: ['scripts/e2e/knowledge-plugin/qdrant-startup-fault.acceptance.mjs'],
});
const test = acceptance(`knowledge-qdrant-${kind}-${process.pid}`, { evidence });
const { run } = test;
const fixture = await startCustomCapabilityProtocolServer();
const filename = 'isolated-qdrant-fault.md';
let up;
let failure;
let restore;

const evaluate = async code => (await run('eval', code)).value;

async function upload() {
  await run('click', '--selector', knowledgeSidebar);
  await run('click', 'text=默认知识库');
  await run('click', 'text=文件上传');
  const file = await evaluate(`(()=>{
    const input=document.querySelector('.upload-tab input[type=file]');
    if(!input)return false;
    const files=new DataTransfer();
    files.items.add(new File(['# Orchard\\nApple grows on trees.'],${JSON.stringify(filename)},{type:'text/markdown'}));
    input.files=files.files;
    input.dispatchEvent(new Event('change',{bubbles:true}));
    return true;
  })()`);
  assert.equal(file, true);
  await run('wait', '--text', filename);
  await run('click', 'text=开始解析');
}

try {
  up = await run('up', '--mode', 'bundled', '--size', '1440x1000', '--no-build');
  await installKnowledgeForScenario(run);
  const session = await evaluate("window.electronAPI.invoke('api:get-port')");
  const name = 'E7 vector fault fixture';
  const response = await fetch(`http://127.0.0.1:${session.port}/api/v1/custom-api-onboarding/capabilities/models`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Token': session.token },
    body: JSON.stringify({ api_format: 'openai_embeddings', provider_name: name, display_name: name,
      base_url: `${fixture.baseUrl}/v1`, api_key: 'fixture-key', endpoint_model_id: 'embedding' }),
    signal: AbortSignal.timeout(20_000),
  });
  assert.ok(response.ok, await response.text());
  await run('reload');
  await run('click', '--selector', '[data-linnya-tooltip="设置"]');
  await run('click', 'text=模型配置');
  await run('scroll', '--selector', '.settings-modal-panel-body', '--dy', '800');
  await run('click', '--selector', '#embeddingModelSelect');
  const options = await evaluate(`([...document.querySelectorAll('.select-option')]
    .filter(node => node.textContent.trim() === ${JSON.stringify(name)} && node.getClientRects().length)
    .map(node => {const rect=node.getBoundingClientRect();return {x:rect.x+rect.width/2,y:rect.y+rect.height/2};}))`);
  assert.equal(options.length, 1);
  await run('click', '--at', `${Math.round(options[0].x)},${Math.round(options[0].y)}`);
  await run('click', '--selector', '.settings-modal-close');

  await evidence.check(`Qdrant ${kind}：真实上传失败、正常界面可用、停启后恢复`, async () => {
    if (kind === 'missing-binary') {
      const binary = join(repository, 'extraResources', 'bin', 'qdrant', 'mac-arm64', 'qdrant');
      const saved = join(up.root, 'qdrant-orig');
      await rename(binary, saved);
      restore = () => rename(saved, binary);
    } else {
      const root = join(up.root, 'workspace', 'Plugins', 'knowledge', 'qdrant');
      await mkdir(root, { recursive: true });
      const storage = join(root, 'storage');
      await writeFile(storage, 'fixture: storage path is not a directory', { flag: 'wx' });
      restore = () => rename(storage, join(up.root, 'fixture-invalid-qdrant-storage'));
    }
    await upload();
    await run('wait', '--selector', '.file-item .status-failed');
    const page = await evaluate("document.querySelector('.upload-tab').innerText");
    const before = await readFile(up.logs.desktop, 'utf8');
    const diagnostic = before.split('\n').filter(line => /向量服务未能启动|Qdrant binary not found|报告 HTTP listener 前退出/u.test(line));
    assert.ok(diagnostic.some(line => (kind === 'missing-binary' ? /Qdrant binary not found/u : /报告 HTTP listener 前退出/u).test(line)));
    evidence.json('visible-failure', { page, diagnostic });
    await run('shot');
    await restore();
    restore = undefined;
    await run('click', 'text=插件');
    const toggle = '.switch-control:has(input[aria-label="知识库 启用状态"])';
    await run('click', '--selector', toggle);
    await run('wait', '--selector', knowledgeSidebar, '--state', 'detached');
    await run('click', '--selector', toggle);
    await run('wait', '--selector', knowledgeSidebar);
    await upload();
    await run('wait', '--selector', '.file-item .status-completed');
    const db = new DatabaseSync(up.workspaceDb, { readOnly: true });
    try {
      assert.ok(db.prepare("SELECT 1 FROM kb_documents WHERE filename=? AND status='completed'").get(filename));
      assert.equal(db.prepare('PRAGMA quick_check').get().quick_check, 'ok');
    } finally { db.close(); }
    await run('shot');
    assert.match(page, /向量服务.*未能启动.*重新启用/u);
    assert.ok(!page.includes(up.root));
  });
} catch (error) {
  failure = error;
  if (!(error instanceof assert.AssertionError)) evidence.error(error);
} finally {
  if (failure && up) evidence.artifact(up.logs.desktop, 'desktop');
  try { await restore?.(); evidence.json('teardown', await test.finish({ clean: !failure })); }
  catch (error) { failure ??= error; evidence.error(error); }
  await fixture.close();
  console.log(JSON.stringify(evidence.finish()));
}
if (failure) throw failure;
