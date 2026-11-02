import { z } from 'zod';

const rectangle = z
  .object({
    x: z.number().nonnegative(),
    y: z.number().nonnegative(),
    w: z.number().positive(),
    h: z.number().positive(),
  })
  .strict();
export const regionSchema = z
  .object({
    id: z.string(),
    kind: z.enum(['text', 'vertical', 'chart']),
    box: rectangle,
    // probe 比 box 大，用于观察框外墨迹；不把预览裁掉的文字当作 Office 已通过。
    probe: rectangle,
    previewLines: z.array(z.string()).optional(),
    scale: z.number().optional(),
    reduction: z.number().optional(),
  })
  .strict();
export const manifestSchema = z
  .object({
    version: z.literal(1),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    deckSha256: z.string(),
    font: z.string(),
    platform: z.string(),
    pages: z.array(z.object({ id: z.string(), regions: z.array(regionSchema) }).strict()),
  })
  .strict();
export type Region = z.infer<typeof regionSchema>;
export type Manifest = z.infer<typeof manifestSchema>;
export type Rect = Region['box'];
export const PAGE_WIDTH = 960;
export const PAGE_HEIGHT = 540;
export const SERIES_COLORS = ['#2468C4', '#D85C28', '#33854B'];
export const PLOT_COLOR = '#E3EDF7';
export function slideFile(index: number): string {
  return `slide-${String(index + 1).padStart(3, '0')}.png`;
}
