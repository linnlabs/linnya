import type {
  BuildModelSelectOptionsInput,
  SettingsModel,
  SettingsModelSelectOption,
} from '../definitions/modelSelectOptions';

function getModelDisplayName(model: SettingsModel): string {
  return model.display_name || model.name || model.id;
}

function appendModelOptions(
  options: SettingsModelSelectOption[],
  models: readonly SettingsModel[]
): void {
  for (const model of models) {
    options.push({
      value: model.id,
      text: getModelDisplayName(model),
    });
  }
}

export function buildModelSelectOptions(
  input: BuildModelSelectOptionsInput
): SettingsModelSelectOption[] {
  const systemModels = input.models.filter(model => model.catalog_source !== 'user');
  const customModels = input.models.filter(model => model.catalog_source === 'user');
  const options: SettingsModelSelectOption[] = [];

  if (systemModels.length > 0) {
    options.push({ isGroup: true, label: input.labels.systemGroup });
    appendModelOptions(options, systemModels);
  }

  if (systemModels.length > 0 && customModels.length > 0) {
    options.push({ isSeparator: true });
  }

  if (customModels.length > 0) {
    options.push({ isGroup: true, label: input.labels.customGroup });
    appendModelOptions(options, customModels);
  }

  return options;
}
