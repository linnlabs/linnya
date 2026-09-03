import { describe, expect, it } from 'vitest';

import { LINNYA_COMMAND_PRODUCTION_CONSTRUCTION_POLICY } from '../definitions/linnyaCommandConstructionPolicy';
import { validateCommandConstructionPolicy } from './validateCommandConstructionPolicy';

describe('validateCommandConstructionPolicy', () => {
  it('使用 Validation 109 冻结的唯一生产容量与超时事实', () => {
    expect(LINNYA_COMMAND_PRODUCTION_CONSTRUCTION_POLICY).toEqual({
      defaultHardTimeoutMs: 180_000,
      maximumHardTimeoutMs: 600_000,
      maximumActiveExecutions: 4,
    });
    expect(Object.isFrozen(LINNYA_COMMAND_PRODUCTION_CONSTRUCTION_POLICY)).toBe(true);
  });

  it('接受实验冻结后的正整数事实并返回不可变副本', () => {
    const input = {
      defaultHardTimeoutMs: 120_000,
      maximumHardTimeoutMs: 600_000,
      maximumActiveExecutions: 8,
    };
    const validated = validateCommandConstructionPolicy(input);

    expect(validated).toEqual(input);
    expect(validated).not.toBe(input);
    expect(Object.isFrozen(validated)).toBe(true);
  });

  it('拒绝非正整数和默认值超过最大值', () => {
    expect(() => validateCommandConstructionPolicy({
      defaultHardTimeoutMs: 0,
      maximumHardTimeoutMs: 600_000,
      maximumActiveExecutions: 8,
    })).toThrow('construction policy is invalid');
    expect(() => validateCommandConstructionPolicy({
      defaultHardTimeoutMs: 700_000,
      maximumHardTimeoutMs: 600_000,
      maximumActiveExecutions: 8,
    })).toThrow('construction policy is invalid');
    expect(() => validateCommandConstructionPolicy({
      defaultHardTimeoutMs: 120_000,
      maximumHardTimeoutMs: 600_000,
      maximumActiveExecutions: 1.5,
    })).toThrow('construction policy is invalid');
  });
});
