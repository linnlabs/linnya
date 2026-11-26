import type {
  ColorPaletteCheckInput,
  ColorPaletteCheckOutcome,
  ColorPaletteSuggestOptions,
  ColorPaletteSuggestOutcome,
  ColorPaletteUseOutcome,
} from '@app/schemas/color-palette';
import type { PluginSqliteDatabaseLike } from './workspaceRuntime';

export interface PluginColorPaletteSuggestInput extends ColorPaletteSuggestOptions {
  /** 插件自己读好的 JPEG、PNG 或 WebP bytes，第一张是主图；路径和资产不属于该合同。 */
  readonly images?: readonly Uint8Array[];
  readonly signal?: AbortSignal;
}

/**
 * 从图片或指定颜色给出多套配色。解码由 Host 负责，失败以 `status: 'failed'` 返回稳定错误码。
 * 对本工作区最近选用过的组合（底色明暗 + 色系）降权，并在 `database` 里记下这组编号，供 `useColorPalette` 查。
 */
export declare function suggestColorPalettes(
  database: PluginSqliteDatabaseLike,
  input: PluginColorPaletteSuggestInput,
): Promise<ColorPaletteSuggestOutcome>;

/**
 * 插件选定一套时记下（单套编号，如 `pl8f2a-2`，可以来自插件自己的建议或 Agent 的 `linnya palette suggest`）。
 * 之后的建议对同一组合降权；同一套再记一次只移到最前。编号不是本工作区最近发出的返回 `palette_not_found`。
 */
export declare function useColorPalette(database: PluginSqliteDatabaseLike, paletteId: string): ColorPaletteUseOutcome;

/** 按生成配色的同一标准检查一套自写配色，不合格时给出改动最少的版本。 */
export declare function checkColorPalette(input: ColorPaletteCheckInput): ColorPaletteCheckOutcome;
