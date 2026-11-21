import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vitest';
import { repoRoot } from '../definitions/probeContract.mjs';
import { buildFreshness } from '../orchestration/probeBuild.mjs';
import { dependencyInstallMarkers, feedsDesktopBundle, judgeBuildFreshness } from '../functions/desktopBundleSources.mjs';
import { readDesktopMainInspector } from '../functions/desktopLaunchMarkers.mjs';
import { checkHeaderInvariants, trafficLightsRect } from '../functions/headerInvariants.mjs';
import { launchOptions, parseProbeArgs } from '../functions/parseProbeArgs.mjs';
import { renderSnapshot } from '../functions/renderSnapshot.mjs';
import { UPDATE_FIXTURE_STATUSES, updateFixtureSnapshot } from '../functions/updateStateFixture.mjs';
import { instanceRoot } from '../infrastructure/instanceStore.mjs';
import { cloneWorkspaceData } from '../infrastructure/workspaceClone.mjs';
import { probeTarget } from '../orchestration/probeClient.mjs';

test('非法实例路径和尺寸在启动任何进程前被拒绝', () => {
  assert.throws(() => instanceRoot('../_dev_data'), { code: 'USAGE' });
  assert.throws(() => launchOptions(parseProbeArgs(['up', '--size', '100x50']).values), { code: 'USAGE' });
  assert.throws(() => parseProbeArgs(['up', '--workdir', 'other']), { code: 'USAGE' });
});

test('产品源码与安装包入口不引用开发探针', () => {
  const tracked = execFileSync('git', ['ls-files', '-z', '--', 'src', 'apps', 'packages'], {
    cwd: repoRoot, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
  });
  for (const file of tracked.split('\0').filter(path => /\.(?:[cm]?js|[cm]?ts|tsx|vue)$/.test(path))) {
    assert.doesNotMatch(readFileSync(join(repoRoot, file), 'utf8'), /scripts\/development\/features\/desktop-probe/, file);
  }
  const { build } = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
  for (const file of build.files) {
    const source = typeof file === 'string' ? file : file.from;
    assert.doesNotMatch(source, /^(?:\*\*|scripts)(?:\/|$)/);
  }
}, 30_000);

test('任一 Desktop 产物比源码旧就判过期；Renderer 与测试文件不触发重建', () => {
  const outputs = [{ path: 'main.cjs', mtimeMs: 300 }, { path: 'app-server-backend.cjs', mtimeMs: 100 }];
  assert.deepEqual(judgeBuildFreshness(outputs, [{ path: 'src/a.ts', mtimeMs: 200 }]),
    { stale: true, reason: 'src/a.ts 比 app-server-backend.cjs 新' });
  assert.equal(judgeBuildFreshness(outputs, [{ path: 'src/a.ts', mtimeMs: 50 }]).stale, false);
  assert.equal(judgeBuildFreshness([{ path: 'main.cjs' }], []).stale, true);
  // 重装依赖（例如升级 @linnlabs/linnkit）比产物新时同样判过期。
  assert.deepEqual(judgeBuildFreshness(outputs, [{ path: dependencyInstallMarkers[1], mtimeMs: 200 }]),
    { stale: true, reason: 'node_modules/.modules.yaml 比 app-server-backend.cjs 新' });
  assert.ok(feedsDesktopBundle('src/tools/workspace/write_file/index.ts'));
  assert.ok(feedsDesktopBundle('packages/plugins/slides/src/backend/deck.ts'));
  for (const path of ['packages/plugins/slides/src/renderer/Deck.vue', 'packages/renderer-ui/src/index.ts',
    'src/domains/x/x.test.ts', 'packages/schemas/README.md']) assert.ok(!feedsDesktopBundle(path), path);
});

test('snapshot 过滤保留命中项的祖先链，按钮内同名文字不重复', () => {
  const node = (nodeId, role, name, childIds = [], backendDOMNodeId) => ({
    nodeId, role: { value: role }, name: { value: name }, childIds, backendDOMNodeId,
  });
  const nodes = [
    node('1', 'main', '', ['2', '4']), node('2', 'toolbar', '工具', ['3']), node('3', 'button', '新建对话', ['6'], 30),
    node('4', 'region', '正文', ['5']), node('5', 'StaticText', 'workspace 的说明'), node('6', 'StaticText', '新建对话'),
  ];
  const byText = renderSnapshot(nodes, { limit: 50, grep: 'WORKSPACE' });
  assert.deepEqual(byText.entries.map(entry => entry.role), ['main', 'region', 'StaticText']);
  const byRole = renderSnapshot(nodes, { limit: 50, roles: new Set(['button']) });
  assert.deepEqual(byRole.entries.map(entry => entry.ref ?? entry.role), ['main', 'toolbar', '@n30']);
  assert.equal(renderSnapshot(nodes, { limit: 50, all: true }).entries.filter(entry => entry.name === '新建对话').length, 1);
});

