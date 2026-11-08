import { describe, expect, it } from 'vitest';
import type { ColorPaletteSuggestion } from '@app/schemas/color-palette';
import { formatPaletteCheck, formatPaletteSuggestion } from '../functions/formatPalette';
import { parsePaletteCommand } from '../functions/parsePaletteCommand';

describe('parsePaletteCommand', () => {
  it('颜色可以不带 #（Shell 会把 # 后面当注释），也可以逗号连写，统一成小写 hex', () => {
    expect(parsePaletteCommand(['suggest', 'a.jpg', 'conversation:/b.png', '--color', '1F3A5F,#C8A24A', '--avoid', 'f00', '--accents', '4', '--n', '2', '--base', 'dark']))
      .toEqual({
        kind: 'suggest', images: ['a.jpg', 'conversation:/b.png'], preview: false, json: false,
        options: { pinnedColors: ['#1f3a5f', '#c8a24a'], avoidColors: ['#f00'], accentCount: 4, count: 2, base: 'dark' },
      });
  });

  it('--rng 接受单套编号，按整组复现', () => {
    expect(parsePaletteCommand(['suggest', 'a.jpg', '--rng', 'pl8f2a-2'])).toMatchObject({ options: { rng: 'pl8f2a' } });
  });

  it('没有任何颜色来源、参数不成立时拒绝', () => {
    expect(() => parsePaletteCommand(['suggest'])).toThrow('至少一项');
    expect(() => parsePaletteCommand(['suggest', 'a.jpg', '--color', 'blue'])).toThrow('颜色无效');
    expect(() => parsePaletteCommand(['suggest', 'a.jpg', '--n', 'two'])).toThrow('整数');
    expect(() => parsePaletteCommand(['suggest', 'a.jpg', '--base', 'paper'])).toThrow('--base');
    expect(() => parsePaletteCommand(['suggest', 'a.jpg', '--output', 'x'])).toThrow();
    expect(() => parsePaletteCommand(['use', 'pl8f2a-1'])).toThrow('未知子命令');
  });

  it('check 解析角色、列表和排除区，兼容输出里带度数符号的写法', () => {
    expect(parsePaletteCommand(['check', '--bg', 'ffffff', '--sf', 'f2f2f2', '--ink', '111111', '--mu', '555555', '--ac', '1f3a5f,c8a24a', '--ch', '112233', '--ch', '445566', '--excluded', '315°-15°,225-285', '--color', '1f3a5f', '--json']))
      .toEqual({
        kind: 'check', json: true,
        input: {
          palette: { bg: '#ffffff', surface: '#f2f2f2', ink: '#111111', muted: '#555555', accent: ['#1f3a5f', '#c8a24a'], chart: ['#112233', '#445566'] },
          excludedHues: [[315, 15], [225, 285]],
          pinnedColors: ['#1f3a5f'],
        },
      });
    expect(() => parsePaletteCommand(['check', '--bg', 'ffffff'])).toThrow('缺少');
    expect(() => parsePaletteCommand(['check', '--bg', 'fff', '--sf', 'fff', '--ink', '000', '--mu', '555', '--ac', '123', '--ch', '123', '--excluded', '400-10'])).toThrow('--excluded');
  });
});

describe('紧凑输出', () => {
  const suggestion: ColorPaletteSuggestion = {
    id: 'pl8f2a',
    subject: [
      { hex: '#1f3a5f', name: '藏青', share: 0, images: 0, spot: false, pinned: true },
      { hex: '#4e7a68', name: '锈绿', share: 0.58, images: 3, spot: false, pinned: false },
      { hex: '#b03a2e', name: '朱红', share: 0.01, images: 1, spot: true, pinned: false },
    ],
    excludedHues: [[315, 15]],
    palettes: [{
      id: 'pl8f2a-1', relation: 'analog', base: 'tint', tone: 'native', bg: '#eef2ee', surface: '#e0e8e2', ink: '#1e2b25', muted: '#5a6b62',
      accent: ['#1f3a5f', '#2f6b57'], chart: ['#2f6b57', '#6f9a86'],
    }],
  };

  it('首行是取色结论，之后一行一套，预览和跳过的图片都写明', () => {
    const text = formatPaletteSuggestion({ suggestion, skippedImages: ['bad.jpg'], preview: 'conversation:/palette-pl8f2a-abc.png' });
    const lines = text.trimEnd().split('\n');
    expect(lines[0]).toContain('本色 藏青#1f3a5f(指定) 锈绿#4e7a68(58%,3图) 朱红#b03a2e(1%,1图,点缀)');
    expect(lines[0]).toContain('315°-15°');
    expect(lines[0]).toContain('读不出 bad.jpg');
    expect(lines[1]).toMatch(/^pl8f2a-1 邻近色·染纸·\S+ bg#eef2ee sf#e0e8e2 ink#1e2b25 mu#5a6b62 ac#1f3a5f,#2f6b57 ch#2f6b57,#6f9a86$/u);
    expect(lines[2]).toContain('conversation:/palette-pl8f2a-abc.png');
  });

  it('检查结果：通过一个词，不合格逐项列出并给建议', () => {
    expect(formatPaletteCheck({ ok: true, findings: [], suggested: null })).toBe('通过\n');
    const draft = { bg: '#ffffff', surface: '#f2f2f2', ink: '#111111', muted: '#555555', accent: ['#1f3a5f'], chart: ['#112233'] };
    expect(formatPaletteCheck({
      ok: false,
      findings: [
        { rule: 'ink_contrast', role: 'ink', value: '#999999', measured: 2.85, required: 7 },
        { rule: 'chart_order', role: 'chart', value: '#a,#b' },
      ],
      suggested: draft,
    })).toBe('不合格 2 项\nink_contrast ink #999999 2.85<7\nchart_order chart\n建议 bg#ffffff sf#f2f2f2 ink#111111 mu#555555 ac#1f3a5f ch#112233\n');
    expect(formatPaletteCheck({ ok: false, findings: [{ rule: 'invalid_color', role: 'bg', value: 'x' }], suggested: null })).toContain('无法自动修复');
  });
});
