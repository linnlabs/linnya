import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { acceptance } from '../../development/features/desktop-probe/acceptance/probeAcceptance.mjs';
import { createEvidence } from '../../test-runner/features/acceptance-evidence/createEvidence.mjs';
import { clickNamed, knowledgeSidebar, openKnowledgeStoreDetail } from './knowledgeStore.fixture.mjs';
import { startHashingEmbeddingFixture } from './legacy-upgrade/hashingEmbeddingFixture.mjs';

/**
 * 真实旧版升级：已发布旧版（知识库在核心里）产生的 profile 与 Workspace，交给当前源码 Host 启动。
 * 旧资料由 legacy-upgrade/build-legacy-baseline.mjs 用正式旧版 App 生成；这里只复制，不改原件。
 *
 * - none：0.2.x 用户能留下的全部资料只是空知识库（没有可用的嵌入模型，界面拒绝上传）。不自动安装；
 *   用户从商店安装后旧库仍在，接入嵌入模型后往旧库上传与检索可用（旧版按默认维度预建的空集合须重建）。
 * - crashes：经接口强行上传后旧版后台退出，文档停在 pending。必须自动安装、把残留记录变为可理解的失败。
 * - completes：已建索引的旧库（正式版本产生不了，只覆盖源码构建等资料）。接管后不重发嵌入、检索可用。
 */
const baselineRoot = resolve(process.argv[2] ?? '');
const baseline = JSON.parse(readFileSync(join(baselineRoot, 'baseline.json'), 'utf8'));
assert.equal(baseline.schemaVersion, 1);
assert.equal(baseline.platform, `${process.platform}-${process.arch}`, 'baseline must come from this platform');
assert.ok(['none', 'completes', 'crashes'].includes(baseline.legacyIngestion));
const indexed = baseline.legacyIngestion === 'completes';
// 只有文档记录或原文才触发自动安装（插件声明的 userDataTables 为 kb_documents）。
const autoInstall = baseline.documents.length > 0;
process.env.LINNYA_PLUGIN_RENDERER_BUNDLE = 'disk';

const evidence = createEvidence('knowledge-legacy-upgrade', { files: [
  'scripts/e2e/knowledge-plugin/legacy-upgrade.acceptance.mjs',
  'scripts/e2e/knowledge-plugin/legacy-upgrade/hashingEmbeddingFixture.mjs',
  'scripts/e2e/knowledge-plugin/legacy-upgrade/build-legacy-baseline.mjs',
  'scripts/e2e/knowledge-plugin/knowledgeStore.fixture.mjs',
] });
evidence.json('baseline', baseline);
const test = acceptance(`knowledge-legacy-upgrade-${process.pid}`, { evidence });
const { run } = test;
const start = () => run('up', '--mode', 'bundled', '--size', '1440x1000', '--no-build');
const json = JSON.stringify;
const evaluate = async code => (await run('eval', `(async()=>{${code}})()`)).value;
const api = (route, { method = 'GET', body } = {}) => evaluate(`const session=await window.electronAPI.invoke('api:get-port');
  const response=await fetch('http://127.0.0.1:'+session.port+${json(route)},{method:${json(method)},headers:{'X-API-Token':session.token,'content-type':'application/json'}${body === undefined ? '' : `,body:${json(JSON.stringify(body))}`}});
  const result=await response.json();if(!response.ok)throw new Error(response.status+': '+JSON.stringify(result));return result;`);
const invoke = (channel, payload = {}) => evaluate(`const result=await window.electronAPI['plugin:invoke']('knowledge',${json(channel)},${json(payload)});if(!result.success)throw new Error(JSON.stringify(result));return result.data;`);
// 升级后在旧库里新上传的样本；与旧版基线使用同一段文本，检索词相同。
const UPLOAD = { filename: 'orchard-apples.md', marker: 'legacy-orchard-marker',
  text: '# Orchard notes\n\nThe old orchard grows crisp apple trees. Apple harvest starts in autumn.\nlegacy-orchard-marker\n' };
