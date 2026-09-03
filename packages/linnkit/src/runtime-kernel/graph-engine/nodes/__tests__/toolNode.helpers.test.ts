import { describe, expect, it } from 'vitest';
import {
  isRecord,
  parseJsonSafe,
  readString,
} from '../toolNode.helpers';

describe('toolNode.helpers', () => {
  it('parseJsonSafe 应对合法与非法 JSON 保持稳定', () => {
    expect(parseJsonSafe('{"ok":true}')).toEqual({ ok: true });
    expect(parseJsonSafe('not-json')).toBeNull();
    expect(parseJsonSafe(undefined)).toBeNull();
  });

  it('isRecord / readString 提供最小收窄能力', () => {
    expect(isRecord({ ok: true })).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(readString('  hello  ')).toBe('hello');
    expect(readString('   ')).toBeUndefined();
  });
});
