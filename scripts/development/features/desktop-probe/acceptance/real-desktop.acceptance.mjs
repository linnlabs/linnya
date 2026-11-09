import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { repoRoot } from '../definitions/probeContract.mjs';
import { acceptance } from './probeAcceptance.mjs';

const test = acceptance(`real-${process.pid}`);
const { run } = test;
const dist = join(repoRoot, 'dist');
function buildFiles() {
  return readdirSync(dist, { recursive: true, withFileTypes: true }).filter(entry => entry.isFile()).map(entry => {
    const path = join(entry.parentPath, entry.name);
    const { size, mtimeMs } = statSync(path);
    return [path, size, mtimeMs];
  }).sort(([left], [right]) => left.localeCompare(right));
}
const initialBuild = buildFiles();
const evidence = mkdtempSync(join(tmpdir(), 'linnya-probe-real-'));
let result;
try {
  const up = await run('up', '--size', '1400x900', '--mode', 'dev');
  assert.ok(up.readyMs < 10_000, `冷启动 ${up.readyMs}ms`);
  assert.equal(up.options.mode, 'dev');
  const snapshot = await run('snapshot', '--json');
  assert.ok(Buffer.byteLength(snapshot.snapshot) < 2048);
  assert.deepEqual([snapshot.page.width, snapshot.page.height], [1400, 900]);
  const kb = snapshot.entries.find(entry => entry.role === 'button' && entry.name === '知识库');
  assert.ok(kb?.ref);
  await run('click', kb.ref);
  await run('wait', '--text', '新建知识库');
  const fixture = await run('fixture', 'project-overview');
  const project = JSON.stringify(fixture.projectId);
  await run('eval', `(async () => {
    const { getWorkspaceNavigationPort } = await import('/apps/renderer/shared/ports/workspaceNavigationPort.ts');
    await getWorkspaceNavigationPort().openProjectOverview(${project});
    return true;
  })()`);
  await run('wait', '--expr', `document.querySelectorAll('.project-overview__row').length === ${fixture.documents}`);
  const overview = await run('snapshot', '--within', '.project-overview', '--all', '--max-lines', '100');
  assert.match(overview.snapshot, /行业报告/);
  assert.match(overview.snapshot, /演示稿/);
  copyFileSync(overview.artifacts[0].path, join(evidence, 'overview.txt'));
  const handle = '.project-overview__resize';
  const divider = `(() => {const r=document.querySelector('${handle}').getBoundingClientRect();return r.x+r.width/2})()`;
  const drag = await run('drag', handle, '--by', '80,0', '--steps', '8', '--sample', divider, '--expect-follow', 'x');
  assert.equal(drag.samples.length, 8);
  const shot = await run('shot', '--selector', '.project-overview__table', '--pad', '4');
  copyFileSync(shot.artifacts[0].path, join(evidence, 'overview.png'));
  const rowIndex = (await run('eval', `[...document.querySelectorAll('.project-overview__row')].findIndex(row=>row.innerText.includes('演示稿'))`)).value;
  assert.ok(rowIndex >= 0);
  await run('click', `.project-overview__row:nth-child(${rowIndex + 1}) .project-overview__name`);
  await run('wait', '--selector', '.slides-page');
  const slides = await run('shot', '--selector', '.slides-page');
  copyFileSync(slides.artifacts[0].path, join(evidence, 'slides.png'));
  const logs = await run('logs', '--level', 'error');
  assert.equal(logs.total, 0, JSON.stringify(logs.entries));
  assert.deepEqual(buildFiles(), initialBuild, '探针启动不能重写 dist');
  result = { readyMs: up.readyMs, snapshotBytes: Buffer.byteLength(snapshot.snapshot), fixture, drag: drag.samples, evidence, distUnchanged: true };
} catch (error) {
  console.error(error);
  throw error;
} finally {
  const exit = await test.finish({ clean: Boolean(result) });
  if (result) console.log(JSON.stringify({ ok: true, ...result, ...exit }));
}
