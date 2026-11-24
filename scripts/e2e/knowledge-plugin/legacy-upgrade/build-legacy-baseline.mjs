import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { launchInstalledDesktop, until } from '../windows/installedDesktopSession.mjs';
import { HASHING_EMBEDDING_DIMENSION, startHashingEmbeddingFixture } from './hashingEmbeddingFixture.mjs';
import { readInstalledApp } from './installedApp.mjs';

/**
 * 用已发布的旧版 App（知识库仍在核心里）生成真实旧资料：旧核心表、旧 KnowledgeBase 目录与 Qdrant 集合。
 * 只经旧版正式 HTTP 接口建库、上传与检索；嵌入请求发往本机回环端点，不需要服务商密钥。
 *
 *   --app <可执行文件> --expect-version <x.y.z>   生成资料的旧版
 *   --legacy-ingestion none|completes|crashes       none：只建库（0.2.x 用户界面能做到的全部——林芽云不提供模型、也没有自定义嵌入入口，
 *                                                   界面在没有嵌入模型时拒绝上传）；completes/crashes：经接口强行上传，
 *                                                   正式 0.2.x 的摄入 worker 会令后台退出（crashes），用于验证新版对残留记录的收尾
 *   --then-app <可执行文件> --then-expect-version  可选：用户随后自动更新到的旧版，在同一 profile 启动一次再正常退出
 *   --out <新目录>
 */
const { values } = parseArgs({ options: {
  app: { type: 'string' }, 'expect-version': { type: 'string' },
  'legacy-ingestion': { type: 'string', default: 'completes' },
  'then-app': { type: 'string' }, 'then-expect-version': { type: 'string' },
  out: { type: 'string' },
} });
const out = path.resolve(values.out ?? '');
assert.ok(values.out && !existsSync(out), '--out 必须是尚不存在的目录');
assert.ok(['none', 'completes', 'crashes'].includes(values['legacy-ingestion']), '--legacy-ingestion none|completes|crashes');
const ingestion = values['legacy-ingestion'];

function legacyApp(executableOption, versionOption, label) {
  const executable = path.resolve(executableOption ?? '');
  assert.ok(executableOption && existsSync(executable), `${label} 可执行文件必须存在`);
  assert.match(versionOption ?? '', /^\d+\.\d+\.\d+$/u, `${label} 需要 x.y.z 版本`);
  return { executable, expectedVersion: versionOption };
}
const creator = legacyApp(values.app, values['expect-version'], '--app');
const follower = values['then-app'] ? legacyApp(values['then-app'], values['then-expect-version'], '--then-app') : null;

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const documents = [
  { filename: 'orchard-apples.md', marker: 'legacy-orchard-marker',
    text: '# Orchard notes\n\nThe old orchard grows crisp apple trees. Apple harvest starts in autumn.\nlegacy-orchard-marker\n' },
  { filename: 'harbor-boats.md', marker: 'legacy-harbor-marker',
    text: '# Harbor notes\n\nFishing boats leave the harbor at dawn with nets and lanterns.\nlegacy-harbor-marker\n' },
];
const query = 'apple orchard harvest';
const knowledgeBaseName = 'Legacy orchard library';

async function launchLegacy(app, label) {
  const actualVersion = readInstalledApp(app.executable).version;
  assert.equal(actualVersion, app.expectedVersion, `${label} bundle version`);
  const application = await launchInstalledDesktop(app.executable, path.join(out, 'session'));
  sessions.push({ label, application });
  assert.match(application.log, /\[Distribution\] kind=official/u, `${label} must run as the official build`);
  return { application, version: actualVersion, executableSha256: sha256(await readFile(app.executable)) };
}

async function upload(application, kbId, modelId, document) {
  const form = new FormData();
  // 旧版界面只附带已配置用途的模型。0.2.x 的 worker 回报只要遇到未配置用途（undefined 字段）就校验失败并令后台退出，
  // 能在旧版建成索引的只有把各用途都配齐的用户；这里按这种配置上传，生成最完整的旧索引。
  for (const field of ['embedding_model_id', 'rerank_model_id', 'pdf_ocr_model_id', 'image_vision_model_id', 'graph_extraction_model_id']) {
    form.append(field, modelId);
  }
  form.append('file', new Blob([document.text], { type: 'text/markdown' }), document.filename);
  const session = await application.invoke('invoke', 'api:get-port');
  const response = await fetch(`http://127.0.0.1:${session.port}/api/v1/knowledge-base/${kbId}/documents`, {
    method: 'POST', headers: { 'X-API-Token': session.token }, body: form, signal: AbortSignal.timeout(120_000),
  });
  const result = await response.json();
  assert.equal(response.status, 201, JSON.stringify(result));
  document.id = result.document.id;
  document.sha256 = sha256(Buffer.from(document.text));
}

