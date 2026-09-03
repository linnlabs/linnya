import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { ReasoningEffort } from 'linnkit/contracts';

import type { AuxiliaryModelSelections, AuxiliaryModelPurposeKey } from '../definitions/modelPurposes';

/**
 * `models` 是已发布的持久化 storage identity，不是模块名。
 * 保留 key 可避免目录重构重置用户当前选择；store 只持有同步状态，不读取目录或调用网关。
 */
export const useModelPurposeBindingsStore = defineStore('models', () => {
  const primaryModelId = ref<string | null>(null);
  const primaryReasoningEffort = ref<ReasoningEffort | null>(null);
  const primaryReasoningEffortsByModelId = ref<Record<string, ReasoningEffort>>({});
  const auxiliaryModelIds = ref<AuxiliaryModelSelections>({});
  const embeddingModelId = ref<string | null>(null);
  const rerankModelId = ref<string | null>(null);
  const pdfOcrModelId = ref<string | null>(null);
  const imageVisionModelId = ref<string | null>(null);
  const imageGenerationModelId = ref<string | null>(null);
  const transcriptionModelId = ref<string | null>(null);

  function setPrimaryModel(modelId: string | null): void {
    primaryModelId.value = modelId;
    primaryReasoningEffort.value = modelId
      ? primaryReasoningEffortsByModelId.value[modelId] ?? null
      : null;
  }

  function setPrimaryReasoningEffort(
    modelId: string | null,
    effort: ReasoningEffort | null,
  ): void {
    primaryReasoningEffort.value = effort;
    if (!modelId) return;
    const next = { ...primaryReasoningEffortsByModelId.value };
    if (effort) next[modelId] = effort;
    else delete next[modelId];
    primaryReasoningEffortsByModelId.value = next;
  }

  function forgetPrimaryReasoningEffort(modelId: string): void {
    if (!(modelId in primaryReasoningEffortsByModelId.value)) return;
    const next = { ...primaryReasoningEffortsByModelId.value };
    delete next[modelId];
    primaryReasoningEffortsByModelId.value = next;
  }

  function setAuxiliaryPurposeModel(
    purposeKey: AuxiliaryModelPurposeKey,
    modelId: string | null,
  ): void {
    auxiliaryModelIds.value = { ...auxiliaryModelIds.value, [purposeKey]: modelId };
  }

  function setEmbeddingModel(modelId: string | null): void {
    embeddingModelId.value = modelId;
  }

  function setRerankModel(modelId: string | null): void {
    rerankModelId.value = modelId;
  }

  function setPdfOcrModel(modelId: string | null): void {
    pdfOcrModelId.value = modelId;
  }

  function setImageVisionModel(modelId: string | null): void {
    imageVisionModelId.value = modelId;
  }

  function setImageGenerationModel(modelId: string | null): void {
    imageGenerationModelId.value = modelId;
  }

  function setTranscriptionModel(modelId: string | null): void {
    transcriptionModelId.value = modelId;
  }

  return {
    primaryModelId,
    primaryReasoningEffort,
    primaryReasoningEffortsByModelId,
    auxiliaryModelIds,
    embeddingModelId,
    rerankModelId,
    pdfOcrModelId,
    imageVisionModelId,
    imageGenerationModelId,
    transcriptionModelId,
    setPrimaryModel,
    setPrimaryReasoningEffort,
    forgetPrimaryReasoningEffort,
    setAuxiliaryPurposeModel,
    setEmbeddingModel,
    setRerankModel,
    setPdfOcrModel,
    setImageVisionModel,
    setImageGenerationModel,
    setTranscriptionModel,
  };
}, {
  persist: {
    paths: [
      'primaryModelId',
      'primaryReasoningEffort',
      'primaryReasoningEffortsByModelId',
      'auxiliaryModelIds',
      'embeddingModelId',
      'rerankModelId',
      'pdfOcrModelId',
      'imageVisionModelId',
      'imageGenerationModelId',
      'transcriptionModelId',
    ],
  },
});
