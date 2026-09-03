import { describe, expect, it } from 'vitest';
import { buildTaskStateStepRows } from './buildTaskStateStepRows';

describe('buildTaskStateStepRows', () => {
  it('把唯一 next step 业务项映射为稳定展示身份', () => {
    expect(buildTaskStateStepRows(['实现合同', '验证回放'])).toEqual([
      { id: '实现合同', text: '实现合同' },
      { id: '验证回放', text: '验证回放' },
    ]);
  });

  it('拒绝无法区分身份的重复 next step', () => {
    expect(() => buildTaskStateStepRows(['验证回放', '验证回放']))
      .toThrow('duplicate item');
  });
});
