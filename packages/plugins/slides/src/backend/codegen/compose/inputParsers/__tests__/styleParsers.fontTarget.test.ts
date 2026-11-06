import { describe, expect, it } from 'vitest';
import { readThemeSpecInput } from '../styleParsers';

describe('readThemeSpecInput fontTarget', () => {
  it('保留合法目标环境，缺省时不写入', () => {
    expect(readThemeSpecInput({ fontTarget: 'local' })).toEqual({ theme: { fontTarget: 'local' } });
    expect(readThemeSpecInput({ fonts: { major: 'KaiTi', minor: 'Microsoft YaHei' } }).theme)
      .not.toHaveProperty('fontTarget');
  });

  it('拒绝未知目标环境', () => {
    expect(readThemeSpecInput({ fontTarget: 'windows' }).error).toContain('theme.fontTarget');
  });
});
