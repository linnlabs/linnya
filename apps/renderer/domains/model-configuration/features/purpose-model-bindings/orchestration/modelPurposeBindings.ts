import { computed, type ComputedRef, type Ref } from 'vue';
import { storeToRefs } from 'pinia';
import { isValidReasoningEffort, type ReasoningEffort } from '@linnlabs/linnkit/contracts';

import { useModelCatalogStore } from '../../model-catalog';
import type { ModelBindingSlot, ModelPurposeSelections } from '../definitions/modelPurposeBindings';
import {
  AUXILIARY_MODEL_PURPOSE_KEYS,
  findAuxiliaryModelPurposeDefinition,
  type AuxiliaryModelPurposeKey,
} from '../definitions/modelPurposes';
import { modelSupportsBindingSlot } from '../functions/modelCapabilities';
import {
  reasoningEffortOptionsForModel,
  resolveAuxiliaryModelId,
  resolveAuxiliaryPurposeDefaultModelId,
  resolveEmbeddingModelId,
  resolveImageGenerationModelId,
  resolveImageVisionModelId,
  resolvePdfOcrModelId,
  resolvePrimaryModelId,
  resolvePrimaryReasoningEffort,
  resolveRerankModelId,
  resolveTranscriptionModelId,
  type ModelPurposeResolutionContext,
} from '../functions/resolveModelPurposeBindings';
import { useModelPurposeBindingsStore } from '../store/modelPurposeBindingsStore';

function createResolutionContext(): ModelPurposeResolutionContext {
  const catalog = useModelCatalogStore();
  const bindings = useModelPurposeBindingsStore();
  return {
    models: catalog.models,
    purposeDefaults: catalog.purposeDefaults,
    cloudModelsReady: catalog.cloudModelsReady,
    selections: {
      primaryModelId: bindings.primaryModelId,
      primaryReasoningEffort: bindings.primaryReasoningEffort,
      auxiliaryModelIds: bindings.auxiliaryModelIds,
      embeddingModelId: bindings.embeddingModelId,
      rerankModelId: bindings.rerankModelId,
      pdfOcrModelId: bindings.pdfOcrModelId,
      imageVisionModelId: bindings.imageVisionModelId,
      imageGenerationModelId: bindings.imageGenerationModelId,
      transcriptionModelId: bindings.transcriptionModelId,
    },
  };
}

function requireSupportedModel(slot: ModelBindingSlot, modelId: string): void {
  const model = useModelCatalogStore().models.find(candidate => candidate.id === modelId);
  if (!model || !modelSupportsBindingSlot(model, slot)) {
    throw new Error(`模型 ${modelId} 不支持用途 ${slot}`);
  }
}

export function setModelPurposeBinding(slot: ModelBindingSlot, modelId: string | null): void {
  if (modelId) requireSupportedModel(slot, modelId);
  const store = useModelPurposeBindingsStore();
  if (slot === 'primary') store.setPrimaryModel(modelId);
  else if (slot === 'embedding') store.setEmbeddingModel(modelId);
  else if (slot === 'rerank') store.setRerankModel(modelId);
  else if (slot === 'pdf_ocr') store.setPdfOcrModel(modelId);
  else if (slot === 'image_vision') store.setImageVisionModel(modelId);
  else if (slot === 'image_generation') store.setImageGenerationModel(modelId);
  else store.setTranscriptionModel(modelId);
}

export function setAuxiliaryModelPurposeBinding(
  purposeKey: AuxiliaryModelPurposeKey,
  modelId: string | null,
): void {
  if (!findAuxiliaryModelPurposeDefinition(purposeKey)) {
    throw new Error(`未知辅助模型用途：${purposeKey}`);
  }
  if (modelId) requireSupportedModel('primary', modelId);
  useModelPurposeBindingsStore().setAuxiliaryPurposeModel(purposeKey, modelId);
}

export function setPrimaryReasoningEffort(effort: ReasoningEffort | null): void {
  if (effort !== null && !isValidReasoningEffort(effort)) {
    throw new Error(`非法 reasoning effort：${String(effort)}`);
  }
  const modelId = resolvePrimaryModelId(createResolutionContext());
  useModelPurposeBindingsStore().setPrimaryReasoningEffort(modelId, effort);
}

export function readSelectedModelPurposeBinding(slot: ModelBindingSlot): string | null {
  const store = useModelPurposeBindingsStore();
  if (slot === 'primary') return store.primaryModelId;
  if (slot === 'embedding') return store.embeddingModelId;
  if (slot === 'rerank') return store.rerankModelId;
  if (slot === 'pdf_ocr') return store.pdfOcrModelId;
  if (slot === 'image_vision') return store.imageVisionModelId;
  if (slot === 'image_generation') return store.imageGenerationModelId;
  return store.transcriptionModelId;
}

