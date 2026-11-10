import type { PluginColorPaletteSuggestInput } from '@linnya/plugin-host-contract/backend/colorPalette';
import type { ColorPaletteSuggestOutcome } from '@app/schemas/color-palette';
import { suggestColorPalettes as suggestHostColorPalettes } from '../../domains/color-palette';

export { checkColorPalette } from '../../domains/color-palette';

/** 插件只提交内存 bytes 和选项；解码、取色与错误码由 Host 统一负责。 */
export async function suggestColorPalettes(
  input: PluginColorPaletteSuggestInput,
): Promise<ColorPaletteSuggestOutcome> {
  return await suggestHostColorPalettes(input);
}

export type { PluginColorPaletteSuggestInput } from '@linnya/plugin-host-contract/backend/colorPalette';
