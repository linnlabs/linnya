import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { waitFor } from '../infrastructure/cdpClient.mjs';
import { instanceRoot, readOptional, readSession } from '../infrastructure/instanceStore.mjs';
import { sameProcess, signalOwner } from '../infrastructure/processTree.mjs';
import { acceptance } from './probeAcceptance.mjs';

const name = `toy-${process.pid}`;
const root = instanceRoot(name);
const test = acceptance(name);
const { run, probe } = test;
let result;
try {
  // 旧版留下的无主锁目录也应当能直接接管。
  const ownerFile = join(`${root}.lock`, 'owner.json');
  mkdirSync(`${root}.lock`, { recursive: true });
  const up = await run('up', '--entry', 'toy', '--size', '960x640');
  assert.ok(readSession(root).processes.some(entry => entry.pid === up.electron.pid));
  assert.ok(!Object.hasOwn(up, 'processes'));
  const store = new URL('../infrastructure/instanceStore.mjs', import.meta.url);
  const holder = spawn(process.execPath, ['--input-type=module', '-e',
    `import { withLifecycleLock } from ${JSON.stringify(store.href)};
    await withLifecycleLock(process.argv[1], () => new Promise(() => setInterval(() => {}, 1000)));`,
    root], { stdio: 'ignore' });
  const holderExit = once(holder, 'exit');
  try {
    const owner = await waitFor(() => JSON.parse(readOptional(ownerFile) ?? 'null'), '生命周期锁', 2000);
    assert.equal(owner.pid, holder.pid);
    assert.ok(owner.startedAt);
    assert.equal((await probe('stop')).error?.code, 'BUSY');
  } finally {
    holder.kill('SIGKILL');
    await holderExit;
  }
  assert.ok(existsSync(ownerFile), 'SIGKILL 后应留下用于验证接管的身份记录');
  const reused = await run('up');
  assert.ok(!existsSync(ownerFile));
  assert.equal(reused.supervisor.pid, up.supervisor.pid);
  assert.equal(reused.reused, true);
  assert.ok(reused.ms < 500, 'warm up 超过 500ms');
  const snapshot = await run('snapshot', '--json');
  const button = snapshot.entries.find(entry => entry.name === '检查点击');
  assert.equal(snapshot.page.width, 960);
  assert.equal(snapshot.page.height, 640);
  await run('click', button.ref);
  assert.equal((await run('eval', 'document.querySelector("#status").textContent')).value, 'true');
  await run('dblclick', button.ref);
  await run('wait', '--text', 'double');
  await run('type', '中文输入', '#input');
  await run('press', 'Enter');
  await run('wait', '--text', 'enter:中文输入');
  await run('press', 'Meta+A');
  const selection = await run('eval', '(() => { const input = document.querySelector("#input"); return [input.selectionStart, input.selectionEnd]; })()');
  assert.deepEqual(selection.value, [0, '中文输入'.length]);
  const inputValue = () => run('eval', 'document.querySelector("#input").value').then(result => result.value);
  await run('type', '替换');
  assert.equal(await inputValue(), '替换');
  await run('press', 'Meta+Z');
  assert.equal(await inputValue(), '中文输入');
  await run('press', 'Shift+Meta+Z');
  assert.equal(await inputValue(), '替换');
  await run('hover', '#hover');
  assert.equal((await run('eval', 'getComputedStyle(document.querySelector("#hover")).color')).value, 'rgb(255, 0, 0)');
  await run('scroll', '#scrollbox', '--dy', '170');
  await run('wait', '--expr', 'document.querySelector("#scrollbox").scrollTop > 100');
  const sample = 'document.querySelector("#handle").getBoundingClientRect().left';
  const drag = await run('drag', '#handle', '--by', '80,0', '--steps', '8', '--sample', sample, '--expect-follow', 'x');
  assert.equal(drag.samples.length, 8);
  const bad = await probe('drag', '#handle', '--by', '30,0', '--steps', '3', '--sample', '0', '--expect-follow', 'x');
  assert.equal(bad.error.code, 'FOLLOW_MISMATCH');
  const shot = await run('shot');
  assert.deepEqual(shot.artifacts.map(item => [item.width, item.height]), [[960, 640]]);
  const clipped = await run('shot', '--clip', '0,0,150,100', '--jpeg');
  assert.deepEqual(clipped.artifacts.map(item => [item.width, item.height]), [[150, 100]]);
  const early = await run('logs', '--level', 'error');
  assert.ok(early.entries.some(entry => entry.text.includes('probe fixture startup error')));
  const curve = await run('record', 'curve', '--target', '#animated', '--props', 'width', '--duration', '650', '--', 'click', '#animate');
  assert.ok(curve.metrics.width.monotonic);
  assert.ok(Math.abs(curve.metrics.width.durationMs - 400) <= 20, JSON.stringify(curve.metrics));
  const frames = await run('record', 'frames', '--target', '#animated', '--at', '0,100,100,350', '--', 'click', '#animate');
  assert.equal(frames.frames[1].sha256, frames.frames[2].sha256, '同一时刻定格必须确定');
  assert.notEqual(frames.frames[0].sha256, frames.frames[3].sha256);
  await run('reload');
  assert.equal((await probe('click', button.ref)).error?.code, 'STALE_REF');
  await run('eval', "localStorage.setItem('restart-test','kept')");
  const restarted = await run('restart');
  assert.notEqual(restarted.supervisor.pid, up.supervisor.pid);
  assert.equal((await run('eval', "localStorage.getItem('restart-test')")).value, 'kept');
  signalOwner(restarted.supervisor, 'SIGKILL');
  await waitFor(() => !sameProcess(restarted.supervisor), '看管进程强制退出', 5000);
  assert.ok(sameProcess(restarted.electron));
  const recovered = await run('up', '--entry', 'toy', '--size', '960x640');
  assert.notEqual(recovered.electron.pid, restarted.electron.pid);
  assert.equal((await run('eval', "localStorage.getItem('restart-test')")).value, 'kept');
  const expired = new Date(Date.now() - 31 * 60_000);
  utimesSync(join(recovered.root, 'last-used'), expired, expired);
  await waitFor(() => readSession(recovered.root)?.stopReason === 'idle', '空闲自动关闭', 10_000);
  result = { idleExit: true, orphanRecovered: true, staleLockRecovered: true, readyMs: up.readyMs, reuseMs: reused.ms, drag: drag.samples, curve: curve.metrics, frames: frames.frames };
} catch (error) {
  console.error(error);
  throw error;
} finally {
  const exit = await test.finish({ clean: Boolean(result) });
  if (result) console.log(JSON.stringify({ ok: true, ...result, ...exit }));
}
