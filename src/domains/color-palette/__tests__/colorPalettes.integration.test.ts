import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
  ColorPaletteCheckOutcomeSchema,
  ColorPaletteSuggestOutcomeSchema,
  type ColorPaletteSuggestOutcome,
} from '@app/schemas/color-palette';
import { checkColorPalette, renderPalettePreview, suggestColorPalettes } from '..';

async function twoColorPng(left: string, right: string): Promise<Uint8Array> {
  const half = await sharp({ create: { width: 32, height: 64, channels: 3, background: right } }).png().toBuffer();
  return await sharp({ create: { width: 64, height: 64, channels: 3, background: left } })
    .composite([{ input: half, left: 32, top: 0 }])
    .png()
    .toBuffer();
}

function suggestion(outcome: ColorPaletteSuggestOutcome) {
  if (outcome.status !== 'ok') throw new Error(`${outcome.code}: ${outcome.message}`);
  return outcome;
}

describe('配色 Core 能力', () => {
  it('从真实编码的图片出配色，输出符合跨边界合同，同一编号逐字节复现', async () => {
    const images = [await twoColorPng('#4e7a68', '#9a7440'), await twoColorPng('#3f6b5a', '#a07a48')];
    const first = suggestion(await suggestColorPalettes({ images }));
    expect(ColorPaletteSuggestOutcomeSchema.parse(first)).toEqual(first);
    expect(first.suggestion.palettes).toHaveLength(3);
    expect(first.suggestion.subject.length).toBeGreaterThan(0);
    expect(first.skippedImages).toEqual([]);

    const again = suggestion(await suggestColorPalettes({ images, rng: first.suggestion.id }));
    expect(again).toEqual(first);
  });

  it('解不开的图片跳过并报告下标，其余照常；全部解不开才失败', async () => {
    const good = await twoColorPng('#4e7a68', '#9a7440');
    const broken = new Uint8Array([1, 2, 3, 4]);
    const outcome = suggestion(await suggestColorPalettes({ images: [broken, good] }));
    expect(outcome.skippedImages).toEqual([0]);

    await expect(suggestColorPalettes({ images: [broken] })).resolves.toMatchObject({ status: 'failed', code: 'image_unreadable' });
    // 还有指定色时不算失败，图片只是用不上。
    await expect(suggestColorPalettes({ images: [broken], pinnedColors: ['#1f3a5f'] })).resolves.toMatchObject({
      status: 'ok', skippedImages: [0],
    });
  });

  it('只接受 JPEG、PNG、WebP，不把其它可解码格式交给解码器', async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="red"/></svg>');
    await expect(suggestColorPalettes({ images: [svg] })).resolves.toMatchObject({ status: 'failed', code: 'image_unreadable' });
  });

  it('每种可预期的失败都有稳定错误码', async () => {
    const gray = await twoColorPng('#808080', '#6e6e6e');
    await expect(suggestColorPalettes({ images: [gray] })).resolves.toMatchObject({ code: 'no_subject_color' });
    await expect(suggestColorPalettes({ images: Array.from({ length: 21 }, () => gray) })).resolves.toMatchObject({ code: 'too_many_images' });
    await expect(suggestColorPalettes({ seedColors: ['#4e7a68'], rng: 'nonsense' })).resolves.toMatchObject({ code: 'invalid_rng' });
    await expect(suggestColorPalettes({ pinnedColors: ['#000000'] })).resolves.toMatchObject({
      code: 'pinned_color_neutral', message: expect.stringContaining('#000000'),
    });
    await expect(suggestColorPalettes({ pinnedColors: ['#ffffb0'], base: 'light' })).resolves.toMatchObject({ code: 'pinned_color_conflict' });
    await expect(suggestColorPalettes({ seedColors: ['#4e7a68'], count: 6 })).resolves.toMatchObject({
      code: 'invalid_options', message: expect.stringContaining('1–5'),
    });
    await expect(suggestColorPalettes({ pinnedColors: ['red'] })).resolves.toMatchObject({ code: 'invalid_options' });
  });

  it('指定色原样成为每套的主色，强调色数量听调用方的', async () => {
    const outcome = suggestion(await suggestColorPalettes({ pinnedColors: ['#1F3A5F'], accentCount: 4 }));
    for (const palette of outcome.suggestion.palettes) {
      expect(palette.accent[0]).toBe('#1f3a5f');
      expect(palette.accent).toHaveLength(4);
    }
    expect(outcome.suggestion.subject[0]).toMatchObject({ hex: '#1f3a5f', pinned: true });
  });

  it('取消信号在解码之间生效', async () => {
    const controller = new AbortController();
    controller.abort(new Error('stopped'));
    await expect(suggestColorPalettes({ images: [await twoColorPng('#4e7a68', '#9a7440')], signal: controller.signal }))
      .rejects.toThrow('stopped');
  });

  it('检查自写配色：结果符合合同，不合格时给出能通过复检的版本', () => {
    const palette = {
      bg: '#ffffff', surface: '#f2f2f2', ink: '#999999', muted: '#777777',
      accent: ['#1f3a5f'], chart: ['#cccccc', '#333333', '#777777'],
    };
    const outcome = checkColorPalette({ palette });
    if (outcome.status !== 'ok') throw new Error(outcome.message);
    expect(ColorPaletteCheckOutcomeSchema.parse(outcome)).toEqual(outcome);
    expect(outcome.check.ok).toBe(false);
    expect(outcome.check.findings.map(finding => finding.rule)).toEqual(expect.arrayContaining(['ink_contrast', 'chart_order']));
    if (!outcome.check.suggested) throw new Error('应当能修复');
    expect(checkColorPalette({ palette: outcome.check.suggested })).toMatchObject({ check: { ok: true, suggested: null } });
    expect(outcome.check.suggested.accent).toEqual(palette.accent);
  });

  it('预览按套数画行，每行从底色开始', () => {
    const palette = {
      id: 'x-1', relation: 'mono', base: 'light', tone: 'native', bg: '#102030', surface: '#405060', ink: '#708090', muted: '#a0b0c0',
      accent: ['#ff0000', '#00ff00'], chart: ['#0000ff'],
    } as const;
    const preview = renderPalettePreview([{ ...palette, accent: [...palette.accent], chart: [...palette.chart] }]);
    expect(preview.data).toHaveLength(preview.width * preview.height * 4);
    const firstCell = (20 * preview.width + 20) * 4;
    expect([...preview.data.slice(firstCell, firstCell + 4)]).toEqual([0x10, 0x20, 0x30, 255]);
  });
});
