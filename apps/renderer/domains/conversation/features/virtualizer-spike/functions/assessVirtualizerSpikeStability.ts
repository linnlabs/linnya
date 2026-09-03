import type {
  VirtualizerSpikeFrameSample,
  VirtualizerSpikeStabilityResult,
} from '../definitions/virtualizerSpike';

export function assessVirtualizerSpikeStability(input: {
  readonly baseline: number;
  readonly samples: readonly VirtualizerSpikeFrameSample[];
  readonly thresholdPx: number;
}): VirtualizerSpikeStabilityResult {
  let maxDriftPx = 0;
  let missingFrames = 0;

  for (const sample of input.samples) {
    if (sample.value === null) {
      missingFrames += 1;
      continue;
    }
    maxDriftPx = Math.max(maxDriftPx, Math.abs(sample.value - input.baseline));
  }

  return {
    passed:
      input.samples.length > 0
      && missingFrames === 0
      && maxDriftPx < input.thresholdPx,
    baseline: input.baseline,
    maxDriftPx,
    missingFrames,
    samples: input.samples,
  };
}
