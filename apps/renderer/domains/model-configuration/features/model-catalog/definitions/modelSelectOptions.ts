import type { CustomSelectOption } from '@linnya/renderer-ui';
import type { ModelCatalogItem } from './modelCatalog';

export type SettingsModel = Pick<
  ModelCatalogItem,
  'id' | 'display_name' | 'name' | 'catalog_source' | 'ui_visibility' | 'capabilities'
>;

export type SettingsModelSelectOption = CustomSelectOption<string>;

export interface BuildModelSelectOptionsLabels {
  readonly systemGroup: string;
  readonly customGroup: string;
}

export interface BuildModelSelectOptionsInput {
  readonly models: readonly SettingsModel[];
  readonly labels: BuildModelSelectOptionsLabels;
}
