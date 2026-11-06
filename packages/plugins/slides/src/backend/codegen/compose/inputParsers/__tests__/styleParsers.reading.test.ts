import { describe, expect, it } from 'vitest';
import { readThemeSpecInput } from '../styleParsers';

describe('readThemeSpecInput reading', () => {
  it('保留合法阅读方式，缺省时不写入', () => {
    expect(readThemeSpecInput({ reading: 'present' })).toEqual({ theme: { reading: 'present' } });
    expect(readThemeSpecInput({ reading: 'read' })).toEqual({ theme: { reading: 'read' } });
    expect(readThemeSpecInput({ fontTarget: 'local' }).theme).not.toHaveProperty('reading');
  });

  it('拒绝未知阅读方式', () => {
    expect(readThemeSpecInput({ reading: 'slides' }).error).toContain('theme.reading');
  });
});
