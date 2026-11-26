import type { ISchemaProvider } from '../../../../shared/database/schema-provider';

import { COLOR_PALETTE_HISTORY_SCHEMAS } from './colorPaletteHistory.schema';

export function getColorPaletteSchemaProviders(): ISchemaProvider[] {
  return [{ name: 'color-palette', getSchema: () => [...COLOR_PALETTE_HISTORY_SCHEMAS] }];
}
