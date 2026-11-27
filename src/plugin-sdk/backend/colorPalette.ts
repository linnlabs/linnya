import type { PluginColorPaletteSuggestInput } from '@linnya/plugin-host-contract/backend/colorPalette';
import type * as Contract from '@linnya/plugin-host-contract/backend/colorPalette';
import type { ColorPaletteSuggestOutcome, ColorPaletteUseOutcome } from '@app/schemas/color-palette';
import {
  createSqliteColorPaletteHistory,
  suggestColorPalettes as suggestHostColorPalettes,
  useColorPalette as useHostColorPalette,
} from '../../domains/color-palette';
import { requirePluginHostDatabase } from './pluginHostDatabase';

export { checkColorPalette } from '../../domains/color-palette';

const CAPABILITY = 'Color palette history';

/** 插件只提交内存 bytes 和选项；解码、取色、最近用过与错误码由 Host 统一负责。 */
export async function suggestColorPalettes(
  database: unknown,
  input: PluginColorPaletteSuggestInput,
): Promise<ColorPaletteSuggestOutcome> {
  return await suggestHostColorPalettes(input, createSqliteColorPaletteHistory(requirePluginHostDatabase(database, CAPABILITY)));
}

export function useColorPalette(database: unknown, paletteId: string): ColorPaletteUseOutcome {
  return useHostColorPalette(paletteId, createSqliteColorPaletteHistory(requirePluginHostDatabase(database, CAPABILITY)));
}

// 运行时导出必须与插件可见的窄合同一致。
type Facade = typeof import('./colorPalette');
const contract: Facade extends typeof Contract ? true : never = true;
void contract;

export type { PluginColorPaletteSuggestInput } from '@linnya/plugin-host-contract/backend/colorPalette';
