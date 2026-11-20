import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { cpus } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { observeTree } from '../../development/features/desktop-probe/infrastructure/processTree.mjs';
import { acceptance } from '../../development/features/desktop-probe/acceptance/probeAcceptance.mjs';
import { createEvidence } from '../../test-runner/features/acceptance-evidence/createEvidence.mjs';
import { startCustomCapabilityProtocolServer } from '../../../src/app-hosts/linnya/application/custom-api-onboarding/__tests__/fixtures/customCapabilityProtocolServer.ts';
import { MODEL_CONNECTION_TEST_PDF, MODEL_CONNECTION_TEST_PNG } from '../../../src/app-hosts/linnya/application/custom-api-onboarding/definitions/modelConnectionTestDocument.ts';

// bundled 明确走已有磁盘 Renderer 模式；未打包的 Host 默认仍偏好 Vite 源码。
const mode = process.env.KNOWLEDGE_PLUGIN_MODE || 'dev';
if (mode === 'bundled') process.env.LINNYA_PLUGIN_RENDERER_BUNDLE = 'disk';
// 真实磁盘 Backend、三条生产 Worker、Qdrant；只将模型供应商替换为官方协议合成服务。
const fixture = await startCustomCapabilityProtocolServer();
fixture.setChatResponse(request => {
  const text = request.messages.filter(item => item.role === 'user').map(item =>
    typeof item.content === 'string' ? item.content : item.content.filter(part => part.type === 'text').map(part => part.text).join('\n')).join('\n');
  const chunks = [...text.matchAll(/--- Chunk Start \(chunk_id: ([^)]+)\) ---\n([\s\S]*?)\n--- Chunk End ---/g)];
  if (!chunks.length) return 'Apple orchard grows fresh apples in Taiwan.';
  return JSON.stringify(chunks.map(([, id, source]) => ({
    chunk_id: id,
    entities: source.includes('Apple orchard') ? [
      { name: 'Apple orchard', type: 'ORGANIZATION', description: 'Synthetic fruit grower' },
      { name: 'Taiwan', type: 'CONCEPT', description: 'Synthetic cultivation location' },
    ] : [],
    edges: source.includes('Apple orchard') ? [{ source: 'Apple orchard', target: 'Taiwan', relation_type: 'LOCATED_AT',
      statement: 'Apple orchard grows fresh apples in Taiwan in spring.',
      evidence_quote: 'Apple orchard grows fresh apples in Taiwan in spring.', confidence: 0.95 }] : [],
  })));
});
const evidence = createEvidence('knowledge-plugin-production-workers', { files: [
  'scripts/e2e/knowledge-plugin/desktop.acceptance.mjs',
  'src/app-hosts/linnya/application/custom-api-onboarding/__tests__/fixtures/customCapabilityProtocolServer.ts',
  'src/app-hosts/linnya/application/custom-api-onboarding/definitions/modelConnectionTestDocument.ts',
] });
const test = acceptance(process.env.KNOWLEDGE_PROBE_NAME || `knowledge-plugin-${process.pid}`, { evidence });
const { run } = test;
const json = JSON.stringify;
const evaluate = async code => (await run('eval', `(async()=>{${code}})()`)).value;
const invoke = (channel, payload = {}) => evaluate(`const result=await window.electronAPI['plugin:invoke']('knowledge',${json(channel)},${json(payload)});if(!result.success)throw new Error(JSON.stringify(result));return result.data;`);
const api = (path, payload, method = 'POST') => evaluate(`const session=await window.electronAPI.invoke('api:get-port');const result=await fetch('http://127.0.0.1:'+session.port+${json(path)},{method:${json(method)},headers:{'content-type':'application/json','x-api-token':session.token},body:${payload === undefined ? 'undefined' : json(json(payload))}});const data=await result.json();if(!result.ok)throw new Error(JSON.stringify(data));return data;`);
async function until(action, predicate, message, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await action();
    if (predicate(last)) return last;
    await delay(150);
  }
  assert.fail(`${message}: ${json(last)}`);
}
const upload = (kbId, name, base64, modelFields) => evaluate(`const session=await window.electronAPI.invoke('api:get-port');const data=new FormData();data.append('file',new File([Uint8Array.from(atob(${json(base64)}),c=>c.charCodeAt(0))],${json(name)}));data.append('kbId',${json(kbId)});for(const[key,value]of Object.entries(${json(modelFields)}))data.append(key,String(value));const response=await fetch('http://127.0.0.1:'+session.port+'/api/v1/plugins/knowledge/documents/upload',{method:'POST',headers:{'x-api-token':session.token},body:data});const result=await response.json();if(!response.ok)throw new Error(JSON.stringify(result));return result;`);
let db;
let up;
let failed;
try {
  up = await run('up', '--size', '1440x1100', '--mode', mode);
  db = new DatabaseSync(up.workspaceDb, { readOnly: true });
  const entries = await evaluate('return await window.electronAPI.plugins.rendererEntries();');
  evidence.json('candidate', { gitHead: up.gitHead, mode: up.options.mode, build: up.build, protocol: 'official synthetic local HTTP', entries });
  await evidence.check('知识库入口实际加载，冷态列表不拉Qdrant', async () => {
    const entry = entries.data.find(item => item.pluginId === 'knowledge');
    assert.ok(entry);
    if (mode === 'bundled') {
      assert.equal(entry.sourceKind, 'active');
      assert.equal(entry.entryUrl, 'plugin://knowledge/dist/renderer/index.js');
    }
    await run('wait', '--selector', '.sidebar-entry:has(svg[data-icon="library"])');
    const plugins = await evaluate('return await window.electronAPI.plugins.list();');
    assert.ok(plugins.data.some(item => item.meta.id === 'knowledge' && item.state === 'enabled'));
    assert.ok((await invoke('list')).some(item => item.id === 'default'));
    assert.equal([...observeTree(up.electron).values()].filter(process => /(?:^|\/)qdrant(?: |$)/.test(process.command)).length, 0);
  });
  const register = (format, endpoint, name) => api('/api/v1/custom-api-onboarding/capabilities/models', {
    ...(format.startsWith('paddle_') ? { ocr_mode: 'document_upload' } : {}),
    api_format: format, provider_name: name, base_url: fixture.baseUrl + endpoint, api_key: 'fixture-key', endpoint_model_id: name, display_name: name,
  });
  const embedding = (await register('openai_embeddings', '/v1', 'Knowledge embedding fixture')).model_id;
  const rerank = (await register('cohere_rerank', '/v2', 'Knowledge rerank fixture')).model_id;
  const ocr = (await register('paddle_layout_parsing', '/layout-parsing', 'Knowledge OCR fixture')).model_id;
  const text = (await api('/api/v1/custom-api-onboarding/models', { api_format: 'openai_compatible',
    provider_name: 'Knowledge text fixture', base_url: fixture.baseUrl + '/v1', api_key: 'fixture-key', endpoint_model_id: 'knowledge-text',
    display_name: 'Knowledge text fixture', context_window_tokens: 32000, max_output_tokens: 4096, supports_image_input: true,
  })).model_id;
  const kb = await invoke('create', { name: 'Plugin production corpus' });
  await invoke('update-settings', { kbId: kb.id, settings: { embeddingModelId: embedding, rerankModelId: rerank, pdfOcrModelId: ocr, imageVisionModelId: text, enableGraphIndexing: true } });
  const fields = { embedding_model_id: embedding, graph_extraction_model_id: text, image_vision_model_id: text, pdf_ocr_model_id: ocr };
  const sources = new Map();
  const dataRoot = join(up.root, 'workspace', 'Plugins', 'knowledge');
  const sourcePath = id => join(dataRoot, 'source_of_truth', `${id}.source.json`);
  await evidence.check('Markdown/PDF OCR/静态图片经生产摄入Worker落盘并检索', async () => {
    const markdown = '# Apple orchard\n\nApple orchard grows fresh apples in Taiwan in spring. Local growers use clean water and carefully manage the orchard.\n';
    for (const [name, bytes, extra] of [
      ['orchard.md', Buffer.from(markdown).toString('base64'), {}],
      ['recognition.pdf', MODEL_CONNECTION_TEST_PDF, { force_vision_mode: 'true' }],
      ['orchard.png', MODEL_CONNECTION_TEST_PNG, {}],
    ]) {
      const uploaded = await upload(kb.id, name, bytes, { ...fields, ...extra });
      evidence.json(`upload-${name}`, uploaded);
      await until(() => invoke('list-documents', { kbId: kb.id }), values => values.some(doc => doc.filename === name && doc.status === 'completed'), `${name} production ingestion failed`);
    }
    const docs = await invoke('list-documents', { kbId: kb.id });
    assert.equal(docs.length, 3);
    assert.ok(docs.every(doc => doc.hasSource));
    for (const doc of docs) {
      const content = await invoke('read-saved-content', { kbId: kb.id, documentId: doc.id });
      assert.ok(content.markdown.length > 0);
      sources.set(doc.id, readFileSync(sourcePath(doc.id)));
    }
    const result = await invoke('search', { kbId: kb.id, request: { query: 'apple', embeddingModelId: embedding, rerankModelId: rerank, useReranking: true } });
    assert.ok(result.results.length > 0);
    assert.ok(fixture.requests.some(request => request.path === '/layout-parsing'));
    assert.ok(fixture.requests.some(request => request.path === '/v2/rerank'));
    evidence.json('production-documents-search', { docs, result });
  });
  await evidence.check('图谱抽取与图谱向量Worker完成，同一索引身份不混用', async () => {
    await until(() => db.prepare('SELECT * FROM knowledge_graph_vector_doc_status WHERE kb_id=?').all(kb.id), rows => rows.some(row => row.status === 'completed'), 'graph vector indexing did not complete');
    const identity = db.prepare('SELECT embedding_model_id,embedding_space_id FROM knowledge_bases WHERE id=?').get(kb.id);
    assert.equal(identity.embedding_model_id, embedding);
    assert.match(identity.embedding_space_id, /^embedding-space:v1:/);
    const nodes = db.prepare('SELECT * FROM knowledge_graph_nodes WHERE kb_id=?').all(kb.id);
    assert.ok(nodes.some(node => node.name === 'Apple orchard'));
    const edges = db.prepare('SELECT * FROM knowledge_graph_edges WHERE kb_id=?').all(kb.id);
    assert.ok(edges.length > 0);
    evidence.json('graph-production', { nodes, edges, status: await invoke('graph-progress', { kbId: kb.id }) });
  });
  await evidence.check('真实图谱节点和边使用单段，小集合不按 CPU 数预建', async () => {
    const directory = join(dataRoot, 'qdrant');
    const log = readFileSync(join(directory, 'logs', 'qdrant.log'), 'utf8');
    const listener = /actix_server::server: starting service: .*listening on: (127\.0\.0\.1:\d+)/u.exec(log);
    assert.ok(listener, '预期在隔离实例日志中找到实际绑定的 Qdrant 端口');
    const collections = `http://${listener[1]}/collections`;
    async function request(name, method = 'GET', options) {
      const response = await fetch(`${collections}/${name}`, {
        method,
        ...(options && { headers: { 'content-type': 'application/json' }, body: JSON.stringify(options) }),
        signal: AbortSignal.timeout(15_000),
      });
      const payload = await response.json();
      assert.ok(response.ok, `${method} ${name}: ${json(payload)}`);
      return payload.result;
    }
    function nominalBytes(name) {
      const files = readdirSync(join(directory, 'storage', 'collections', name), { recursive: true, withFileTypes: true });
      return files.filter(file => file.isFile()).reduce((sum, file) => sum + statSync(join(file.parentPath, file.name)).size, 0);
    }
    const names = [`kg_nodes_${kb.id}`, `kg_edges_${kb.id}`];
    for (const name of names) {
      const info = await request(name);
      assert.equal(info.config.optimizer_config.default_segment_number, 1);
      assert.equal(info.segments_count, 1);
    }
    const auto = 'empty_graph_auto_control';
    const compact = 'empty_graph_one_segment_control';
    const graphLayout = { vectors: { default: { size: 4, distance: 'Cosine' } }, sparse_vectors: { bm25: {} } };
    await request(auto, 'PUT', graphLayout);
    await request(compact, 'PUT', { ...graphLayout, optimizers_config: { default_segment_number: 1 } });
    try {
      const automatic = { segments: (await request(auto)).segments_count, nominalBytes: nominalBytes(auto) };
      const singleSegment = { segments: (await request(compact)).segments_count, nominalBytes: nominalBytes(compact) };
      assert.equal(singleSegment.segments, 1);
      if (automatic.segments > 1) assert.ok(singleSegment.nominalBytes < automatic.nominalBytes);
      evidence.json('qdrant-graph-segments', { cpuCount: cpus().length, automatic, singleSegment, productionGraph: names.map(name => ({ name, nominalBytes: nominalBytes(name) })) });
    } finally {
      await request(compact, 'DELETE');
      await request(auto, 'DELETE');
    }
  });
  await run('click', '--selector', '.sidebar-entry:has(svg[data-icon="library"])');
  await run('wait', '--text', 'Plugin production corpus');
  await run('click', 'text=Plugin production corpus');
  await run('click', 'text=文件管理');
  await run('wait', '--text', 'orchard.md');
  await run('shot');
  await evidence.check('文件管理中的已保存正文可读，关闭预览不修改原文', async () => {
    await run('click', '--selector', '.file-item:last-child .col-actions button:first-child');
    await run('wait', '--selector', '.knowledge-saved-content .ProseMirror');
    assert.ok((await evaluate("return document.querySelector('.knowledge-saved-content').textContent;")).includes('Apple orchard'));
    await run('shot');
    await run('press', 'Escape');
    await run('wait', '--selector', '.knowledge-saved-content', '--state', 'detached');
    for (const [id, bytes] of sources) assert.deepEqual(readFileSync(sourcePath(id)), bytes);
  });
  await evidence.check('停用撤销入口但保留原文/表/关联，重新启用可读且不拉向量', async () => {
    const before = db.prepare('SELECT * FROM knowledge_bases WHERE id=?').get(kb.id);
    const disabled = await evaluate("return await window.electronAPI.plugins.setEnabled('knowledge',false);");
    assert.equal(disabled.success, true, json(disabled));
    await run('wait', '--expr', `!document.querySelector('.sidebar-entry:has(svg[data-icon="library"])')`);
    assert.deepEqual(db.prepare('SELECT * FROM knowledge_bases WHERE id=?').get(kb.id), before);
    for (const [id, bytes] of sources) assert.deepEqual(readFileSync(sourcePath(id)), bytes);
    await run('shot');
    const enabled = await evaluate("return await window.electronAPI.plugins.setEnabled('knowledge',true);");
    assert.equal(enabled.success, true, json(enabled));
    assert.equal([...observeTree(up.electron).values()].filter(process => /(?:^|\/)qdrant(?: |$)/.test(process.command)).length, 0);
    assert.equal((await invoke('list-documents', { kbId: kb.id })).length, 3);
    for (const id of sources.keys()) assert.ok((await invoke('read-saved-content', { kbId: kb.id, documentId: id })).markdown.length > 0);
  });
  await evidence.check('正常删除经过Qdrant确认并删除资料，默认库拒绝带正式用户消息', async () => {
    const denied = await evaluate("return await window.electronAPI['plugin:invoke']('knowledge','delete',{kbId:'default'});");
    assert.equal(denied.success, false);
    assert.ok(denied.userMessage, json(denied));
    await invoke('delete', { kbId: kb.id });
    assert.equal(db.prepare('SELECT count(*) AS count FROM kb_documents WHERE kb_id=?').get(kb.id).count, 0);
  });
} catch (error) {
  failed = error;
  evidence.error(error);
  try { await run('shot'); } catch { /* 启动失败时没有可截图窗口。 */ }
} finally {
  db?.close();
  try { evidence.json('cleanup', await test.finish({ clean: !failed })); } catch (error) { failed ??= error; evidence.error(error); }
  await fixture.close();
  console.log(JSON.stringify(evidence.finish()));
}
if (failed) throw failed;