const fixture = await startHashingEmbeddingFixture({ apiKey: baseline.fixture.apiKey, port: baseline.fixture.port });
let failed;

function seedLegacySession(root) {
  const profile = join(baselineRoot, baseline.session.profile);
  const workspace = join(baselineRoot, baseline.session.workspace);
  for (const target of ['user-data', 'workspace', 'plugins']) rmSync(join(root, target), { recursive: true, force: true });
  // 正式包的插件目录在 profile/plugins；探针用独立 LINNYA_PLUGIN_ROOT，按同一内容放到对应位置。
  cpSync(profile, join(root, 'user-data'), { recursive: true, filter: source => source !== join(profile, 'plugins') });
  if (existsSync(join(profile, 'plugins'))) cpSync(join(profile, 'plugins'), join(root, 'plugins'), { recursive: true });
  cpSync(workspace, join(root, 'workspace'), { recursive: true });
}

function readInstallState(up) {
  const db = new DatabaseSync(up.workspaceDb, { readOnly: true });
  try {
    return {
      knowledge: db.prepare("SELECT installed, user_removed FROM installed_plugins WHERE plugin_id='knowledge'").get() ?? null,
      documents: db.prepare('SELECT id, filename, status FROM kb_documents ORDER BY filename').all().map(row => ({ ...row })),
    };
  } finally { db.close(); }
}

function treeDigest(root) {
  const hash = createHash('sha256');
  const walk = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile()) hash.update(entry.name).update(readFileSync(file));
    }
  };
  walk(root);
  return hash.digest('hex');
}

async function searchLegacy() {
  return invoke('search', { kbId: baseline.knowledgeBase.id, request: {
    query: baseline.query, topK: 5, useReranking: false, embeddingModelId: baseline.embeddingModelId,
  } });
}

