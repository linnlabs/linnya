import { describe, expect, it } from 'vitest';
import { readThemeSpecInput } from '../styleParsers';

const DIRECTION = {
  drawId: 'seed-1',
  cardId: 'risograph',
  palette: { backgrounds: ['#F2E6D0'], ink: '#1A1A1A', accents: ['#E8442E'] },
  fonts: ['Georgia'],
};

describe('readThemeSpecInput direction', () => {
  it('保留合法的方向声明，缺省时不写入', () => {
    expect(readThemeSpecInput({ direction: DIRECTION }).theme?.direction).toEqual(DIRECTION);
    expect(readThemeSpecInput({}).theme).not.toHaveProperty('direction');
  });

  it('颜色格式或字段不合法时指出具体路径', () => {
    const badColor = readThemeSpecInput({ direction: { ...DIRECTION, palette: { ...DIRECTION.palette, ink: 'black' } } });
    expect(badColor.error).toContain('theme.direction.palette.ink');
    const extra = readThemeSpecInput({ direction: { ...DIRECTION, motif: '饕餮' } });
    expect(extra.error).toContain('theme.direction');
  });
});