test('目标写法：@引用、text= 文字、其余按选择器', () => {
  assert.deepEqual(probeTarget('@n12'), { ref: '@n12' });
  assert.deepEqual(probeTarget('text=workspace'), { text: 'workspace' });
  assert.deepEqual(probeTarget('.project-row'), { selector: '.project-row' });
  assert.throws(() => probeTarget('text='), { code: 'USAGE' });
  assert.deepEqual(parseProbeArgs(['snapshot', '--grep', '设置', '--role', 'button,link']).values.role, 'button,link');
});

test('写错命令或选项时给出最接近的写法', () => {
  const hintOf = argv => {
    try {
      parseProbeArgs(argv);
    } catch (error) {
      assert.equal(error.code, 'USAGE');
      return error.hint;
    }
    assert.fail('应当报 USAGE');
  };
  assert.match(hintOf(['list']), /status --all/);
  assert.match(hintOf(['screnshot']), /probe shot/);
  assert.match(hintOf(['shot', '--out', 'a.png']), /artifacts\[\]\.path/);
  assert.match(hintOf(['click', '--selecter', '.a']), /--selector/);
  assert.match(hintOf(['wait', '--selector', 'text=设置']), /wait --text/);
  assert.match(hintOf(['record', 'curve', '--target', 'text=菜单', '--', 'click', '@n1']), /@引用/);
});

