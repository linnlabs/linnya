import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vitest';
import { repoRoot } from '../definitions/probeContract.mjs';
import { feedsDesktopBundle, judgeBuildFreshness } from '../functions/desktopBundleSources.mjs';
import { launchOptions, parseProbeArgs } from '../functions/parseProbeArgs.mjs';
import { renderSnapshot } from '../functions/renderSnapshot.mjs';
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
});

test('任一 Desktop 产物比源码旧就判过期；Renderer 与测试文件不触发重建', () => {
  const outputs = [{ path: 'main.cjs', mtimeMs: 300 }, { path: 'app-server-backend.cjs', mtimeMs: 100 }];
  assert.deepEqual(judgeBuildFreshness(outputs, [{ path: 'src/a.ts', mtimeMs: 200 }]),
    { stale: true, reason: 'src/a.ts 比 app-server-backend.cjs 新' });
  assert.equal(judgeBuildFreshness(outputs, [{ path: 'src/a.ts', mtimeMs: 50 }]).stale, false);
  assert.equal(judgeBuildFreshness([{ path: 'main.cjs' }], []).stale, true);
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
