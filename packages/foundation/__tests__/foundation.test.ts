import { describe, expect, it } from 'vitest';
import { clamp, isRecord, sleep } from '../src/index.js';

describe('isRecord', () => {
  it('普通对象算，null、数组和基本类型不算', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord(Object.create(null))).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
    expect(isRecord([])).toBe(false);
    expect(isRecord('text')).toBe(false);
    expect(isRecord(0)).toBe(false);
    expect(isRecord(() => 1)).toBe(false);
  });
});

describe('clamp', () => {
  it('范围内原样返回，超出取边界', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
    expect(clamp(5, 8, 3)).toBe(8);
  });
});

describe('sleep', () => {
  it('到时间后完成', async () => {
    const startedAt = Date.now();
    await sleep(20);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(15);
  });
});
