import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import { acceptance } from '../../development/features/desktop-probe/acceptance/probeAcceptance.mjs';
import { startDeterministicOpenAiChatServer } from '../shell-tool/harness/deterministicOpenAiChatServer.mjs';
import { createEvidence } from '../../test-runner/features/acceptance-evidence/createEvidence.mjs';
import { installKnowledgeForScenario } from './knowledgeStore.fixture.mjs';
import { startCustomCapabilityProtocolServer } from '../../../src/app-hosts/linnya/application/custom-api-onboarding/__tests__/fixtures/customCapabilityProtocolServer.ts';

// 在模型已经收到旧工具清单、还没返回工具调用时卡住 HTTP；不替换 Agent、工具或插件运行时。
process.env.LINNYA_PLUGIN_RENDERER_BUNDLE = 'disk';
const evidence = createEvidence('knowledge-agent-lifecycle', { files: [
  'scripts/e2e/knowledge-plugin/agent-lifecycle.acceptance.mjs',
  'scripts/e2e/shell-tool/harness/deterministicOpenAiChatServer.mjs',
  'src/app-hosts/linnya/application/custom-api-onboarding/__tests__/fixtures/customCapabilityProtocolServer.ts',
] });
const cases = [
  { id: 'disable', operation: 'disable' },
  { id: 'disable-between', operation: 'disable', priorSearch: true },
  { id: 'uninstall', operation: 'uninstall' },
  { id: 'uninstall-delete', operation: 'uninstall-delete' },
];
const toolName = 'knowledge_search';
const unavailable = '知识库当前不可用，本次调用未执行';
const busy = '请等待正在进行的工具调用结束';
const searchCall = (id, hold) => ({ kind: 'tool_call', id, name: toolName, arguments: { kind: 'fixed', value: { query: 'apple orchard' } }, ...(hold ? { hold } : {}) });
const plans = Object.fromEntries(cases.flatMap(({ id, priorSearch }) => [
  [id, [
    ...(priorSearch ? [searchCall(`${id}-first`)] : []),
    searchCall(`${id}-old`, 'before-call'),
    { kind: 'assistant_text', id: `${id}-continue`, content: `continued-${id}`,
      expectToolObservation: { id: `${id}-old`, includes: unavailable } },
  ]],
  [`${id}-new`, [{ kind: 'assistant_text', id: `${id}-new`, content: `new-turn-${id}` }]],
]));
plans['in-flight'] = [
  searchCall('active-search'),
  { kind: 'assistant_text', id: 'active-search-finished', content: 'active-search-finished' },
];
plans['missing-deep-model'] = [
  { kind: 'tool_call', id: 'missing-deep-model', name: toolName,
    arguments: { kind: 'fixed', value: { query: 'apple orchard', deep_search: true } } },
  { kind: 'assistant_text', id: 'deep-model-unavailable-finished', content: 'deep-model-unavailable-finished',
    expectToolObservation: { id: 'missing-deep-model', includes: 'Run model unavailable' } },
];
const server = await startDeterministicOpenAiChatServer({ sessions: plans });
const embeddingFixture = await startCustomCapabilityProtocolServer();
const test = acceptance(`knowledge-agent-lifecycle-${process.pid}`, { evidence });
const { run } = test;
const json = JSON.stringify;
const evaluate = async code => (await run('eval', `(async()=>{${code}})()`)).value;
const sidebar = '.sidebar-entry:has(svg[data-icon="library"])';
const toggle = '.switch-control:has(input[aria-label="知识库 启用状态"])';

async function uiRef(label, role = 'button', within) {
  const { entries } = await run('snapshot', '--json', '--role', role, '--max-lines', '180', ...(within ? ['--within', within] : []));
  const found = entries.filter(entry => entry.role === role && (typeof label === 'string' ? entry.name === label : label.test(entry.name)));
  assert.equal(found.length, 1, `${role} ${label}: ${json(entries)}`);
  return found[0].ref;
}

async function until(read, accepts, label, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await read();
    if (accepts(last)) return last;
    await delay(100);
  }
  assert.fail(`${label}: ${json(last)}`);
}

async function selectModel(name) {
  await run('click', await uiRef(/^选择选项(?::|$)/, 'button', '.ai-assistant-input'));
  const panel = '.select-options[role="listbox"]';
  const option = await uiRef(name, 'option', panel);
  const scrollDelta = await evaluate(`const panel=document.querySelector(${json(panel)});const option=[...panel.querySelectorAll('button.select-option')].find(item=>item.textContent.trim()===${json(name)});const bounds=panel.getBoundingClientRect();const rect=option.getBoundingClientRect();return rect.top<bounds.top||rect.bottom>bounds.bottom?Math.round(rect.top-bounds.top-bounds.height/2):0;`);
  if (scrollDelta) await run('scroll', '--selector', panel, `--dy=${scrollDelta}`);
  await run('click', option);
}

