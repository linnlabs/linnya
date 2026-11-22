import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { acceptance } from '../../development/features/desktop-probe/acceptance/probeAcceptance.mjs';
import { createEvidence } from '../../test-runner/features/acceptance-evidence/createEvidence.mjs';

/**
 * Canvas 随安装包分发：新用户默认装好并启用；在真实界面新建画布、写一张文字卡；
 * 从插件商店卸载（保留数据）后入口撤下、资料不动，再从随包来源重装，原画布与卡片仍在。
 * 使用隔离探针的随包模式与磁盘 Renderer，插件来自 extraResources/plugins 的正式 artifact。
 */
process.env.LINNYA_PLUGIN_RENDERER_BUNDLE = 'disk';
const CARD_TEXT = 'Bundled canvas acceptance card';
const evidence = createEvidence('canvas-bundled-lifecycle', {
  files: ['scripts/e2e/canvas-plugin/bundled-lifecycle.acceptance.mjs'],
});
const test = acceptance(`canvas-bundled-lifecycle-${process.pid}`, { evidence });
const { run } = test;
const json = JSON.stringify;
let failed;

async function clickNamed(role, name, within) {
  // 页面切换后的渲染是异步的：最多等 10 秒出现唯一目标；仍找不到时把当时的页面结构留作证据。
  const deadline = Date.now() + 10_000;
  for (;;) {
    const { entries } = await run('snapshot', '--json', '--role', role, '--max-lines', '160', ...(within ? ['--within', within] : []));
    const targets = entries.filter(entry => entry.name === name);
    if (targets.length === 1) return run('click', targets[0].ref);
    if (Date.now() > deadline) {
      evidence.json(`missing-${role}-${name}`, (await run('snapshot', '--json', '--max-lines', '200')).entries);
      assert.equal(targets.length, 1, `${role}: ${name} (${targets.length})`);
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
}

async function evaluate(code) {
  return (await run('eval', `(async()=>{${code}})()`)).value;
}

function readCanvasState(up) {
  const db = new DatabaseSync(up.workspaceDb, { readOnly: true });
  try {
    return {
      installed: { ...(db.prepare("SELECT installed, version, user_removed FROM installed_plugins WHERE plugin_id='canvas'").get() ?? {}) },
      enabled: Boolean(db.prepare("SELECT 1 FROM enabled_plugins WHERE plugin_id='canvas'").get()),
      canvases: db.prepare("SELECT id, name FROM workspace_nodes WHERE type='canvas' ORDER BY name").all().map(row => ({ ...row })),
      cards: db.prepare('SELECT element_json FROM canvas_elements').all().map(row => row.element_json),
    };
  } finally { db.close(); }
}

async function openStoreDetail(market = false) {
  // 在项目内时侧栏是项目菜单，先返回主侧栏再进入插件页。
  const { entries } = await run('snapshot', '--json', '--role', 'button', '--max-lines', '80', '--within', 'aside');
  const back = entries.find(entry => entry.name === '返回');
  if (back) await run('click', back.ref);
  await clickNamed('button', '插件', 'aside');
  if (market) await run('click', 'text=插件市场');
  await run('wait', '--text', 'Canvas', '--timeout', '30000');
  await clickNamed('heading', 'Canvas', 'main');
  await run('wait', '--text', '版本更新', '--timeout', '30000');
}

try {
  const up = await run('up', '--mode', 'bundled', '--size', '1440x1000', '--no-build');

  await evidence.check('新用户：Canvas 从随包 artifact 默认安装并启用，界面入口可用', async () => {
    const { value: listing } = await run('eval', 'window.electronAPI.plugins.list()');
    const canvas = listing.data.find(item => item.meta.id === 'canvas');
    assert.equal(canvas?.state, 'enabled', json(canvas));
    const { value: entries } = await run('eval', 'window.electronAPI.plugins.rendererEntries()');
    const entry = entries.data.find(item => item.pluginId === 'canvas');
    assert.equal(entry?.sourceKind, 'active');
    assert.ok(existsSync(join(up.root, 'plugins', 'canvas', 'active.json')), 'bundled artifact staged into the user plugin root');
    const state = readCanvasState(up);
    assert.equal(state.installed.installed, 1);
    assert.equal(state.enabled, true);
    evidence.json('default-install', { canvas: { state: canvas.state, version: canvas.meta.version }, entry, state });
  });

  let canvasId;
  await evidence.check('真实界面：在项目文件里新建画布、写一张文字卡并保存', async () => {
    await clickNamed('button', '打开项目', 'aside');
    await clickNamed('button', '文件', 'aside');
    await clickNamed('button', '画布', 'aside');
    await run('wait', '--selector', '[role="toolbar"][aria-label="画布命令"]', '--timeout', '30000');
    await clickNamed('button', '新建文字卡');
    const editing = await evaluate('return Boolean(document.activeElement?.isContentEditable)');
    assert.equal(editing, true, 'a new text card opens for typing');
    await run('type', CARD_TEXT);
    await run('press', 'Escape');
    await run('wait', '--text', '已保存', '--timeout', '30000');
    await run('shot');
    const deadline = Date.now() + 30_000;
    let state = readCanvasState(up);
    while (!state.cards.some(card => card.includes(CARD_TEXT)) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 250));
      state = readCanvasState(up);
    }
    assert.equal(state.canvases.length, 1, json(state.canvases));
    assert.ok(state.cards.some(card => card.includes(CARD_TEXT)), 'card text persisted');
    canvasId = state.canvases[0].id;
    const read = await evaluate(`const r=await window.electronAPI['plugin:invoke']('canvas','canvas:read',{documentId:${json(canvasId)}});return {ok:r.success,text:JSON.stringify(r.data).includes(${json(CARD_TEXT)})};`);
    assert.deepEqual(read, { ok: true, text: true });
  });

  await evidence.check('商店卸载（保留数据）：入口撤下、画布与卡片资料不动', async () => {
    await openStoreDetail();
    await clickNamed('button', '卸载', 'main');
    // 没有声明可清理资料的插件走通用确认：只卸载，不提供删除资料。
    await run('wait', '--text', '提示', '--timeout', '10000');
    const dialog = await evaluate("return [...document.querySelectorAll('.modal-overlay')].map(node => node.innerText.trim()).join('\\n')");
    evidence.json('uninstall-confirmation', { dialog });
    await run('shot');
    await clickNamed('button', '确定');
    const deadline = Date.now() + 30_000;
    let listing;
    do {
      ({ value: listing } = await run('eval', 'window.electronAPI.plugins.list()'));
      if (listing.data.find(item => item.meta.id === 'canvas')?.state === 'missing') break;
      await new Promise(resolve => setTimeout(resolve, 250));
    } while (Date.now() < deadline);
    assert.equal(listing.data.find(item => item.meta.id === 'canvas')?.state, 'missing');
    await run('wait', '--settle');
    evidence.json('detail-after-uninstall', { text: await evaluate("return document.querySelector('main')?.innerText ?? ''") });
    await run('shot');
    const { value: entries } = await run('eval', 'window.electronAPI.plugins.rendererEntries()');
    assert.ok(entries.data.every(item => item.pluginId !== 'canvas'), 'renderer entry withdrawn');
    const state = readCanvasState(up);
    assert.deepEqual({ installed: state.installed.installed, removed: state.installed.user_removed }, { installed: 0, removed: 1 });
    assert.equal(state.canvases.length, 1);
    assert.ok(state.cards.some(card => card.includes(CARD_TEXT)));
  });

  await evidence.check('重启后保持卸载，不被随包来源自动装回', async () => {
    await run('stop');
    const restarted = await run('up', '--mode', 'bundled', '--size', '1440x1000', '--no-build');
    const state = readCanvasState(restarted);
    assert.equal(state.installed.installed, 0);
    assert.equal(state.installed.user_removed, 1);
    const { value: listing } = await run('eval', 'window.electronAPI.plugins.list()');
    assert.equal(listing.data.find(item => item.meta.id === 'canvas')?.state, 'missing');
  });

  await evidence.check('从随包来源重新安装：默认启用，原画布与卡片在界面里打开', async () => {
    await openStoreDetail(true);
    await run('wait', '--selector', '.plugin-store-install-button:not([disabled])', '--timeout', '30000');
    await clickNamed('button', '安装', 'main');
    await run('wait', '--text', '已安装', '--timeout', '30000').catch(() => {});
    const deadline = Date.now() + 30_000;
    let entries;
    do {
      ({ value: entries } = await run('eval', 'window.electronAPI.plugins.rendererEntries()'));
      if (entries.data.some(item => item.pluginId === 'canvas')) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    } while (Date.now() < deadline);
    assert.ok(entries.data.some(item => item.pluginId === 'canvas'), 'renderer entry restored');
    const state = readCanvasState(up);
    assert.deepEqual({ installed: state.installed.installed, removed: state.installed.user_removed, enabled: state.enabled },
      { installed: 1, removed: 0, enabled: true });
    await run('click', '--selector', '.plugin-store-back-button').catch(() => {});
    await clickNamed('button', '默认项目 打开项目 更多选项', 'aside').catch(() => {});
    await clickNamed('button', '打开项目', 'aside');
    await clickNamed('button', '文件', 'aside');
    await run('click', 'text=未命名画布');
    await run('wait', '--text', CARD_TEXT, '--timeout', '30000');
    await run('shot');
  });
} catch (error) {
  failed = error;
  if (!(error instanceof assert.AssertionError)) evidence.error(error);
} finally {
  try { evidence.json('teardown', await test.finish({ clean: !failed })); }
  catch (error) { failed ??= error; evidence.error(error); }
  console.log(JSON.stringify(evidence.finish()));
}
if (failed) throw failed;