test('克隆数据只复制用户数据，跳过缓存、锁与 shm，源目录不变', async () => {
  const temp = mkdtempSync(join(tmpdir(), 'probe-clone-'));
  try {
    const source = join(temp, 'data');
    for (const dir of ['workspace', 'DocumentMedia', 'benchmark-results', 'logs']) mkdirSync(join(source, dir), { recursive: true });
    writeFileSync(join(source, 'workspace', 'workspace.sqlite'), 'db');
    writeFileSync(join(source, 'workspace', 'workspace.sqlite-shm'), 'shm');
    writeFileSync(join(source, 'workspace', '.runtime-owner.lock'), '');
    writeFileSync(join(source, 'DocumentMedia', 'a.png'), 'png');
    writeFileSync(join(source, 'benchmark-results', 'big.json'), '{}');
    const target = join(temp, 'instance', 'workspace');
    const clone = await cloneWorkspaceData(source, target);
    assert.equal(clone.files, 2);
    assert.deepEqual(clone.skipped.sort(), ['benchmark-results', 'logs']);
    assert.ok(existsSync(join(target, 'workspace', 'workspace.sqlite')));
    assert.ok(existsSync(join(target, 'DocumentMedia', 'a.png')));
    for (const path of ['benchmark-results', 'workspace/workspace.sqlite-shm', 'workspace/.runtime-owner.lock']) {
      assert.ok(!existsSync(join(target, path)), path);
    }
    assert.ok(existsSync(join(source, 'workspace', 'workspace.sqlite-shm')));
    await assert.rejects(cloneWorkspaceData(join(source, 'DocumentMedia'), target), { code: 'NOT_FOUND' });
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});


test('主产物存在时，插件必需文件缺失仍判为需要重建', () => {
  const root = mkdtempSync(join(tmpdir(), 'probe-plugin-build-'));
  try {
    execFileSync('git', ['init', '-q', root]);
    const plugin = join(root, 'packages/plugins/fixture');
    mkdirSync(plugin, { recursive: true });
    writeFileSync(join(plugin, 'plugin.json'), JSON.stringify({ id: 'fixture' }));
    writeFileSync(join(plugin, 'package.json'), JSON.stringify({ linnya: { development: {
      backendLoading: 'disk', backendWatchConfig: 'tsup.config.ts', requiredOutputs: ['dist/worker.html'],
    } } }));
    assert.deepEqual(buildFreshness(root), { stale: true, reason: '插件 fixture 缺少 dist/worker.html' });
    mkdirSync(join(plugin, 'dist')); writeFileSync(join(plugin, 'dist/worker.html'), 'ready');
    assert.match(buildFreshness(root).reason, /缺少 dist\/main/);
    writeFileSync(join(plugin, 'package.json'), JSON.stringify({ linnya: { development: {
      backendLoading: 'disk', backendWatchConfig: 'tsup.config.ts', requiredOutputs: ['../outside'],
    } } }));
    assert.throws(() => buildFreshness(root), /requiredOutputs/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('eval --main 只认本次 Desktop 日志里的 Main 调试口', () => {
  const log = 'DevTools listening on ws://127.0.0.1:5001/devtools/browser/x\nDebugger listening on ws://127.0.0.1:61234/5f0c-9a\n';
  assert.equal(readDesktopMainInspector(log), 'ws://127.0.0.1:61234/5f0c-9a');
  assert.equal(readDesktopMainInspector('Debugger listening on ws://0.0.0.0:61234/5f0c'), undefined);
  assert.equal(parseProbeArgs(['eval', '--main', '1']).values.main, true);
});

test('update-state 夹具按 Main 合同造完整快照，idle 不显示入口', () => {
  const now = Date.parse('2026-11-17T00:00:00Z');
  for (const status of UPDATE_FIXTURE_STATUSES) {
    const snapshot = updateFixtureSnapshot(status, { currentVersion: '0.2.1', now });
    assert.deepEqual(Object.keys(snapshot).sort(), ['currentVersion', 'enabled', 'failure', 'installedVersion', 'progress', 'releaseNotes', 'status', 'version']);
    assert.equal(snapshot.enabled, true);
    assert.equal(snapshot.progress !== null, ['downloading', 'paused'].includes(status), status);
  }
  assert.equal(updateFixtureSnapshot('idle', { currentVersion: '0.2.1' }).version, null);
  assert.equal(updateFixtureSnapshot('paused', { currentVersion: '0.2.1', now }).failure.retryAt, '2026-11-17T00:01:00.000Z');
  assert.throws(() => updateFixtureSnapshot('downloaded', { currentVersion: '0.2.1' }), /未知更新状态/);
});

test('标题栏不变量报出重叠、热区、遮挡、拖动区、截断与窗口按钮', () => {
  const header = { left: 0, right: 1400, top: 0, bottom: 36 };
  const at = (left, right) => ({ left, right, top: 6, bottom: 30 });
  const control = (key, group, left, right, extra = {}) => ({ key, group, rect: at(left, right), appRegion: 'no-drag', missedHits: [], ...extra });
  const clean = {
    viewport: { width: 1400, height: 900 }, header,
    dividers: [{ key: '侧栏分隔线', rect: { left: 256, right: 264, top: 0, bottom: 900 } }],
    trafficLights: trafficLightsRect({ x: 12, y: 11 }, header),
    elements: [
      control('settings', 'left', 142, 166),
      control('update-entry', 'update', 174, 254, { texts: [{ content: '重启更新', truncated: false, visibleWidth: 48, fontSize: 12 }] }),
      { key: 'title:main', group: 'title', rect: at(272, 848), texts: [{ content: '很长的项目名', truncated: true, visibleWidth: 40, fontSize: 12 }] },
      control('right:新对话', 'right', 1284, 1308),
    ],
  };
  assert.deepEqual(checkHeaderInvariants(clean), []);

  const broken = structuredClone(clean);
  broken.elements[0] = control('settings', 'left', 50, 74, { appRegion: 'drag' });
  broken.elements[1] = control('update-entry', 'update', 174, 260, {
    missedHits: [258], coveredBy: '调整左侧栏宽度', texts: [{ content: '重启更新', truncated: true, visibleWidth: 40, fontSize: 12 }],
  });
  broken.elements[2].texts[0].visibleWidth = 20;
  broken.elements.push(control('right:历史对话', 'right', 1300, 1324));
  const found = checkHeaderInvariants(broken).map(({ invariant, elements }) => `${invariant}:${elements.join('+')}`);
  assert.deepEqual(found.sort(), [
    'divider:update-entry+侧栏分隔线', 'drag-region:settings', 'hit:update-entry',
    'overlap:right:新对话+right:历史对话', 'text:title:main', 'text:update-entry', 'traffic-lights:settings',
  ]);
});
