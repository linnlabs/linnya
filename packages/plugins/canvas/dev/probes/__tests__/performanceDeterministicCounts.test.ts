import { expect, it } from 'vitest';
import { readCanvasDeterministicCounts } from '../performanceDeterministicCounts';

it('完整确定性计数只接纳显式离屏夹具，不让计时、录制或过滤子集冒充六组门禁', () => {
  expect(readCanvasDeterministicCounts({ CANVAS_PERFORMANCE_INTERNAL_120: '1' })).toBeNull();
  const requested = { CANVAS_PERFORMANCE_DETERMINISTIC: '1' };
  for (const profile of ['SOFTWARE', 'OFFSCREEN']) {
    expect(readCanvasDeterministicCounts({ ...requested, [`CANVAS_PERFORMANCE_${profile}`]: '1' })?.kind).toBe('deterministic-counts');
  }
  expect(() => readCanvasDeterministicCounts(requested)).toThrow('requires_offscreen_profile');
  expect(() => readCanvasDeterministicCounts({ CANVAS_PERFORMANCE_DETERMINISTIC: 'window' })).toThrow('flag');
  for (const conflict of ['INTERNAL_120', 'BODY_TRACE', 'CPU_PROFILE', 'COUNTS', 'KINDS', 'DISTRIBUTIONS', 'MEDIA', 'DRAG', 'OUTPUT_CONTROL', 'STAGING_CONTEXT_CONTROL']) {
    expect(() => readCanvasDeterministicCounts({ ...requested, CANVAS_PERFORMANCE_OFFSCREEN: '1', [`CANVAS_PERFORMANCE_${conflict}`]: '1' })).toThrow('conflicting_mode');
  }
});
