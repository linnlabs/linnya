<template>
  <SettingsPage>
    <SettingsSection :title="settingsMessage('settings.modelConfig.selection.title')">
      <SettingsRow
        :label="settingsMessage('settings.modelConfig.primary.label')"
        label-for="primaryModelSelect"
        :hint="settingsMessage('settings.modelConfig.primary.description')"
      >
        <CustomSelect
          id="primaryModelSelect"
          v-model="primaryModelValue"
          :options="modelSelectOptions"
          :placeholder="settingsMessage('settings.modelConfig.primary.placeholder')"
          :title="settingsMessage('settings.modelConfig.primary.selectTitle')"
          :disabled="modelCatalog.activeOperation !== null"
          font-size="14px"
        />
      </SettingsRow>
    </SettingsSection>

    <SettingsSection
      :title="settingsMessage('settings.modelConfig.auxiliary.title')"
      :description="settingsMessage('settings.modelConfig.auxiliary.documentSpecificHint')"
    >
      <AuxiliaryModelPurposeSelectGroup
        :purposes="globalAuxiliaryModelPurposes"
        id-prefix="globalAuxiliaryModelSelect"
      />
    </SettingsSection>

    <SettingsSection :title="settingsMessage('settings.modelConfig.other.title')">
      <SettingsRow
        v-for="slot in otherModelSlots"
        :key="slot.id"
        :label="settingsMessage(slot.labelKey)"
        :label-for="slot.id"
        :hint="settingsMessage(slot.descriptionKey)"
      >
        <CustomSelect
          :id="slot.id"
          :model-value="slot.model.value"
          :options="slot.options"
          :placeholder="settingsMessage(slot.placeholderKey)"
          :title="settingsMessage(slot.titleKey)"
          :disabled="modelCatalog.activeOperation !== null"
          font-size="14px"
          @update:model-value="slot.model.value = $event"
        />
      </SettingsRow>

      <SettingsFeedback kind="error" :message="modelStoreErrorMessage ?? ''" />
    </SettingsSection>
  </SettingsPage>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { ModelCatalogItem } from '../features/model-catalog';
import { useModelCatalogStore } from '../features/model-catalog';
import {
  GLOBAL_AUXILIARY_MODEL_PURPOSES,
  setModelPurposeBinding,
  useModelPurposeBindings,
} from '../features/purpose-model-bindings';
import { getEmbeddingModelChangeImpactPort } from '../ports/embeddingModelChangeImpactPort';
import { CustomSelect } from '@linnya/renderer-ui'; // 导入自定义选择组件
import AuxiliaryModelPurposeSelectGroup from '../features/purpose-model-bindings/ui/AuxiliaryModelPurposeSelectGroup.vue';
import {
  buildConversationModelSelectOptions,
  buildPurposeModelSelectOptions,
  useModelPickerReadModel,
} from '../features/model-picker';
import {
  SettingsFeedback,
  SettingsPage,
  SettingsRow,
  SettingsSection,
  useSettingsLocalization,
} from '@/domains/settings/public';
import { confirm } from '@shared/composables/confirmDialog';
import { useNotificationStore } from '@/app/notification';
import { buildModelSelectOptions } from '../features/model-catalog/functions/buildModelSelectOptions';
import { resolveModelCatalogErrorPresentation } from '../features/model-catalog/functions/modelCatalogErrorPresentation';
import './ModelConfigurationSettingsPage.css';

const modelCatalog = useModelCatalogStore();
const modelBindings = useModelPurposeBindings();
const notificationStore = useNotificationStore();
const { settingsMessage } = useSettingsLocalization();

const modelGroupLabels = computed(() => ({
  systemGroup: settingsMessage('settings.modelGroups.system'),
  customGroup: settingsMessage('settings.modelGroups.custom'),
}));

const modelPicker = useModelPickerReadModel();
const conversationModelGroupLabels = computed(() => ({
  providerGroup: settingsMessage('settings.modelGroups.provider'),
  customGroup: settingsMessage('settings.modelGroups.custom'),
  unavailable: settingsMessage('settings.modelPicker.runtimeUnavailable'),
}));

