import { describe, expect, it } from 'vitest';
import { projectContextWindowUsageTrack } from './projectContextWindowUsageTrack';

describe('projectContextWindowUsageTrack', () => {
  it('保持总体预算占比，并在已用区域内保留每个非零组成', () => {
    const budget = 229_600;
    const result = projectContextWindowUsageTrack([
      { id: 'system_prompt', share: 1_250 / budget, tone: 'system' },
      { id: 'tool_definitions', share: 9_279 / budget, tone: 'tools' },
      { id: 'conversation', share: 66 / budget, tone: 'conversation' },
    ]);

    expect(result.usedShare).toBe(10_595 / budget);
    expect(result.segments.map(segment => segment.id)).toEqual([
      'system_prompt',
      'tool_definitions',
      'conversation',
    ]);
    expect(result.segments.reduce((sum, segment) => sum + segment.relativeShare, 0)).toBe(1);
  });

  it('不为零 token 组成制造可见色段', () => {
    const result = projectContextWindowUsageTrack([
      { id: 'system_prompt', share: 0.1, tone: 'system' },
      { id: 'conversation', share: 0, tone: 'conversation' },
      { id: 'tool_definitions', share: 0.2, tone: 'tools' },
    ]);

    expect(result.usedShare).toBeCloseTo(0.3);
    expect(result.segments.map(segment => segment.id)).toEqual([
      'system_prompt',
      'tool_definitions',
    ]);
  });
});