async function send(text) {
  const editor = '.ai-assistant-input .ProseMirror[contenteditable="true"]';
  await run('click', '--selector', editor);
  await run('type', text);
  await run('click', await uiRef('发送', 'button', '.ai-assistant-input'));
}

async function registerModel(action) {
  const name = `Lifecycle ${action}`;
  const payload = {
    api_format: 'openai_compatible', provider_name: name, base_url: server.apiBaseFor(action),
    api_key: 'fixture-key', endpoint_model_id: name, display_name: name,
    context_window_tokens: 32000, max_output_tokens: 2048, supports_image_input: false,
  };
  await prepareJson('/api/v1/custom-api-onboarding/models', payload);
  return name;
}

const prepareJson = (route, payload) => evaluate(`const session=await window.electronAPI.invoke('api:get-port');const r=await fetch('http://127.0.0.1:'+session.port+${json(route)},{method:'POST',headers:{'content-type':'application/json','x-api-token':session.token},body:${json(json(payload))}});const data=await r.json();if(!r.ok)throw new Error(JSON.stringify(data));return data;`);

async function prepareCorpus() {
  const embedding = await prepareJson('/api/v1/custom-api-onboarding/capabilities/models', {
    api_format: 'openai_embeddings', provider_name: 'Lifecycle embedding fixture',
    base_url: `${embeddingFixture.baseUrl}/v1`, api_key: 'fixture-key', endpoint_model_id: 'lifecycle-embedding',
  });
  const md = '# Apple orchard\n\nSynthetic apple orchard grows apples in Taiwan.';
  await evaluate(`const session=await window.electronAPI.invoke('api:get-port');const data=new FormData();data.append('file',new File([${json(md)}],'lifecycle.md'));data.append('kbId','default');data.append('embedding_model_id',${json(embedding.model_id)});const response=await fetch('http://127.0.0.1:'+session.port+'/api/v1/plugins/knowledge/documents/upload',{method:'POST',headers:{'x-api-token':session.token},body:data});const result=await response.json();if(!response.ok)throw new Error(JSON.stringify(result));return result;`);
}

async function openStoreDetail() {
  await run('click', await uiRef('插件', 'button', 'aside'));
  await run('click', await uiRef('知识库', 'heading', 'main'));
}

async function clickUninstall(deleteData = false) {
  await run('click', await uiRef('卸载', 'button', 'main'));
  const modal = '.modal-overlay--alert';
  const dedicated = '.plugin-store-uninstall-dialog';
  await run('wait', '--selector', modal);
  const hasData = (await run('eval', `Boolean(document.querySelector(${json(dedicated)}))`)).value;
  if (deleteData) {
    assert.ok(hasData, 'delete case requires a populated fixture and dedicated confirmation');
    await run('click', '--selector', `${dedicated} label`);
  }
  await run('shot');
  await run('click', await uiRef(deleteData ? '卸载并删除' : hasData ? '卸载' : '确定', 'button', modal));
}