const embeddingModels = computed(() =>
  modelCatalog.models.filter(m => m.capabilities?.includes('embedding'))
);

const rerankModels = computed(() =>
  modelCatalog.models.filter(m => m.capabilities?.includes('rerank'))
);

const visionModels = computed(() =>
  modelCatalog.models.filter(m => m.capabilities?.includes('vision'))
);

const isPdfOcrModel = (model: ModelCatalogItem) => {
  const capabilities = Array.isArray(model.capabilities) ? model.capabilities : [];
  return (
    capabilities.includes('pdf_ocr_default') ||
    (capabilities.includes('document_ocr') && model.document_ocr_route?.mode === 'document_upload')
  );
};

const pdfOcrModels = computed(() => visionModels.value.filter(isPdfOcrModel));

const transcriptionModels = computed(() =>
  modelCatalog.models.filter(m => m.ui_visibility?.includes('audio_transcription'))
);

const modelSelectOptions = computed(() =>
  buildConversationModelSelectOptions({
    snapshot: modelPicker.snapshot.value,
    labels: conversationModelGroupLabels.value,
  })
);

const imageGenerationModelOptions = computed(() => {
  return buildPurposeModelSelectOptions({
    snapshot: modelPicker.snapshot.value,
    capability: 'image_generation',
    labels: conversationModelGroupLabels.value,
  });
});

const embeddingModelOptions = computed(() =>
  buildModelSelectOptions({
    models: embeddingModels.value,
    labels: modelGroupLabels.value,
  })
);

const rerankModelOptions = computed(() =>
  buildModelSelectOptions({
    models: rerankModels.value,
    labels: modelGroupLabels.value,
  })
);

const pdfOcrModelOptions = computed(() =>
  buildModelSelectOptions({
    models: pdfOcrModels.value,
    labels: modelGroupLabels.value,
  })
);

const visionModelOptions = computed(() =>
  buildModelSelectOptions({
    models: visionModels.value,
    labels: modelGroupLabels.value,
  })
);

const transcriptionModelOptions = computed(() => {
  return buildModelSelectOptions({
    models: transcriptionModels.value,
    labels: modelGroupLabels.value,
  });
});

const modelStoreErrorMessage = computed(() =>
  resolveModelCatalogErrorPresentation(modelCatalog.error, settingsMessage)
);
const globalAuxiliaryModelPurposes = GLOBAL_AUXILIARY_MODEL_PURPOSES;

const primaryModelValue = computed<string | null>({
  get: () => modelBindings.effectivePrimaryModelId.value,
  set: value => setModelPurposeBinding('primary', value),
});

async function confirmEmbeddingModelChange(nextModelId: string): Promise<boolean> {
  const affected =
    await getEmbeddingModelChangeImpactPort().findImpactedKnowledgeBases(nextModelId);

  if (affected.length === 0) return true;

  const names = affected
    .slice(0, 5)
    .map(knowledgeBase => knowledgeBase.name)
    .join('、');
  const suffix = affected.length > 5 ? ` 等 ${affected.length} 个` : '';

  return confirm({
    title: settingsMessage('settings.modelConfig.embedding.changeConfirm.title'),
    message: settingsMessage('settings.modelConfig.embedding.changeConfirm.message', {
      count: affected.length,
      names: `${names}${suffix}`,
    }),
    confirmText: settingsMessage('settings.modelConfig.embedding.changeConfirm.confirm'),
    cancelText: settingsMessage('settings.modelConfig.embedding.changeConfirm.cancel'),
    isDangerousAction: true,
  });
}

const embeddingModelValue = computed<string | null>({
  get: () => modelBindings.effectiveEmbeddingModelId.value,
  set: value => {
    const nextModelId = typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
    const currentModelId = modelBindings.effectiveEmbeddingModelId.value;
    if (!nextModelId || nextModelId === currentModelId) {
      setModelPurposeBinding('embedding', nextModelId);
      return;
    }

    void (async () => {
      try {
        const confirmed = await confirmEmbeddingModelChange(nextModelId);
        if (confirmed) {
          setModelPurposeBinding('embedding', nextModelId);
        }
      } catch (error) {
        console.error('[ModelConfiguration] 切换知识库嵌入模型前检查失败:', error);
        notificationStore.show(
          settingsMessage('settings.modelConfig.error.updateFailed'),
          'error',
          3500
        );
      }
    })();
  },
});

