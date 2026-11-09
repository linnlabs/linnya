export function measureCurve(samples, property) {
  const numeric = samples.map(sample => ({ t: sample.t, value: Number.parseFloat(sample.values?.[property]) }))
    .filter(sample => Number.isFinite(sample.value));
  const first = numeric[0];
  const last = numeric.at(-1);
  if (!first || first === last || first.value === last.value) return null;
  const progress = numeric.map(sample => (sample.value - first.value) / (last.value - first.value));
  const startIndex = Math.max(0, progress.findIndex(value => Math.abs(value) > 0.0001) - 1);
  const endIndex = progress.findIndex((value, index) => index > startIndex && Math.abs(value - 1) < 0.0001 &&
    progress.slice(index).every(tail => Math.abs(tail - 1) < 0.0001));
  const start = numeric[startIndex].t;
  const duration = numeric[endIndex].t - start;
  const quartiles = [0.25, 0.5, 0.75].map(fraction => {
    const target = start + duration * fraction;
    const index = numeric.findIndex(sample => sample.t >= target);
    const before = numeric[index - 1];
    if (!before || index === 0) return progress[0];
    const after = numeric[index];
    return progress[index - 1] + (progress[index] - progress[index - 1]) * (target - before.t) / (after.t - before.t);
  });
  return {
    delayMs: start, durationMs: duration, quartiles,
    overshoot: Math.max(...progress) - 1,
    monotonic: progress.every((value, index) => !index || value >= progress[index - 1] - 0.0001),
  };
}
