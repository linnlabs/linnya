import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { acceptance } from '../../development/features/desktop-probe/acceptance/probeAcceptance.mjs';
import { createEvidence } from '../../test-runner/features/acceptance-evidence/createEvidence.mjs';
import { installKnowledgeForScenario } from './knowledgeStore.fixture.mjs';
import { startCustomCapabilityProtocolServer } from '../../../src/app-hosts/linnya/application/custom-api-onboarding/__tests__/fixtures/customCapabilityProtocolServer.ts';

// 只通过真实界面、Preload 与正式 HTTP 准备合成资料，不导入 Renderer store 或插件源码。
process.env.LINNYA_PLUGIN_RENDERER_BUNDLE = 'disk';
const fixture = await startCustomCapabilityProtocolServer();
const evidence = createEvidence('knowledge-plugin-surfaces', { files: [
  'scripts/e2e/knowledge-plugin/surfaces.acceptance.mjs',
] });
const test = acceptance(`knowledge-surfaces-${process.pid}`, { evidence });
const { run } = test;
const json = JSON.stringify;
const evaluate = async code => (await run('eval', `(async()=>{${code}})()`)).value;
const invoke = (channel, payload = {}) => evaluate(`const r=await window.electronAPI['plugin:invoke']('knowledge',${json(channel)},${json(payload)});if(!r.success)throw new Error(JSON.stringify(r));return r.data;`);
const workspace = (channel, payload) => evaluate(`const r=await window.electronAPI[${json(`workspace:${channel}`)}](${payload === undefined ? '' : json(payload)});if(!r.success)throw new Error(JSON.stringify(r));return r.data;`);
async function ref(label, role = 'button') {
  const snapshot = await run('snapshot', '--max-lines', '180');
  const prefix = `- ${role} ${json(label)} `;
  const matches = snapshot.snapshot.split('\n').filter(line => line.trim().startsWith(prefix));
  assert.equal(matches.length, 1, `Expected one ${role} ${label}: ${snapshot.snapshot}`);
  return matches[0].match(/@(n\d+)/)[0];
}
const click = async label => run('click', await ref(label));
async function until(action, predicate, description) {
  const deadline = Date.now() + 45_000;
  let value;
  while (Date.now() < deadline) {
    value = await action();
    if (predicate(value)) return value;
    await delay(150);
  }
  assert.fail(`${description}: ${json(value)}`);
}
const kbName = 'Surface QA library';
const projectName = 'Surface QA Project';
const original = 'ALPHA source document only';
const target = 'BRAVO target document only';
let failed;
try {
  const up = await run('up', '--size', '1440x1000', '--mode', 'bundled');
  await installKnowledgeForScenario(run);
  const entries = await evaluate('return await window.electronAPI.plugins.rendererEntries();');
  const entry = entries.data.find(item => item.pluginId === 'knowledge');
  assert.equal(entry?.entryUrl, 'plugin://knowledge/dist/renderer/index.js');
  assert.equal(entry?.sourceKind, 'active');
  evidence.json('candidate', { gitHead: up.gitHead, build: up.build, entry, protocol: 'synthetic local HTTP' });
  const kb = await invoke('create', { name: kbName });
  const model = await evaluate(`const session=await window.electronAPI.invoke('api:get-port');const r=await fetch('http://127.0.0.1:'+session.port+'/api/v1/custom-api-onboarding/capabilities/models',{method:'POST',headers:{'content-type':'application/json','x-api-token':session.token},body:JSON.stringify({api_format:'openai_embeddings',provider_name:'Surface fixture',base_url:${json(fixture.baseUrl + '/v1')},api_key:'fixture-key',endpoint_model_id:'surface-embedding'})});const data=await r.json();if(!r.ok)throw new Error(JSON.stringify(data));return data.model_id;`);
  await invoke('update-settings', { kbId: kb.id, settings: { embeddingModelId: model, enableGraphIndexing: false } });
  // fixture 经后端建立目录后，正常刷新让 Renderer 读取正式模型目录/默认用途。
  await run('eval', 'location.reload()');
  await run('wait', '--selector', '[data-linnya-tooltip="设置"]');
  await run('click', '--selector', '[data-linnya-tooltip="设置"]');
  await run('click', 'text=模型配置');
  await ref('选择知识库嵌入模型: surface-embedding');
  await click('关闭设置');
  let projectId;
  await evidence.check('新建项目保留下拉尚未点加号的知识库，关联编辑持久保存', async () => {
    await run('click', 'text=新项目');
    await run('type', projectName);
    await click('选择要关联的知识库');
    await run('click', `text=${kbName}`);
    await run('shot');
    await click('创建项目');
    await run('wait', '--text', projectName);
    const projects = await workspace('list-projects');
    projectId = projects.projects.find(item => item.name === projectName)?.id;
    assert.ok(projectId);
    assert.deepEqual(await invoke('list-project-kb-links', { projectId }), [kb.id]);
    await run('click', 'text=管理知识库');
    await run('click', 'text=关联');
    await run('click', '--selector', `.kb-item:has(.kb-name[title="${kbName}"]) button`);
    await click('保存');
    assert.deepEqual(await invoke('list-project-kb-links', { projectId }), ['default']);
    await run('click', 'text=管理知识库');
    await run('click', 'text=关联');
    await run('shot');
    await click('保存');
    assert.deepEqual(new Set(await invoke('list-project-kb-links', { projectId })), new Set(['default', kb.id]));
  });
  const docs = [];
  for (const [name, text] of [['Surface A', original], ['Surface B', target]]) {
    const { documentId } = await workspace('create-document', { projectId, name });
    const initial = await workspace('read-document', { documentId });
    const content = initial.content;
    const block = content.content[0].content[0];
    assert.equal(block.type, 'baseBlock');
    block.content = [{ type: 'text', text }];
    block.attrs.isEmpty = false;
    await workspace('save-document', { documentId, content });
    docs.push({ documentId, name, content });
  }
  // 从项目行的实际无障碍树找到其“打开项目”，不调用 Host navigation 内部方法。
  const snapshot = (await run('snapshot', '--max-lines', '150')).snapshot;
  const rows = snapshot.split('\n');
  const projectRow = rows.findIndex(line => line.includes(`button "${projectName} 打开项目`));
  assert.ok(projectRow >= 0);
  const open = rows.slice(projectRow + 1).find(line => line.includes('button "打开项目"'));
  await run('click', open.match(/@(n\d+)/)[0]);
  await click('文件');
  await run('click', 'text=Surface A');
  await run('wait', '--text', original);
  await evidence.check('A打开时右键B，冻结项目与B身份，只摄入B的正文', async () => {
    await run('click', 'text=Surface B', '--button', 'right');
    await run('click', 'text=添加到知识库');
    await run('wait', '--selector', '.add-to-kb-body');
    const visible = await evaluate("return {target:document.querySelector('.doc-info-name')?.textContent,editor:[...document.querySelectorAll('.ProseMirror')].map(e=>e.textContent)};");
    assert.equal(visible.target, 'Surface B');
    assert.ok(visible.editor.includes(original));
    await run('shot');
    await run('click', '--selector', '.kb-target-select-trigger');
    await run('click', `text=${kbName}`);
    await click('确定');
    const documents = await until(() => invoke('list-documents', { kbId: kb.id }),
      values => values.some(doc => doc.filename === 'Surface B.md' && doc.status === 'completed'), 'B ingestion');
    assert.equal(documents.length, 1);
    const saved = await invoke('read-saved-content', { kbId: kb.id, documentId: documents[0].id });
    assert.equal(saved.markdown.trim(), target);
    const unchanged = await workspace('read-document', { documentId: docs[0].documentId });
    assert.deepEqual(unchanged.content, docs[0].content);
    evidence.json('frozen-target', { projectId, documents: docs, visible, saved });
  });
  await evidence.check('Markdown导出与Slides原菜单仍由各自owner处理', async () => {
    await click('更多菜单');
    await run('hover', await ref('导出', 'option'));
    for (const format of ['TXT', 'Markdown', 'PDF', 'DOCX']) await ref(`导出为 ${format}`, 'menuitem');
    await run('shot');
    await run('press', 'Escape');
    await workspace('create-document', { projectId, name: 'Surface slides', type: 'presentation' });
    await run('click', 'text=Surface slides');
    await run('wait', '--selector', '[aria-label="幻灯片编辑"]');
    await click('更多菜单');
    await ref('导出为 PPTX', 'option');
    await run('click', await ref('导出为图片', 'option'));
    await ref('高清 1920 × 1080 像素', 'radio');
    await run('shot');
    await click('取消');
  });
  await evidence.check('停用撤销跨文档弹窗和入口，当前文档可读且关联重启后保留', async () => {
    await run('click', 'text=Surface A');
    await run('click', 'text=Surface B', '--button', 'right');
    await run('click', 'text=添加到知识库');
    await run('wait', '--selector', '.add-to-kb-body');
    assert.equal((await evaluate("return await window.electronAPI.plugins.setEnabled('knowledge',false);")).success, true);
    await run('wait', '--selector', '.add-to-kb-body', '--state', 'detached');
    const visible = await evaluate("return {entry:!!document.querySelector('[data-linnya-tooltip=\"知识库\"]'),association:[...document.querySelectorAll('button')].some(e=>e.textContent.trim()==='管理知识库'),editor:[...document.querySelectorAll('.ProseMirror')].map(e=>e.textContent)};");
    assert.equal(visible.entry, false);
    assert.equal(visible.association, false);
    assert.ok(visible.editor.includes(original));
    await run('click', 'text=Surface B', '--button', 'right');
    assert.ok(!(await run('snapshot', '--max-lines', '120')).snapshot.includes('添加到知识库'));
    await run('shot');
    await run('press', 'Escape');
    assert.equal((await evaluate("return await window.electronAPI.plugins.setEnabled('knowledge',true);")).success, true);
    await run('wait', '--selector', '[data-linnya-tooltip="知识库"]');
    assert.deepEqual(new Set(await invoke('list-project-kb-links', { projectId })), new Set(['default', kb.id]));
    evidence.json('disabled-surfaces', visible);
  });
} catch (error) {
  failed = error;
  evidence.error(error);
  try { await run('shot'); } catch { /* 启动失败时没有界面。 */ }
} finally {
  try { evidence.json('cleanup', await test.finish({ clean: !failed })); } catch (error) { failed ??= error; evidence.error(error); }
  await fixture.close();
  console.log(json(evidence.finish()));
}
if (failed) throw failed;
