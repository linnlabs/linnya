import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { acceptance } from '../../development/features/desktop-probe/acceptance/probeAcceptance.mjs';
import { createEvidence } from '../../test-runner/features/acceptance-evidence/createEvidence.mjs';
import { startCustomCapabilityProtocolServer } from '../../../src/app-hosts/linnya/application/custom-api-onboarding/__tests__/fixtures/customCapabilityProtocolServer.ts';

// 正式 Desktop/Worker/Qdrant + 回环模型协议 fixture；不宣称上游供应商质量或连通性。
const fixture = await startCustomCapabilityProtocolServer();
const evidence = createEvidence('knowledge-index-rebuild', {
  files: [
    'scripts/e2e/knowledge-index/desktop.acceptance.mjs',
    'src/app-hosts/linnya/application/custom-api-onboarding/__tests__/fixtures/customCapabilityProtocolServer.ts',
  ],
});
const test = acceptance(process.env.KNOWLEDGE_PROBE_NAME || `knowledge-index-${process.pid}`, {
  evidence,
});
const { run } = test;
const json = JSON.stringify;
const evaluate = async code => (await run('eval', `(async()=>{${code}})()`)).value;
const kbCall = async (channel, payload = {}) => {
  const result = await evaluate(
    `return window.electronAPI['plugin:invoke']('knowledge',${json(channel)},${json(payload)});`
  );
  assert.equal(result.success, true, JSON.stringify(result.error));
  return result.data;
};
async function api(route, options = {}) {
  const session = await evaluate("return window.electronAPI.invoke('api:get-port');");
  const response = await fetch(`http://127.0.0.1:${session.port}${route}`, {
    ...options,
    headers: {
      'X-API-Token': session.token,
      ...(options.json ? { 'content-type': 'application/json' } : {}),
    },
    body: options.json ? json(options.json) : options.body,
    signal: AbortSignal.timeout(60_000),
  });
  const result = await response.json();
  assert.equal(response.ok, true, `${route}: ${json(result)}`);
  return result;
}
async function until(action, predicate, message, timeout = 30_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await action();
    if (predicate(value)) return value;
    await delay(150);
  }
  assert.fail(message);
}
let database;
let up;
let kbId;
let modelId;
let sourceBytes;
let sourcePath;
const state = () =>
  database.prepare('SELECT embedding_space_id FROM knowledge_bases WHERE id=?').get(kbId)
    .embedding_space_id;
const documents = () =>
  database.prepare('SELECT id,status FROM kb_documents WHERE kb_id=? ORDER BY id').all(kbId);
const status = () => kbCall('index-rebuild-status', { kbId });
const search = id =>
  kbCall('search', {
    kbId: id,
    request: {
      query: 'apple',
      useReranking: false,
      embeddingModelId: modelId,
    },
  });
