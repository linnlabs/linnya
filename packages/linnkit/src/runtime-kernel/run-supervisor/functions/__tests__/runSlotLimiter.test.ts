import { describe, expect, it } from 'vitest';

import { RunConcurrencyLimitExceededError } from '../../runErrors';
import { createRunSlotLimiter } from '../runSlotLimiter';
import { RunIdSchema } from '../../../../contracts';

describe('runSlotLimiter', () => {
  it('maxActiveRuns 未配置时不限流', () => {
    const limiter = createRunSlotLimiter();

    limiter.acquire(RunIdSchema.parse('run-1'));
    limiter.acquire(RunIdSchema.parse('run-2'));
    limiter.acquire(RunIdSchema.parse('run-3'));

    expect(limiter.activeCount()).toBe(3);
  });

  it('达到 maxActiveRuns 后 acquire 抛结构化限流错误', () => {
    const limiter = createRunSlotLimiter({ maxActiveRuns: 2 });

    limiter.acquire(RunIdSchema.parse('run-1'));
    limiter.acquire(RunIdSchema.parse('run-2'));

    expect(() => limiter.acquire(RunIdSchema.parse('run-3'))).toThrow(
      RunConcurrencyLimitExceededError
    );
    expect(() => limiter.acquire(RunIdSchema.parse('run-3'))).toThrow(
      'RunSupervisor: maxActiveRuns=2 exceeded while registering run run-3'
    );
    expect(limiter.activeCount()).toBe(2);
  });

  it('release 后释放名额', () => {
    const limiter = createRunSlotLimiter({ maxActiveRuns: 1 });

    limiter.acquire(RunIdSchema.parse('run-1'));
    limiter.release(RunIdSchema.parse('run-1'));
    limiter.acquire(RunIdSchema.parse('run-2'));

    expect(limiter.activeCount()).toBe(1);
  });

  it('重复 acquire 同一个 runId 不重复占用名额', () => {
    const limiter = createRunSlotLimiter({ maxActiveRuns: 1 });

    limiter.acquire(RunIdSchema.parse('run-1'));
    limiter.acquire(RunIdSchema.parse('run-1'));

    expect(limiter.activeCount()).toBe(1);
  });

  it('maxActiveRuns 非正整数时 fail-fast', () => {
    expect(() => createRunSlotLimiter({ maxActiveRuns: 0 })).toThrow(RangeError);
    expect(() => createRunSlotLimiter({ maxActiveRuns: 1.5 })).toThrow(RangeError);
  });
});
