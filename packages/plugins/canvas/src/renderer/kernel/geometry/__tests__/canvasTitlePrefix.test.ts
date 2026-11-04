import { expect, it } from 'vitest';
import { canvasTitlePrefix } from '../canvasTextGraphemes';

it('地图18字与近景120字前缀保留完整ZWJ、音标、旗帜及首行边界', () => {
  const combined = '👨‍👩‍👧‍👦e\u0301🇨🇳';
  expect(canvasTitlePrefix('中'.repeat(17) + combined, 18)).toBe('中'.repeat(17) + '👨‍👩‍👧‍👦');
  expect(canvasTitlePrefix('中'.repeat(119) + combined, 120)).toBe('中'.repeat(119) + '👨‍👩‍👧‍👦');
  expect(canvasTitlePrefix(combined + '\n第二行', 18)).toBe(combined);
  expect(canvasTitlePrefix('\n第二行', 18)).toBe('');
  expect(canvasTitlePrefix('短行\r\n第二行', 18)).toBe('短行');
});

it('完整短标题与18/120长度边界保留原串，包括组合音标与完整emoji字簇', () => {
  for (const title of ['', '中文标题', '👨‍👩‍👧‍👦e\u0301🇨🇳', '中'.repeat(18)]) {
    expect(canvasTitlePrefix(title, 18)).toBe(title);
  }
  expect(canvasTitlePrefix('中'.repeat(120), 120)).toBe('中'.repeat(120));
});

it('五万字正文只投影有限前缀，源正文与后续段落保留完整', () => {
  const body = 'e\u0301'.repeat(50000) + '\n末段';
  expect(canvasTitlePrefix(body, 18)).toBe('e\u0301'.repeat(18));
  expect(canvasTitlePrefix(body, 120)).toBe('e\u0301'.repeat(120));
});