export function readEffectiveModelPurposeBinding(slot: ModelBindingSlot): string | null {
  const context = createResolutionContext();
  if (slot === 'primary') return resolvePrimaryModelId(context);
  if (slot === 'embedding') return resolveEmbeddingModelId(context);
  if (slot === 'rerank') return resolveRerankModelId(context);
  if (slot === 'pdf_ocr') return resolvePdfOcrModelId(context);
  if (slot === 'image_vision') return resolveImageVisionModelId(context);
  if (slot === 'image_generation') return resolveImageGenerationModelId(context);
  return resolveTranscriptionModelId(context);
}

export function readEffectiveAuxiliaryModelPurposeBinding(
  purposeKey: AuxiliaryModelPurposeKey,
): string | null {
  return resolveAuxiliaryModelId(createResolutionContext(), purposeKey);
}

export function readPrimaryReasoningEffort(): ReasoningEffort | null {
  return useModelPurposeBindingsStore().primaryReasoningEffort;
}

export function clearBindingsForModel(modelId: string): void {
  const store = useModelPurposeBindingsStore();
  store.forgetPrimaryReasoningEffort(modelId);
  const slots: readonly ModelBindingSlot[] = [
    'primary',
    'embedding',
    'rerank',
    'pdf_ocr',
    'image_vision',
    'image_generation',
    'transcription',
  ];
  for (const slot of slots) {
    if (readSelectedModelPurposeBinding(slot) === modelId) setModelPurposeBinding(slot, null);
  }
  for (const purposeKey of AUXILIARY_MODEL_PURPOSE_KEYS) {
    if (store.auxiliaryModelIds[purposeKey] === modelId) {
      store.setAuxiliaryPurposeModel(purposeKey, null);
    }
  }
}

export interface ModelPurposeBindingsReadModel {
  readonly selections: Readonly<{
    [Key in keyof ModelPurposeSelections]: Readonly<Ref<ModelPurposeSelections[Key]>>;
  }>;
  readonly effectivePrimaryModelId: ComputedRef<string | null>;
  readonly effectivePrimaryReasoningEffort: ComputedRef<ReasoningEffort | null>;
  readonly effectiveEmbeddingModelId: ComputedRef<string | null>;
  readonly effectiveRerankModelId: ComputedRef<string | null>;
  readonly effectivePdfOcrModelId: ComputedRef<string | null>;
  readonly effectiveImageVisionModelId: ComputedRef<string | null>;
  readonly effectiveImageGenerationModelId: ComputedRef<string | null>;
  readonly effectiveTranscriptionModelId: ComputedRef<string | null>;
  effectiveAuxiliaryModelId(purposeKey: AuxiliaryModelPurposeKey): string | null;
  auxiliaryPurposeDefaultModelId(purposeKey: AuxiliaryModelPurposeKey): string | null;
  reasoningEffortOptions(modelId: string | null): readonly ReasoningEffort[];
}

export function useModelPurposeBindings(): ModelPurposeBindingsReadModel {
  const store = useModelPurposeBindingsStore();
  const refs = storeToRefs(store);
  const context = computed(createResolutionContext);
  return {
    selections: {
      primaryModelId: refs.primaryModelId,
      primaryReasoningEffort: refs.primaryReasoningEffort,
      auxiliaryModelIds: refs.auxiliaryModelIds,
      embeddingModelId: refs.embeddingModelId,
      rerankModelId: refs.rerankModelId,
      pdfOcrModelId: refs.pdfOcrModelId,
      imageVisionModelId: refs.imageVisionModelId,
      imageGenerationModelId: refs.imageGenerationModelId,
      transcriptionModelId: refs.transcriptionModelId,
    },
    effectivePrimaryModelId: computed(() => resolvePrimaryModelId(context.value)),
    effectivePrimaryReasoningEffort: computed(() => resolvePrimaryReasoningEffort(context.value)),
    effectiveEmbeddingModelId: computed(() => resolveEmbeddingModelId(context.value)),
    effectiveRerankModelId: computed(() => resolveRerankModelId(context.value)),
    effectivePdfOcrModelId: computed(() => resolvePdfOcrModelId(context.value)),
    effectiveImageVisionModelId: computed(() => resolveImageVisionModelId(context.value)),
    effectiveImageGenerationModelId: computed(() => resolveImageGenerationModelId(context.value)),
    effectiveTranscriptionModelId: computed(() => resolveTranscriptionModelId(context.value)),
    effectiveAuxiliaryModelId: purposeKey => resolveAuxiliaryModelId(context.value, purposeKey),
    auxiliaryPurposeDefaultModelId: purposeKey =>
      resolveAuxiliaryPurposeDefaultModelId(context.value, purposeKey),
    reasoningEffortOptions: modelId => reasoningEffortOptionsForModel(context.value.models, modelId),
  };
}