const rerankModelValue = computed<string | null>({
  get: () => modelBindings.effectiveRerankModelId.value,
  set: value => setModelPurposeBinding('rerank', value),
});

const pdfOcrModelValue = computed<string | null>({
  get: () => modelBindings.effectivePdfOcrModelId.value,
  set: value => setModelPurposeBinding('pdf_ocr', value),
});

const imageVisionModelValue = computed<string | null>({
  get: () => modelBindings.effectiveImageVisionModelId.value,
  set: value => setModelPurposeBinding('image_vision', value),
});

const imageGenerationModelValue = computed<string | null>({
  get: () => modelBindings.effectiveImageGenerationModelId.value,
  set: value => setModelPurposeBinding('image_generation', value),
});

const transcriptionModelValue = computed<string | null>({
  get: () => modelBindings.effectiveTranscriptionModelId.value,
  set: value => setModelPurposeBinding('transcription', value),
});

/**
 * 「其他模型」是一组形状完全相同的下拉：同样的标签/占位/说明三件套 + 一个 computed 读写。
 * 用数据描述它们，模板里就只剩一次 v-for。
 */
const otherModelSlots = computed(() => [
  {
    id: 'imageGenerationModelSelect',
    model: imageGenerationModelValue,
    options: imageGenerationModelOptions.value,
    labelKey: 'settings.modelConfig.imageGeneration.label',
    placeholderKey: 'settings.modelConfig.imageGeneration.placeholder',
    titleKey: 'settings.modelConfig.imageGeneration.selectTitle',
    descriptionKey: 'settings.modelConfig.imageGeneration.description',
  },
  {
    id: 'embeddingModelSelect',
    model: embeddingModelValue,
    options: embeddingModelOptions.value,
    labelKey: 'settings.modelConfig.embedding.label',
    placeholderKey: 'settings.modelConfig.embedding.placeholder',
    titleKey: 'settings.modelConfig.embedding.selectTitle',
    descriptionKey: 'settings.modelConfig.embedding.description',
  },
  {
    id: 'rerankModelSelect',
    model: rerankModelValue,
    options: rerankModelOptions.value,
    labelKey: 'settings.modelConfig.rerank.label',
    placeholderKey: 'settings.modelConfig.rerank.placeholder',
    titleKey: 'settings.modelConfig.rerank.selectTitle',
    descriptionKey: 'settings.modelConfig.rerank.description',
  },
  {
    id: 'pdfOcrModelSelect',
    model: pdfOcrModelValue,
    options: pdfOcrModelOptions.value,
    labelKey: 'settings.modelConfig.pdfOcr.label',
    placeholderKey: 'settings.modelConfig.pdfOcr.placeholder',
    titleKey: 'settings.modelConfig.pdfOcr.selectTitle',
    descriptionKey: 'settings.modelConfig.pdfOcr.description',
  },
  {
    id: 'imageVisionModelSelect',
    model: imageVisionModelValue,
    options: visionModelOptions.value,
    labelKey: 'settings.modelConfig.imageVision.label',
    placeholderKey: 'settings.modelConfig.imageVision.placeholder',
    titleKey: 'settings.modelConfig.imageVision.selectTitle',
    descriptionKey: 'settings.modelConfig.imageVision.description',
  },
  {
    id: 'transcriptionModelSelect',
    model: transcriptionModelValue,
    options: transcriptionModelOptions.value,
    labelKey: 'settings.modelConfig.transcription.label',
    placeholderKey: 'settings.modelConfig.transcription.placeholder',
    titleKey: 'settings.modelConfig.transcription.selectTitle',
    descriptionKey: 'settings.modelConfig.transcription.description',
  },
]);
</script>