async function search(application, kbId, modelId) {
  return application.api(`/api/v1/knowledge-base/${kbId}/search`, { method: 'POST', json: {
    query, topK: 5, useReranking: false, embeddingModelId: modelId,
  } });
}

await mkdir(path.join(out, 'evidence'), { recursive: true });
const fixture = await startHashingEmbeddingFixture({ apiKey: `legacy-fixture-${randomBytes(12).toString('hex')}` });
const sessions = [];
const record = { schemaVersion: 1, platform: `${process.platform}-${process.arch}`, legacyIngestion: ingestion, apps: [] };
try {
  const created = await launchLegacy(creator, 'creator');
  const { application } = created;
  record.apps.push({ role: 'creator', version: created.version, executableSha256: created.executableSha256 });

  if (ingestion === 'none') {
    const library = await application.api('/api/v1/knowledge-base', { method: 'POST', json: { name: knowledgeBaseName } });
    const kbId = library.knowledge_base.id;
    const listed = await application.api('/api/v1/knowledge-base');
    assert.ok(listed.knowledge_bases.some(item => item.id === kbId));
    await application.screenshot(path.join(out, 'evidence', 'legacy-creator.png'));
    await application.stop();
    assert.equal(application.child.exitCode, 0, 'legacy app must exit normally');
    record.apps[0].exitCode = application.child.exitCode;
    await writeFile(path.join(out, 'baseline.json'), `${JSON.stringify({
      ...record,
      createdAt: new Date().toISOString(),
      session: { profile: 'session/profile', workspace: 'session/workspace' },
      fixture: { apiKey: fixture.apiKey, port: fixture.port, dimension: HASHING_EMBEDDING_DIMENSION },
      embeddingModelId: null,
      knowledgeBase: { id: kbId, name: knowledgeBaseName },
      documents: [],
      query,
      expectedTopDocumentId: null,
      legacyEmbeddedInputs: 0,
    }, null, 2)}\n`);
    console.log(`legacy baseline ready: ${out}`);
  } else {
  const registered = await application.api('/api/v1/custom-api-onboarding/models', { method: 'POST', json: {
    provider_name: 'Legacy upgrade fixture', api_format: 'openai_compatible', base_url: fixture.url, api_key: fixture.apiKey,
    endpoint_model_id: 'legacy-hash-embedding', display_name: 'Legacy hash embedding',
    context_window_tokens: 8192, max_output_tokens: 1024, supports_image_input: false,
  } });
  const modelId = registered.model_id;
  const { models } = await application.api('/api/v1/models');
  const model = models.find(item => item.id === modelId);
  assert.ok(model?.inference_route, 'registered custom model');
  // 旧版设置页按 capabilities 选择嵌入模型；用户模型的编辑接口接受嵌入角色与路由。
  await application.api(`/api/v1/models/${encodeURIComponent(modelId)}`, { method: 'PUT', json: {
    model_name: model.model_name,
    capabilities: [...new Set([...(model.capabilities ?? []), 'embedding'])],
    embedding_route: {
      api_surface: 'openai_embeddings', capability_id: 'ai-sdk:openai-compatible-embeddings',
      endpoint_id: model.inference_route.endpoint_id, endpoint_model_id: model.model_name,
      base_url: model.inference_route.base_url, auth_profile: 'bearer',
      usage: { response_usage: 'provider_reported_optional' },
    },
  } });

  const library = await application.api('/api/v1/knowledge-base', { method: 'POST', json: { name: knowledgeBaseName } });
  const kbId = library.knowledge_base.id;
  for (const document of documents) await upload(application, kbId, modelId, document);

  if (ingestion === 'completes') {
    const listed = await until(
      () => application.api(`/api/v1/knowledge-base/${kbId}/documents`).catch(error => {
        throw new Error(`legacy backend stopped during ingestion: ${(application.log.match(/(Cannot find module[^\n]*|ZodError)/u) ?? ['unknown'])[0]}`, { cause: error });
      }),
      value => documents.every(document => value.documents.some(item => item.id === document.id && ['completed', 'failed'].includes(item.status))),
      'legacy ingestion', 180_000,
    );
    for (const document of documents) {
      const row = listed.documents.find(item => item.id === document.id);
      assert.equal(row.status, 'completed', `${document.filename}: ${row.errorMessage ?? row.error_message ?? ''}`);
    }
    assert.ok(fixture.embeddedInputs() >= documents.length, 'legacy ingestion must embed document chunks');
    const searched = await search(application, kbId, modelId);
    assert.equal(searched.results[0]?.docId, documents[0].id, 'legacy search must rank the orchard note first');
    assert.ok(searched.results[0].text.includes(documents[0].marker));
  } else {
    // 记录旧版真实失败方式：摄入 worker 缺模块，失败回报又令后台进程退出，文档停在 pending。
    await until(() => Promise.resolve(application.log), log => /Cannot find module/u.test(log), 'legacy ingestion worker failure', 60_000);
    await delay(2_000);
  }
  await application.screenshot(path.join(out, 'evidence', 'legacy-creator.png'));
  await application.stop();
  record.apps[0].exitCode = application.child.exitCode;
  if (ingestion === 'completes') assert.equal(application.child.exitCode, 0, 'legacy app must exit normally');
  assert.ok(existsSync(path.join(application.workspace, 'KnowledgeBase')), 'legacy KnowledgeBase directory');
  let embeddingModelRemoved = false;
  if (ingestion === 'crashes') {
    // 0.2.x 只有林芽云目录提供嵌入模型（云端模型不写入本机用户目录）；本地 provider 只是驱动旧版接受上传。
    // 像用户那样在崩溃后重开旧版，移除这个临时 provider，留下与真实用户相同的本机资料：旧库 + 停在 pending 的文档。
    const reopened = await launchLegacy(creator, 'creator-reopened');
    const listed = await reopened.application.api(`/api/v1/knowledge-base/${kbId}/documents`);
    for (const document of documents) {
      assert.equal(listed.documents.find(item => item.id === document.id)?.status, 'pending', 'legacy crash leaves documents pending');
    }
    const removed = await reopened.application.api('/api/v1/custom-api-onboarding/providers', {
      method: 'DELETE', json: { provider_name: 'Legacy upgrade fixture' },
    });
    assert.deepEqual(removed.removed_model_ids, [modelId]);
    embeddingModelRemoved = true;
    await reopened.application.stop();
    assert.equal(reopened.application.child.exitCode, 0, 'reopened legacy app must exit normally');
  }

  if (follower) {
    // 用户随后自动更新到下一旧版：同一 profile 启动、读取旧库后正常退出，让该版本自己的迁移落盘。
    const followed = await launchLegacy(follower, 'follower');
    const listed = await followed.application.api(`/api/v1/knowledge-base/${kbId}/documents`);
    assert.deepEqual(documents.map(document => listed.documents.some(item => item.id === document.id)), documents.map(() => true));
    if (ingestion === 'completes') {
      const searched = await search(followed.application, kbId, modelId);
      assert.equal(searched.results[0]?.docId, documents[0].id, 'follower must still read the legacy index');
    }
    await followed.application.screenshot(path.join(out, 'evidence', 'legacy-follower.png'));
    await followed.application.stop();
    assert.equal(followed.application.child.exitCode, 0, 'follower legacy app must exit normally');
    record.apps.push({ role: 'follower', version: followed.version, executableSha256: followed.executableSha256 });
  }
  assert.deepEqual(fixture.errors, []);

  await writeFile(path.join(out, 'baseline.json'), `${JSON.stringify({
    ...record,
    createdAt: new Date().toISOString(),
    session: { profile: 'session/profile', workspace: 'session/workspace' },
    fixture: { apiKey: fixture.apiKey, port: fixture.port, dimension: HASHING_EMBEDDING_DIMENSION },
    embeddingModelId: embeddingModelRemoved ? null : modelId,
    legacyEmbeddingModelId: modelId,
    knowledgeBase: { id: kbId, name: knowledgeBaseName },
    documents: documents.map(document => ({ filename: document.filename, marker: document.marker, id: document.id, sha256: document.sha256 })),
    query,
    expectedTopDocumentId: ingestion === 'completes' ? documents[0].id : null,
    legacyEmbeddedInputs: fixture.embeddedInputs(),
  }, null, 2)}\n`);
  console.log(`legacy baseline ready: ${out}`);
  }
} finally {
  for (const { label, application } of sessions) {
    await writeFile(path.join(out, 'evidence', `legacy-${label}.log`), application.log.replaceAll(fixture.apiKey, '[fixture key]'));
    if (application.child.exitCode === null && application.child.signalCode === null) await application.stop().catch(() => {});
  }
  await fixture.stop();
}
