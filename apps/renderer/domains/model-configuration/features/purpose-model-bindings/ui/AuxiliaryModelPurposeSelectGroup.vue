<template>
  <div class="auxiliary-model-purpose-select-group">
    <SettingsRow
      v-for="purpose in purposes"
      :key="purpose.purposeKey"
      :label="settingsMessage(modelPurposeLabelKey(purpose.purposeKey))"
      :label-for="`${idPrefix}-${purpose.purposeKey}`"
      :hint="settingsMessage(modelPurposeDescriptionKey(purpose.purposeKey))"
    >
      <CustomSelect
        :id="`${idPrefix}-${purpose.purposeKey}`"
        :model-value="getPurposeModelValue(purpose.purposeKey)"
        :options="getPurposeModelOptions(purpose)"
        :placeholder="settingsMessage('settings.modelConfig.auxiliary.placeholder')"
        :title="settingsMessage('settings.modelConfig.auxiliary.selectTitle')"
        :disabled="modelCatalog.activeOperation !== null"
        font-size="14px"
        @update:model-value="setPurposeModelValue(purpose.purposeKey, $event)"
      />
    </SettingsRow>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { CustomSelect } from '@linnya/renderer-ui';
import { SettingsRow, useSettingsLocalization } from '@/domains/settings/public';
import { useModelCatalogStore } from '../../model-catalog';
import { buildConversationModelSelectOptions, useModelPickerReadModel } from '../../model-picker';
import {
  ModelPurposeDefaultStrategy,
  type AuxiliaryModelPurposeDefinition,
  type AuxiliaryModelPurposeKey,
} from '../definitions/modelPurposes';
import type { SettingsModelSelectOption } from '../../model-catalog/definitions/modelSelectOptions';
import {
  setAuxiliaryModelPurposeBinding,
  useModelPurposeBindings,
} from '../orchestration/modelPurposeBindings';
import {
  modelPurposeDescriptionKey,
  modelPurposeLabelKey,
} from '../functions/modelPurposePresentation';

const props = withDefaults(
  defineProps<{
    purposes: readonly AuxiliaryModelPurposeDefinition[];
    idPrefix?: string;
  }>(),
  {
    idPrefix: 'auxiliaryModelSelect',
  }
);

const USE_PRIMARY_MODEL_OPTION_VALUE = '__use_primary_model__';

const modelCatalog = useModelCatalogStore();
const modelPicker = useModelPickerReadModel();
const modelBindings = useModelPurposeBindings();
const { settingsMessage } = useSettingsLocalization();

const modelGroupLabels = computed(() => ({
  providerGroup: settingsMessage('settings.modelGroups.provider'),
  customGroup: settingsMessage('settings.modelGroups.custom'),
  unavailable: settingsMessage('settings.modelPicker.runtimeUnavailable'),
}));

function getPurposeModelValue(purposeKey: AuxiliaryModelPurposeKey): string | null {
  const selectedId = modelBindings.selections.auxiliaryModelIds.value[purposeKey] ?? null;
  if (selectedId) return modelBindings.effectiveAuxiliaryModelId(purposeKey);

  const purpose = props.purposes.find(candidate => candidate.purposeKey === purposeKey);
  if (purpose?.defaultStrategy === ModelPurposeDefaultStrategy.PRIMARY_MODEL) {
    return USE_PRIMARY_MODEL_OPTION_VALUE;
  }

  return modelBindings.effectiveAuxiliaryModelId(purposeKey);
}

function setPurposeModelValue(purposeKey: AuxiliaryModelPurposeKey, value: string | null): void {
  setAuxiliaryModelPurposeBinding(
    purposeKey,
    value === USE_PRIMARY_MODEL_OPTION_VALUE ? null : value
  );
}

function getPurposeModelOptions(
  purpose: AuxiliaryModelPurposeDefinition
): SettingsModelSelectOption[] {
  const options: SettingsModelSelectOption[] = [];

  if (purpose.defaultStrategy === ModelPurposeDefaultStrategy.PRIMARY_MODEL) {
    options.push(
      {
        value: USE_PRIMARY_MODEL_OPTION_VALUE,
        text: settingsMessage('settings.modelConfig.auxiliary.default.primaryModel'),
      },
      { isSeparator: true }
    );
  }

  const modelOptions = buildConversationModelSelectOptions({
    snapshot: modelPicker.snapshot.value,
    labels: modelGroupLabels.value,
  });

  return [...options, ...modelOptions];
}
</script>
