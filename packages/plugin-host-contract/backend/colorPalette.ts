import type {
  ColorPaletteCheckInput,
  ColorPaletteCheckOutcome,
  ColorPaletteSuggestOptions,
  ColorPaletteSuggestOutcome,
} from '@app/schemas/color-palette';

export interface PluginColorPaletteSuggestInput extends ColorPaletteSuggestOptions {
  /** 插件自己读好的 JPEG、PNG 或 WebP bytes，第一张是主图；路径和资产不属于该合同。 */
  readonly images?: readonly Uint8Array[];
  readonly signal?: AbortSignal;
}

/** 从图片或指定颜色给出多套配色。解码由 Host 负责，失败以 `status: 'failed'` 返回稳定错误码。 */
export declare function suggestColorPalettes(
  input: PluginColorPaletteSuggestInput,
): Promise<ColorPaletteSuggestOutcome>;

/** 按生成配色的同一标准检查一套自写配色，不合格时给出改动最少的版本。 */
export declare function checkColorPalette(input: ColorPaletteCheckInput): ColorPaletteCheckOutcome;