async function terminal() {
  return until(status, value => value && value.status !== 'running', '重建任务没有结束');
}
async function beginThroughUi() {
  const previous = (await status())?.taskId;
  await run('click', 'text=重建检索索引');
  await run('wait', '--text', 'Knowledge embedding fixture');
  await run('shot');
  await run('click', 'text=开始重建');
  await until(status, value => value && value.taskId !== previous, 'UI未提交新重建任务');
}
let failed;
try {
  up = await run('up', '--size', '1440x1100', '--mode', 'dev');
  evidence.json('candidate', {
    gitHead: up.gitHead,
    build: up.build,
    protocol: 'official synthetic HTTP fixture',
  });
  database = new DatabaseSync(up.workspaceDb, { readOnly: true });
  const request = {
    api_format: 'openai_embeddings',
    provider_name: 'Knowledge embedding fixture',
    base_url: `${fixture.baseUrl}/v1`,
    api_key: 'fixture-key',
    endpoint_model_id: 'embedding-v1',
    display_name: 'Knowledge embedding fixture',
  };
  const registered = await api('/api/v1/custom-api-onboarding/capabilities/models', {
    method: 'POST',
    json: request,
  });
  modelId = registered.model_id;
  assert.ok(modelId);
  // 刷新正式目录并从用户可见的用途选择器绑定，不依赖开发源码模块。
  await run('reload');
  await run('wait', '--selector', '[data-linnya-tooltip="设置"]');
  await run('click', '--selector', '[data-linnya-tooltip="设置"]');
  await run('click', 'text=模型配置');
  await run('scroll', '--selector', '.settings-modal-panel-body', '--dy', '800');
  await run('click', '--selector', '#embeddingModelSelect');
  const options = await evaluate(`return [...document.querySelectorAll('.select-option')]
    .filter(node => node.textContent.trim() === 'Knowledge embedding fixture' && node.getClientRects().length)
    .map(node => {const rect=node.getBoundingClientRect();return {x:rect.x+rect.width/2,y:rect.y+rect.height/2};});`);
  assert.equal(options.length, 1, 'Expected one visible embedding choice');
  await run('click', '--at', `${Math.round(options[0].x)},${Math.round(options[0].y)}`);
  await run('click', '--selector', '.settings-modal-close');
  kbId = (await kbCall('create', { name: 'Knowledge rebuild fixture' })).id;
  assert.equal(
    readFileSync(up.logs.desktop, 'utf8').includes('[QdrantManager] Starting'),
    false,
    '列表/模型配置启动了向量进程'
  );
  await evidence.check('真实摄入完成并由Qdrant召回，原文与向量身份持久化', async () => {
    // 独立段落确保重建有多个批次，覆盖首次成功后的失败与取消。
    const markdown = Array.from(
      { length: 65 },
      (_, index) =>
        `## Apple section ${index}\n\nApple orchard ${index}. ${'Fresh apples grow on trees. '.repeat(25)}`
    ).join('\n\n');
    const form = new FormData();
    form.append('kbId', kbId);
    form.append('embedding_model_id', modelId);
    form.append('file', new Blob([markdown], { type: 'text/markdown' }), 'apple-orchard.md');
    await api('/api/v1/plugins/knowledge/documents/upload', { method: 'POST', body: form });
    await until(
      async () => documents(),
      values => values.length === 1 && values[0].status === 'completed',
      '真实Worker摄入未完成',
      60_000
    );
    const doc = documents()[0];
    sourcePath = join(
      up.root,
      'workspace',
      'KnowledgeBase',
      'source_of_truth',
      `${doc.id}.source.json`
    );
    sourceBytes = readFileSync(sourcePath);
    assert.match(state(), /^embedding-space:v1:/);
    const result = await search(kbId);
    assert.ok(result.results.some(item => item.docId === doc.id));
    evidence.json('initial-ingestion', { documents: documents(), spaceId: state(), result });
  });
  await run('click', 'text=知识库');
  await run('wait', '--text', 'Knowledge rebuild fixture');
  await run('click', 'text=Knowledge rebuild fixture');
  await run('click', 'text=文件管理');
  await run('wait', '--text', 'apple-orchard.md');
  await evidence.check('变更模型真实路由后拒绝旧向量，UI重建完成且原文不变', async () => {
    const oldSpace = state();
    const model = (await api('/api/v1/models')).models.find(item => item.id === modelId);
    await api(`/api/v1/models/${encodeURIComponent(modelId)}`, {
      method: 'PUT',
      json: {
        model_name: 'embedding-v2',
        embedding_route: { ...model.embedding_route, endpoint_model_id: 'embedding-v2' },
      },
    });
    const requestsBefore = fixture.requests.length;
    await assert.rejects(search(kbId), /重建|mismatch|来源/);
    assert.equal(fixture.requests.length, requestsBefore, '旧索引拒绝应发生在模型网络调用前');
    assert.deepEqual(readFileSync(sourcePath), sourceBytes);
    await beginThroughUi();
    const result = await terminal();
    assert.equal(result.status, 'completed', json(result));
    assert.notEqual(state(), oldSpace);
    assert.deepEqual(readFileSync(sourcePath), sourceBytes);
    assert.ok((await search(kbId)).results.length > 0);
    await run('shot');
    evidence.json('completed-rebuild', result);
  });
  await evidence.check('首批上游失败不破坏原有可用索引', async () => {
    const oldSpace = state();
    fixture.setFailure('unauthorized');
    await beginThroughUi();
    const failure = await terminal();
    assert.equal(failure.status, 'failed');
    assert.match(failure.message, /密钥/);
    assert.ok(!failure.message.includes('provider_http_401'));
    assert.equal(state(), oldSpace);
    assert.deepEqual(readFileSync(sourcePath), sourceBytes);
    fixture.setFailure('none');
    assert.ok((await search(kbId)).results.length > 0);
  });
  await evidence.check('实际第二批请求失败保留原文和不可用标记，显式重试恢复', async () => {
    fixture.setDelay(300, '/v1/embeddings');
    const before = fixture.requests.length;
    await beginThroughUi();
    await until(
      async () => fixture.requests.length,
      count => count >= before + 2,
      '第二批嵌入请求未发出'
    );
    fixture.setFailure('unauthorized');
    assert.equal((await terminal()).status, 'failed');
    assert.equal(state(), null);
    assert.deepEqual(readFileSync(sourcePath), sourceBytes);
    fixture.setFailure('none');
    fixture.setDelay(0);
    await kbCall('rebuild-index', { kbId, modelId });
    assert.equal((await terminal()).status, 'completed');
    assert.ok((await search(kbId)).results.length > 0);
  });
  await evidence.check('多批次重建取消留下明确不可用身份，重启后显式重试恢复', async () => {
    fixture.setDelay(500, '/v1/embeddings');
    const before = fixture.requests.length;
    await beginThroughUi();
    await until(
      async () => fixture.requests.length,
      count => count >= before + 2,
      '第二批嵌入请求未发出'
    );
    assert.equal(state(), null);
    const current = await status();
    await kbCall('cancel-task', { taskId: current.taskId });
    assert.equal((await terminal()).status, 'cancelled');
    const after = fixture.requests.length;
    await delay(700);
    assert.equal(fixture.requests.length, after, '取消后仍发起嵌入批次');
    assert.deepEqual(readFileSync(sourcePath), sourceBytes);
    await assert.rejects(search(kbId), /重建|不可用/);
    fixture.setDelay(0);
    database.close();
    up = await run('restart');
    database = new DatabaseSync(up.workspaceDb, { readOnly: true });
    assert.equal(state(), null);
    assert.deepEqual(readFileSync(sourcePath), sourceBytes);
    await kbCall('rebuild-index', { kbId, modelId });
    assert.equal((await terminal()).status, 'completed');
    assert.ok((await search(kbId)).results.length > 0);
    assert.deepEqual(readFileSync(sourcePath), sourceBytes);
  });
} catch (error) {
  failed = error;
  evidence.error(error);
  try {
    await run('shot');
  } catch {
    /* 首个错误由证据保留。 */
  }
} finally {
  database?.close();
  await fixture.close();
  try {
    evidence.json('cleanup', await test.finish({ clean: !failed }));
  } catch (error) {
    failed ||= error;
    evidence.error(error);
  }
  console.log(JSON.stringify(evidence.finish()));
}
if (failed) throw failed;
