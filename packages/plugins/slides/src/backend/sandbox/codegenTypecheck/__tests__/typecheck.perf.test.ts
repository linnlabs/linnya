import { describe, expect, it } from 'vitest';

import { typecheckCodegenSource } from '../typecheckCodegenSource.js';

const SHORT_LEGAL = `
const slide = createSlide();
slide.add(createText("hi"));
compose({ title: "x", slides: [slide] });
`;

const LONG_LEGAL = (() => {
  const slides = Array.from({ length: 12 }, (_, i) => `
const s${i} = createSlide();
s${i}.background = { color: "#FFFFFF" };
s${i}.add(createText({ content: "Title ${i}", fontSize: 32 }));
s${i}.add(createText({ content: "Body line ${i}", fontSize: 18 }));
`).join('\n');
  const compose = `compose({ title: "long deck", slides: [${
    Array.from({ length: 12 }, (_, i) => `s${i}`).join(', ')
  }] });`;
  return slides + '\n' + compose;
})();

const RUNS = 20;

function measure(source: string, runs: number): { p50: number; p95: number; max: number; mean: number } {
  // Warm-up — first call pays the lib.d.ts + ambient.d.ts amortization cost.
  typecheckCodegenSource(source);
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    samples.push(typecheckCodegenSource(source).elapsedMs);
  }
  samples.sort((a, b) => a - b);
  const p50 = samples[Math.floor(samples.length * 0.5)];
  const p95 = samples[Math.floor(samples.length * 0.95)] ?? samples[samples.length - 1];
  const max = samples[samples.length - 1];
  const mean = samples.reduce((s, v) => s + v, 0) / samples.length;
  return { p50, p95, max, mean };
}

// 性能基准受机器负载影响很大，默认插件单测只作为正确性门禁。
// 这组用例保留为本地专项回归入口，避免把环境波动误判成业务失败。
describe.skip('typecheckCodegenSource — performance baseline (P2.2)', () => {
  // Locked baseline (2026-04-25, 5-line minimal deck on M-series Mac):
  //   p50 ≈ 4 ms, p95 ≈ 10 ms, max ≈ 15 ms, mean ≈ 5 ms
  //
  // The asserted ceilings carry ~3x slack to absorb CI variance, but a
  // serious regression (e.g. lost lib.d.ts cache) would push p95 above 30 ms
  // and trip this test loud and clear.
  it('warm short-deck typecheck p95 < 30ms (asserts ambient & lib caching pays off)', () => {
    const stats = measure(SHORT_LEGAL, RUNS);
    expect(stats.p95).toBeLessThan(30);
    expect(stats.p50).toBeLessThan(15);
  });

  it('warm long-deck (12 slides) typecheck p95 < 60ms', () => {
    const stats = measure(LONG_LEGAL, RUNS);
    expect(stats.p95).toBeLessThan(60);
    expect(stats.mean).toBeLessThan(40);
  });
});
