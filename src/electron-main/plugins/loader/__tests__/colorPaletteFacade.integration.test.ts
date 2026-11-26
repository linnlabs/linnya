import sharp from 'sharp';
import { afterEach, expect, it } from 'vitest';
import { ColorPaletteSuggestOutcomeSchema, ColorPaletteUseOutcomeSchema } from '@app/schemas/color-palette';
import { DatabaseService } from 'src/electron-main/services/database';
import * as facade from '../../../../plugin-sdk/backend/colorPalette';
import { resolveBackendPluginHostModuleForTest } from '../backendHostModuleResolver';

const services: DatabaseService[] = [];
afterEach(() => {
  for (const service of services.splice(0)) service.close();
});

it('插件经 @plugin/backend/colorPalette 拿到的是真实能力：提交图片 bytes 取得合同 DTO，选定一套后记进工作区', async () => {
  expect(resolveBackendPluginHostModuleForTest('@plugin/backend/colorPalette')).toBe(facade);
  const service = new DatabaseService(':memory:');
  service.initialize();
  services.push(service);
  const db = service.getDb();

  const image = await sharp({ create: { width: 48, height: 48, channels: 3, background: '#4e7a68' } }).jpeg().toBuffer();
  const outcome = ColorPaletteSuggestOutcomeSchema.parse(await facade.suggestColorPalettes(db, { images: [new Uint8Array(image)], count: 2 }));
  expect(outcome).toMatchObject({ status: 'ok', skippedImages: [] });
  if (outcome.status !== 'ok') throw new Error(outcome.message);
  expect(outcome.suggestion.palettes).toHaveLength(2);

  const [palette] = outcome.suggestion.palettes;
  if (!palette) throw new Error('palette is required');
  expect(facade.checkColorPalette({ palette: {
    bg: palette.bg, surface: palette.surface, ink: palette.ink, muted: palette.muted, accent: palette.accent, chart: palette.chart,
  }, excludedHues: outcome.suggestion.excludedHues })).toMatchObject({ status: 'ok', check: { ok: true } });

  // 插件选定的这套记进同一个工作区库，与 Agent 的 linnya palette use 是同一份记录。
  expect(ColorPaletteUseOutcomeSchema.parse(facade.useColorPalette(db, palette.id))).toMatchObject({
    status: 'ok', used: { id: palette.id, base: palette.base },
  });
  expect(facade.useColorPalette(db, 'pl0000-9')).toMatchObject({ status: 'failed', code: 'palette_not_found' });
  expect(() => facade.useColorPalette({ prepare: () => ({}) }, palette.id)).toThrow('requires a SQLite database');
});
