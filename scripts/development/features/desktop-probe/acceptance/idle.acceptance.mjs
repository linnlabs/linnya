import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { acceptance } from './probeAcceptance.mjs';

const test = acceptance(`idle-${process.pid}`, { sampleInterval: 1000 });
const { run } = test;
let result;
try {
  const up = await run('up');
  console.error(`[probe-idle] ${up.options.name} 已就绪，等待 10 分钟`);
  const begin = Date.now();
  await sleep(10 * 60_000);
  const sample = await run('eval', `new Promise(resolve => {
    const start = performance.now();
    let frames = 0;
    let ticks = 0;
    const timer = setInterval(() => ticks++, 100);
    function frame(now) {
      frames++;
      if (now - start < 1000) requestAnimationFrame(frame);
      else {
        clearInterval(timer);
        const seconds = (now - start) / 1000;
        resolve({ fps: (frames - 1) / seconds, drift: Math.abs(ticks / seconds - 10) / 10 });
      }
    }
    requestAnimationFrame(frame);
  })`);
  assert.ok(sample.value.fps >= 55, JSON.stringify(sample.value));
  assert.ok(sample.value.drift < 0.2, JSON.stringify(sample.value));
  const shot = await run('shot');
  assert.ok(shot.ms < 300, `空闲后截图 ${shot.ms}ms`);
  result = { idleMs: Date.now() - begin, ...sample.value, shotMs: shot.ms, readyMs: up.readyMs };
} finally {
  const exit = await test.finish({ clean: Boolean(result) });
  if (result) console.log(JSON.stringify({ ok: true, ...result, ...exit }));
}
