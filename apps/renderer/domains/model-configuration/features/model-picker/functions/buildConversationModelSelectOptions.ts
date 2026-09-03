import type {
  ModelPickerMaterializedModel,
  ModelPickerProviderModel,
} from '@app/schemas/model-picker';

import type {
  BuildConversationModelSelectOptionsInput,
  BuildPurposeModelSelectOptionsInput,
  ConversationModelSelectOption,
} from '../definitions/conversationModelSelectOptions';

function isMaterializedModelForCapability(
  capability: string,
  model: ModelPickerProviderModel
): model is ModelPickerMaterializedModel {
  return model.materialized && model.capabilities.includes(capability);
}

function modelOption(
  model: ModelPickerMaterializedModel,
  unavailableLabel: string,
  displayName = model.display_name
): ConversationModelSelectOption {
  const unavailable = !model.runtime_available;
  return {
    value: model.model_config_id,
    text: displayName,
    disabled: unavailable,
    ...(unavailable ? { disabledReason: unavailableLabel } : {}),
  };
}

/**
 * 设置中的对话模型选择与输入框快捷菜单消费同一份 Host 来源事实。
 * 这里不读取 catalog_source、URL 或模型名称重新推断 Provider 归属。
 */
export function buildConversationModelSelectOptions(
  input: BuildConversationModelSelectOptionsInput
): ConversationModelSelectOption[] {
  return buildPurposeModelSelectOptions({ ...input, capability: 'chat' });
}

/** 具体用途只筛能力；Provider 分组与对话模型保持同一份 Host 来源事实。 */
export function buildPurposeModelSelectOptions(
  input: BuildPurposeModelSelectOptionsInput
): ConversationModelSelectOption[] {
  const snapshot = input.snapshot;
  if (!snapshot) return [];

  const options: ConversationModelSelectOption[] = [];
  const cloudModels =
    snapshot.cloud?.models
      .filter(model => model.capabilities.includes(input.capability))
      .map(model => modelOption(model, input.labels.unavailable)) ?? [];
  if (snapshot.cloud && cloudModels.length > 0) {
    options.push({ isGroup: true, label: snapshot.cloud.display_name }, ...cloudModels);
  }

  const providerGroups = new Map<
    string,
    {
      readonly displayName: string;
      readonly connections: typeof snapshot.providers;
    }
  >();
  for (const connection of snapshot.providers) {
    const group = providerGroups.get(connection.provider_definition_id);
    providerGroups.set(connection.provider_definition_id, {
      displayName: connection.display_name,
      connections: [...(group?.connections ?? []), connection],
    });
  }
  const providers = [...providerGroups.values()].flatMap(provider => {
    const materializedModels = provider.connections.flatMap(connection =>
      connection.models
        .filter(model => isMaterializedModelForCapability(input.capability, model))
        .map(model => ({ connection, model }))
    );
    const displayNameCounts = new Map<string, number>();
    for (const { model } of materializedModels) {
      displayNameCounts.set(
        model.display_name,
        (displayNameCounts.get(model.display_name) ?? 0) + 1
      );
    }
    const children = materializedModels.map(({ connection, model }) =>
      modelOption(
        model,
        input.labels.unavailable,
        displayNameCounts.get(model.display_name) === 1
          ? model.display_name
          : `${model.display_name} · ${connection.connection_display_name}`
      )
    );
    return children.length > 0
      ? [
          {
            text: provider.displayName,
            shortcut: String(children.length),
            children,
          } satisfies ConversationModelSelectOption,
        ]
      : [];
  });
  if (providers.length > 0) {
    options.push({ isGroup: true, label: input.labels.providerGroup }, ...providers);
  }

  const customModels = snapshot.custom_models
    .filter(model => model.capabilities.includes(input.capability))
    .map(model => modelOption(model, input.labels.unavailable));
  if (customModels.length > 0) {
    options.push({ isGroup: true, label: input.labels.customGroup }, ...customModels);
  }

  return options;
}
