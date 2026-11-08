import sharp from 'sharp';
import { expect, it } from 'vitest';
import { ColorPaletteSuggestOutcomeSchema } from '@app/schemas/color-palette';
import * as facade from '../../../../plugin-sdk/backend/colorPalette';
import { resolveBackendPluginHostModuleForTest } from '../backendHostModuleResolver';

it('插件经 @plugin/backend/colorPalette 拿到的是真实能力：提交图片 bytes，取得合同 DTO', async () => {
  expect(resolveBackendPluginHostModuleForTest('@plugin/backend/colorPalette')).toBe(facade);
  const image = await sharp({ create: { width: 48, height: 48, channels: 3, background: '#4e7a68' } }).jpeg().toBuffer();
  const outcome = ColorPaletteSuggestOutcomeSchema.parse(await facade.suggestColorPalettes({ images: [new Uint8Array(image)], count: 2 }));
  expect(outcome).toMatchObject({ status: 'ok', skippedImages: [] });
  if (outcome.status !== 'ok') throw new Error(outcome.message);
  expect(outcome.suggestion.palettes).toHaveLength(2);

  const [palette] = outcome.suggestion.palettes;
  if (!palette) throw new Error('palette is required');
  expect(facade.checkColorPalette({ palette: {
    bg: palette.bg, surface: palette.surface, ink: palette.ink, muted: palette.muted, accent: palette.accent, chart: palette.chart,
  }, excludedHues: outcome.suggestion.excludedHues })).toMatchObject({ status: 'ok', check: { ok: true } });
});