let db;
let failed;
let busyMessages;
try {
  const up = await run('up', '--size', '1440x1000', '--mode', 'bundled');
  await installKnowledgeForScenario(run);
  db = new DatabaseSync(up.workspaceDb, { readOnly: true });
  const entries = await evaluate('return (await window.electronAPI.plugins.rendererEntries()).data;');
  assert.equal(entries.find(entry => entry.pluginId === 'knowledge')?.entryUrl, 'plugin://knowledge/dist/renderer/index.js');
  evidence.json('candidate', { gitHead: up.gitHead, mode: up.options.mode, entries });
  const modelNames = new Map();
  for (const sessionId of Object.keys(plans)) modelNames.set(sessionId, await registerModel(sessionId));
  await prepareCorpus();
  await until(() => db.prepare("SELECT status FROM kb_documents WHERE filename='lifecycle.md'").get(), row => row?.status === 'completed', 'fixture ingestion', 45_000);
  await run('reload');
  await run('wait', '--selector', sidebar);
  await run('click', '--selector', '[data-linnya-tooltip="设置"]');
  await run('click', 'text=对话');
  await run('click', 'text=自动生成对话标题');
  await run('click', await uiRef('关闭设置'));
  await run('click', 'text=管理知识库');
  await run('click', 'text=关联');
  await run('click', await uiRef('保存', 'button', '.modal-overlay'));
  const readAgentRuns = () => db.prepare("SELECT id,conversation_id,status,end_ts,error_json FROM runs WHERE agent_spec_id='default' ORDER BY rowid DESC").all();
  const readRun = id => db.prepare('SELECT id,conversation_id,status,current_node,pause_reason,end_ts,error_json FROM runs WHERE id=?').get(id);
  const readEvents = id => db.prepare('SELECT type,payload FROM events WHERE run_id=? ORDER BY rowid').all(id).map(row => ({ type: row.type, body: JSON.parse(row.payload) }));
  const readInstalled = () => db.prepare("SELECT installed FROM installed_plugins WHERE plugin_id='knowledge'").get();
  const readEnabled = () => db.prepare("SELECT 1 FROM enabled_plugins WHERE plugin_id='knowledge'").get() !== undefined;

  await evidence.check('未配置深搜固定模型：工具明确失败，父 Agent 仍完成', async () => {
    await selectModel(modelNames.get('missing-deep-model'));
    await send('Search the synthetic library with the unconfigured deep model.');
    await run('wait', '--text', 'deep-model-unavailable-finished');
    const finished = await until(() => readAgentRuns()[0], value => Boolean(value?.end_ts), 'parent completed');
    assert.equal(finished.status, 'completed');
    const events = readEvents(finished.id);
    assert.ok(events.some(event => event.type === 'tool_output' && event.body.tool_name === toolName &&
      event.body.status === 'error' && event.body.observation.includes('Run model unavailable')));
    evidence.json('missing-deep-model', { finished, events });
    await run('shot');
    await run('click', await uiRef('新对话', 'button', 'aside'));
  });

  await evidence.check('真实检索进行中：停用与卸载是否会阻拦、原运行是否完成', async () => {
    await selectModel(modelNames.get('in-flight'));
    const before = embeddingFixture.requests.length;
    embeddingFixture.setDelay(10_000, '/v1/embeddings');
    await send('E7 active search');
    await until(() => embeddingFixture.requests.slice(before), requests => requests.some(request => request.path === '/v1/embeddings'), 'real search reached embedding provider');
    const runId = readAgentRuns()[0].id;
    await run('shot');
    await openStoreDetail();
    await run('click', '--selector', toggle);
    await run('wait', '--selector', '.notification-content');
    const toggleMessage = (await run('eval', `document.querySelector('.notification-content')?.textContent?.trim()`)).value;
    await run('shot');
    await clickUninstall();
    await run('wait', '--selector', '.notification-content');
    const uninstallMessage = (await run('eval', `[...document.querySelectorAll('.notification-content')].map(item=>item.textContent.trim())`)).value;
    busyMessages = { toggleMessage, uninstallMessage };
    await run('shot');
    const during = { enabled: readEnabled(), installation: readInstalled(), run: readRun(runId) };
    const after = await until(() => readRun(runId), value => Boolean(value?.end_ts), 'in-flight search completion');
    const events = readEvents(runId);
    evidence.json('in-flight-search', { toggleMessage, uninstallMessage, during, after, events });
    assert.equal(during.enabled, true);
    assert.equal(during.installation.installed, 1);
    assert.equal(during.run.status, 'running');
    assert.equal(after.status, 'completed');
    assert.ok(events.some(event => event.type === 'tool_output'
      && event.body.tool_name === toolName && event.body.status === 'success'
      && event.body.data?.citations?.citations?.some(citation => citation.docTitle === 'lifecycle.md')), 'the in-flight search must return real citations');
    assert.ok(events.some(event => event.type === 'final_answer'));
    embeddingFixture.setDelay(0);
    await run('click', await uiRef('新对话', 'button', 'aside'));
  });

  for (const { id, operation, priorSearch } of cases) {
    await evidence.check(`撤回旧工具后原对话仍继续：${id}`, async () => {
      const previous = readAgentRuns()[0]?.id;
      await selectModel(modelNames.get(id));
      await send(`E7 ${id}: inspect the synthetic knowledge library.`);
      const observations = await until(() => server.observations(), values => values.some(row => row.sessionId === id && row.state === 'held'), 'model hold');
      const offered = observations.find(row => row.sessionId === id && row.state === 'held');
      assert.ok(offered.toolNames.includes(toolName), json(offered));
      const heldRun = await until(() => readAgentRuns()[0], value => value?.id !== undefined && value.id !== previous, 'run admitted');
      assert.equal(heldRun.end_ts, null);
      const earlierEvents = readEvents(heldRun.id);
      assert.equal(earlierEvents.filter(event => event.type === 'tool_output').length, priorSearch ? 1 : 0);
      await run('shot');

      await run('click', await uiRef('插件', 'button', 'aside'));
      if (operation === 'disable') {
        await run('click', '--selector', toggle);
      } else {
        await run('click', await uiRef('知识库', 'heading', 'main'));
        await clickUninstall(operation === 'uninstall-delete');
        await until(readInstalled, row => row?.installed === 0, 'uninstalled');
      }
      await until(readEnabled, enabled => !enabled, 'knowledge disabled');
      await run('wait', '--selector', sidebar, '--state', 'detached');
      const beforeRelease = readRun(heldRun.id);
      await run('shot');
      server.release(id, 'before-call');
      const settled = await until(() => readRun(heldRun.id), value => value?.status === 'paused' || Boolean(value?.end_ts), 'old run settled');
      const oldEvents = readEvents(heldRun.id);
      evidence.json(`${id}-old-run`, { offered, heldRun, beforeRelease, settled, events: oldEvents });
      assert.ok(oldEvents.some(event => event.type === 'tool_call_decision'), 'the real tool loop must accept the model decision');
      assert.equal(settled.status, 'completed', 'late call must not pause the original run');
      const outputs = oldEvents.filter(event => event.type === 'tool_output' && event.body.tool_name === toolName);
      assert.equal(outputs.filter(event => event.body.status === 'success').length, priorSearch ? 1 : 0);
      const refusals = outputs.filter(event => event.body.status === 'error');
      assert.equal(refusals.length, 1);
      assert.equal(refusals[0].body.error_code, 'PLUGIN_TOOL_UNAVAILABLE');
      assert.ok(refusals[0].body.observation.includes(unavailable));
      const title = db.prepare('SELECT title FROM conversations WHERE conversation_id=?').get(heldRun.conversation_id).title;
      await run('click', await uiRef('新对话', 'button', 'aside'));
      await run('click', await uiRef('历史对话', 'button', 'header'));
      await run('wait', '--text', title);
      await run('click', `text=${title}`);
      await run('wait', '--text', `continued-${id}`);
      await run('shot');
      await run('snapshot', '--max-lines', '140');

      // 回到同一项目的新对话，通过相同设置发出新请求，和旧 run 实际收到的工具对比。
      await run('click', await uiRef('新对话', 'button', 'aside'));
      await selectModel(modelNames.get(`${id}-new`));
      await send(`E7 ${id}: new turn after the plugin state change.`);
      await run('wait', '--text', `new-turn-${id}`);
      await run('shot');
      const modelRequests = server.observations().filter(row => row.sessionId === id || row.sessionId === `${id}-new`);
      evidence.json(`${id}-model-requests`, modelRequests);
      assert.equal(beforeRelease.end_ts, null, 'the held run was cancelled before the model sent the old tool call');
      const fresh = modelRequests.find(row => row.sessionId === `${id}-new`);
      const continued = modelRequests.filter(row => row.sessionId === id).at(-1);
      assert.equal(continued.latestRole, 'tool');
      assert.ok(!continued.toolNames.some(name => [toolName, 'knowledge_read'].includes(name)), 'the old run must receive the refreshed tool list');
      assert.ok(fresh.toolNames.includes('read_file'), 'the fresh run must retain ordinary project tools');
      assert.ok(!fresh.toolNames.some(name => [toolName, 'knowledge_read'].includes(name)), 'a fresh run must not expose unavailable knowledge tools');

      if (operation !== 'uninstall-delete') {
        await run('click', await uiRef('插件', 'button', 'aside'));
        if (operation === 'disable') {
          await run('click', '--selector', toggle);
        } else {
          await run('click', 'text=插件市场');
          await run('click', await uiRef('知识库', 'heading', 'main'));
          await run('click', await uiRef('安装', 'button', 'main'));
        }
        await run('wait', '--selector', sidebar);
        await run('shot');
        await run('click', await uiRef('新对话', 'button', 'aside'));
      }
    });
  }
  await evidence.check('商店解释正在检索时为什么不能停用或卸载', async () => {
    assert.ok(busyMessages.toggleMessage.includes(busy), 'disable must explain why it is blocked');
    assert.ok(busyMessages.uninstallMessage.some(message => message.includes(busy)), 'uninstall must explain why it is blocked');
  });
} catch (error) {
  failed = error;
  evidence.error(error);
  try { await run('shot'); } catch { /* 启动失败没有画面。 */ }
} finally {
  evidence.json('model-requests', server.observations());
  db?.close();
  try { evidence.json('cleanup', await test.finish({ clean: !failed })); } catch (error) { failed ??= error; evidence.error(error); }
  await server.close();
  await embeddingFixture.close();
  console.log(json(evidence.finish()));
}
if (failed) throw failed;
