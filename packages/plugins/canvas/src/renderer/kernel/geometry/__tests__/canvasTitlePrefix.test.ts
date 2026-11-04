import { expect, it } from 'vitest';
import { canvasTitlePrefix } from '../canvasTextGraphemes';

it('地图18字与近景120字前缀保留完整ZWJ、音标、旗帜及首行边界', () => {
  const combined = '👨‍👩‍👧‍👦e\u0301🇨🇳';
  expect(canvasTitlePrefix('中'.repeat(17) + combined, 18)).toBe('中'.repeat(17) + '👨‍👩‍👧‍👦');
  expect(canvasTitlePrefix('中'.repeat(119) + combined, 120)).toBe('中'.repeat(119) + '👨‍👩‍👧‍👦');
  expect(canvasTitlePrefix(combined + '\n第二行', 18)).toBe(combined);
  expect(canvasTitlePrefix('\n第二行', 18)).toBe('');
});

it('五万字正文只投影有限前缀，源正文与后续段落保留完整', () => {
  const body = 'e\u0301'.repeat(50000) + '\n末段';
  expect(canvasTitlePrefix(body, 18)).toBe('e\u0301'.repeat(18));
  expect(canvasTitlePrefix(body, 120)).toBe('e\u0301'.repeat(120));
});