try {
  const baselineDigest = treeDigest(baselineRoot);
  const fresh = await start();
  await run('stop');
  seedLegacySession(fresh.root);
  const upgradeStarted = Date.now();
  let searches = 0;

  await evidence.check(autoInstall
    ? '旧版资料启动新版：后台从已验签 catalog 安装知识库与 Qdrant 运行时，默认启用'
    : '只有空知识库：不自动下载；商店显示早期版本资料，用户安装后从已验签 catalog 装好知识库与 Qdrant 运行时', async () => {
    const upgraded = await start();
    if (!autoInstall) {
      assert.equal(readInstallState(upgraded).knowledge, null, 'empty legacy libraries must not trigger a download');
      assert.equal(existsSync(join(upgraded.root, 'user-data', 'runtimes', 'qdrant')), false);
      await run('wait', '--selector', knowledgeSidebar, '--state', 'detached');
      await openKnowledgeStoreDetail(run, true);
      await run('wait', '--text', '早期版本遗留数据', '--timeout', '30000');
      await run('shot');
      await clickNamed(run, 'button', '安装', 'main');
    }
    await run('wait', '--selector', knowledgeSidebar, '--timeout', '60000');
    const state = readInstallState(upgraded);
    assert.equal(state.knowledge?.installed, 1);
    assert.equal(state.knowledge?.user_removed, 0);
    assert.ok(existsSync(join(upgraded.root, 'plugins', 'knowledge', 'active.json')));
    const { value: listing } = await run('eval', 'window.electronAPI.plugins.list()');
    const knowledge = listing.data.find(item => item.meta.id === 'knowledge');
    assert.equal(knowledge?.state, 'enabled');
    assert.notEqual(knowledge?.runtimeUnavailable, true, json(knowledge));
    const runtimes = join(upgraded.root, 'user-data', 'runtimes', 'qdrant');
    assert.ok(existsSync(runtimes), 'Qdrant runtime component installed under the profile');
    evidence.json('upgrade-install-state', { state, knowledge, runtimes: readdirSync(runtimes) });
  });

  await evidence.check('旧版模型目录在新版正常加载（任何一个用户模型被拒都会让全部模型不可用）', async () => {
    const { models } = await api('/api/v1/models');
    if (baseline.embeddingModelId) assert.ok(models.some(model => model.id === baseline.embeddingModelId), json(models.map(model => model.id)));
    evidence.json('models-after-upgrade', models.map(model => ({ id: model.id, capabilities: model.capabilities })));
  });

  await evidence.check(indexed
    ? '旧库、旧文档与原文被接管：同一 id、状态完成，未重新嵌入文档'
    : autoInstall
      ? '旧库与旧文档记录被接管：同一 id；旧版崩溃留下的处理中文档变为可理解的失败状态'
      : '旧库被接管：同一 id 与名称', async () => {
    const libraries = await invoke('list');
    const library = libraries.find(item => item.id === baseline.knowledgeBase.id);
    assert.equal(library?.name, baseline.knowledgeBase.name, json(libraries));
    const documents = await invoke('list-documents', { kbId: baseline.knowledgeBase.id });
    evidence.json('legacy-documents-after-upgrade', documents);
    for (const expected of baseline.documents) {
      const row = documents.find(item => item.id === expected.id);
      assert.equal(row?.filename, expected.filename, json(documents));
      if (indexed) {
        assert.equal(row.status, 'completed');
        assert.equal(row.hasSource, true, `${expected.filename} original must be kept`);
      } else {
        // 旧版没有保存原文就退出了：不能永远显示处理中，要给出失败原因，让用户删除后重新上传。
        assert.equal(row.status, 'failed', `${expected.filename}: ${row.status}`);
        assert.equal(row.hasSource, false);
        assert.match(row.errorMessage ?? '', /重新上传/u, json(row));
      }
    }
    assert.equal(fixture.embeddedInputs(upgradeStarted), 0, 'upgrade must not re-embed legacy documents');
  });

  if (indexed) {
    await evidence.check('新版检索旧索引：查询只嵌入一次，命中旧版排序第一的文档', async () => {
      const found = await searchLegacy();
      searches += 1;
      assert.equal(found.results[0]?.docId, baseline.expectedTopDocumentId, json(found.results.map(item => item.docId)));
      assert.ok(found.results[0].text.includes(baseline.documents[0].marker));
      assert.equal(fixture.embeddedInputs(upgradeStarted), searches, 'only the query is embedded');
    });
  } else {
    await evidence.check('接管后的旧库可继续使用：在新版接入嵌入模型、上传完成，检索命中', async () => {
      // 0.2.x 没有可用的嵌入模型；用户在新版设置里接入一个，维度与旧版预建的空集合不同。
      const registered = await api('/api/v1/custom-api-onboarding/capabilities/models', { method: 'POST', body: {
        api_format: 'openai_embeddings', provider_name: 'Upgrade embedding fixture', display_name: 'Upgrade embedding fixture',
        base_url: fixture.url, api_key: fixture.apiKey, endpoint_model_id: 'legacy-hash-embedding',
      } });
      baseline.embeddingModelId = registered.model_id;
      // 失败且无内容的记录也可能被后台一致性维护先行清掉；仍在的从正式删除入口移除。
      const remaining = await invoke('list-documents', { kbId: baseline.knowledgeBase.id });
      for (const expected of baseline.documents) {
        if (remaining.some(row => row.id === expected.id)) await invoke('delete-document', { kbId: baseline.knowledgeBase.id, docId: expected.id });
      }
      assert.deepEqual((await invoke('list-documents', { kbId: baseline.knowledgeBase.id })).filter(row => baseline.documents.some(item => item.id === row.id)), []);
      const uploaded = await evaluate(`const session=await window.electronAPI.invoke('api:get-port');
        const form=new FormData();form.append('kbId',${json(baseline.knowledgeBase.id)});form.append('embedding_model_id',${json(baseline.embeddingModelId)});
        form.append('file',new File([${json(UPLOAD.text)}],${json(UPLOAD.filename)},{type:'text/markdown'}));
        const response=await fetch('http://127.0.0.1:'+session.port+'/api/v1/plugins/knowledge/documents/upload',{method:'POST',headers:{'X-API-Token':session.token},body:form});
        const body=await response.json();if(!response.ok)throw new Error(JSON.stringify(body));return body.document.id;`);
      for (let attempt = 0; ; attempt += 1) {
        const rows = await invoke('list-documents', { kbId: baseline.knowledgeBase.id });
        const row = rows.find(item => item.id === uploaded);
        assert.notEqual(row?.status, 'failed', json(row));
        if (row?.status === 'completed') break;
        assert.ok(attempt < 600, 're-upload ingestion timed out');
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      baseline.expectedTopDocumentId = uploaded;
      const before = fixture.embeddedInputs(upgradeStarted);
      const found = await searchLegacy();
      searches += 1;
      assert.equal(found.results[0]?.docId, uploaded);
      assert.ok(found.results[0].text.includes(UPLOAD.marker));
      assert.equal(fixture.embeddedInputs(upgradeStarted), before + 1, 'search embeds only the query');
    });
  }

  await evidence.check('用户界面：知识库页面显示旧库与其中的文档', async () => {
    await run('click', '--selector', knowledgeSidebar);
    await run('wait', '--text', baseline.knowledgeBase.name, '--timeout', '30000');
    await run('shot');
    await run('click', `text=${baseline.knowledgeBase.name}`);
    // 打开库后默认在“文件上传”；文档列表在“文件管理”。
    await run('click', 'text=文件管理');
    await run('wait', '--text', (baseline.documents[0] ?? UPLOAD).filename, '--timeout', '30000');
    await run('shot');
  });

  await evidence.check('重启后仍为已安装：Qdrant 从运行时组件重新启动，检索结果不变', async () => {
    await run('stop');
    const restarted = await start();
    await run('wait', '--selector', knowledgeSidebar, '--timeout', '60000');
    assert.equal(readInstallState(restarted).knowledge?.installed, 1);
    const before = fixture.embeddedInputs(upgradeStarted);
    const found = await searchLegacy();
    assert.equal(found.results[0]?.docId, baseline.expectedTopDocumentId);
    assert.equal(fixture.embeddedInputs(upgradeStarted), before + 1, 'restart must not re-embed documents');
    assert.deepEqual(fixture.errors, []);
  });

  await evidence.check('旧资料原件未被验收改动', async () => {
    assert.equal(treeDigest(baselineRoot), baselineDigest);
  });

  await evidence.check('旧版装过的随包插件在新版仍可用：同版本号不能换内容', async () => {
    const { value: listing } = await run('eval', 'window.electronAPI.plugins.list()');
    const slides = listing.data.find(item => item.meta.id === 'slides');
    const log = readFileSync(fresh.logs.desktop, 'utf8');
    const conflicts = log.split('\n').filter(line => line.includes('同版本 artifact 冲突'));
    evidence.json('bundled-plugins-after-upgrade', { slides: slides && { state: slides.state, version: slides.meta.version }, conflicts });
    assert.deepEqual(conflicts, [], 'a bundled plugin kept its version but changed content since the legacy release');
    assert.equal(slides?.state, 'enabled');
  });
} catch (error) {
  failed = error;
  if (!(error instanceof assert.AssertionError)) evidence.error(error);
} finally {
  try { evidence.json('teardown', await test.finish({ clean: !failed })); }
  catch (error) { failed ??= error; evidence.error(error); }
  await fixture.stop();
  evidence.json('fixture-requests', fixture.requests);
  console.log(JSON.stringify(evidence.finish()));
}
if (failed) throw failed;
