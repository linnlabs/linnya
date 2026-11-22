import assert from 'node:assert/strict';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { acceptance } from '../../development/features/desktop-probe/acceptance/probeAcceptance.mjs';
import { createEvidence } from '../../test-runner/features/acceptance-evidence/createEvidence.mjs';
import { startCustomCapabilityProtocolServer } from '../../../src/app-hosts/linnya/application/custom-api-onboarding/__tests__/fixtures/customCapabilityProtocolServer.ts';
import { clickNamed, installKnowledgeForScenario, knowledgeSidebar, openKnowledgeStoreDetail } from './knowledgeStore.fixture.mjs';

const kind = process.argv[2];
assert.ok(['missing-binary', 'invalid-storage'].includes(kind));
// Qdrant 是远程运行时组件：missing-binary 删除已安装组件的可执行文件。源码运行在组件不可用时会回退到
// extraResources 里的开发副本（正式安装包没有这一份），场景期间一并移走，否则回退会掩盖故障。
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
let restoreFallback;

const evaluate = async code => (await run('eval', code)).value;

function installedQdrant() {
  const root = join(up.root, 'user-data', 'runtimes', 'qdrant');
  const { version } = JSON.parse(readFileSync(join(root, 'active.json'), 'utf8'));
  const receipt = JSON.parse(readFileSync(join(root, '.receipts', `${version}.json`), 'utf8'));
  return { version, executable: join(root, version, 'qdrant'), receipt };
}

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
      const fallback = join(repository, 'extraResources', 'bin', 'qdrant', 'mac-arm64', 'qdrant');
      const savedFallback = join(up.root, 'qdrant-development-fallback');
      await rename(fallback, savedFallback);
      restoreFallback = () => rename(savedFallback, fallback);
      const component = installedQdrant();
      evidence.json('installed-runtime-before-fault', component);
      // 用户侧的典型损坏：组件文件被删除或被安全软件隔离；恢复走产品提示的重新安装，不把原文件放回去。
      await rename(component.executable, join(up.root, 'qdrant-removed-by-fault'));
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
    const diagnostic = before.split('\n').filter(line => /向量服务未能启动|Qdrant 运行时未安装|Qdrant binary not found|报告 HTTP listener 前退出/u.test(line));
    assert.ok(diagnostic.some(line => (kind === 'missing-binary' ? /Qdrant 运行时未安装/u : /报告 HTTP listener 前退出/u).test(line)));
    evidence.json('visible-failure', { page, diagnostic });
    await run('shot');
    if (kind === 'missing-binary') {
      // 按提示重新安装：卸载保留数据后从商店安装，插件与已装好的部分不重复下载，只补齐缺失的运行时组件。
      await openKnowledgeStoreDetail(run);
      await clickNamed(run, 'button', '卸载', 'main');
      await clickNamed(run, 'button', '卸载', '.modal-overlay--alert');
      await run('wait', '--selector', knowledgeSidebar, '--state', 'detached');
      await run('wait', '--text', '已卸载，保留数据');
      await clickNamed(run, 'button', '安装', 'main');
      await run('wait', '--selector', knowledgeSidebar, '--timeout', '60000');
      const repaired = installedQdrant();
      assert.ok(existsSync(repaired.executable), 'reinstall must restore the runtime component executable');
      evidence.json('installed-runtime-after-repair', repaired);
    } else {
      await restore();
      restore = undefined;
      await run('click', 'text=插件');
      const toggle = '.switch-control:has(input[aria-label="知识库 启用状态"])';
      await run('click', '--selector', toggle);
      await run('wait', '--selector', knowledgeSidebar, '--state', 'detached');
      await run('click', '--selector', toggle);
      await run('wait', '--selector', knowledgeSidebar);
    }
    await upload();
    await run('wait', '--selector', '.file-item .status-completed');
    const db = new DatabaseSync(up.workspaceDb, { readOnly: true });
    try {
      assert.ok(db.prepare("SELECT 1 FROM kb_documents WHERE filename=? AND status='completed'").get(filename));
      assert.equal(db.prepare('PRAGMA quick_check').get().quick_check, 'ok');
    } finally { db.close(); }
    await run('shot');
    assert.match(page, kind === 'missing-binary' ? /重新安装知识库/u : /向量服务.*未能启动.*重新启用/u);
    assert.ok(!page.includes(up.root));
  });
} catch (error) {
  failure = error;
  if (!(error instanceof assert.AssertionError)) evidence.error(error);
} finally {
  if (failure && up) evidence.artifact(up.logs.desktop, 'desktop');
  try {
    await restore?.();
    await restoreFallback?.();
    evidence.json('teardown', await test.finish({ clean: !failure }));
  }
  catch (error) { failure ??= error; evidence.error(error); }
  await fixture.close();
  console.log(JSON.stringify(evidence.finish()));
}
if (failure) throw failure;
