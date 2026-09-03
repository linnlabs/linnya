import { resolveEffectiveEffort, type ReasoningEffort } from 'linnkit/contracts';

import type { ModelCatalogItem } from '../../model-catalog';
import type { ModelPurposeSelections } from '../definitions/modelPurposeBindings';
import {
  findAuxiliaryModelPurposeDefinition,
  ModelPurposeDefaultStrategy,
  type AuxiliaryModelPurposeKey,
} from '../definitions/modelPurposes';
import {
  isDocumentUploadOcrModel,
  modelHasCapability,
  modelHasVisibility,
} from './modelCapabilities';

export interface ModelPurposeResolutionContext {
  readonly models: readonly ModelCatalogItem[];
  readonly purposeDefaults: Readonly<Record<string, string>>;
  readonly cloudModelsReady: boolean;
  readonly selections: ModelPurposeSelections;
}

function firstModelId(
  models: readonly ModelCatalogItem[],
  predicate: (model: ModelCatalogItem) => boolean,
): string | null {
  return models.find(predicate)?.id ?? null;
}

function resolveAvailableSelection(
  context: ModelPurposeResolutionContext,
  selectedId: string | null,
  defaultId: string | null,
): string | null {
  const hasModel = (modelId: string): boolean => context.models.some(model => model.id === modelId);
  if (selectedId) {
    if (hasModel(selectedId)) return selectedId;
    if (context.cloudModelsReady && selectedId.startsWith('cloud-')) {
      return defaultId && hasModel(defaultId) ? defaultId : null;
    }
    return null;
  }
  return defaultId && hasModel(defaultId) ? defaultId : null;
}

export function resolvePrimaryModelId(context: ModelPurposeResolutionContext): string | null {
  const defaultId = firstModelId(context.models, model => model.id === 'default-deepseek-reasoner')
    ?? firstModelId(context.models, model => modelHasVisibility(model, 'chat'))
    ?? firstModelId(context.models, model => modelHasCapability(model, 'chat'));
  return resolveAvailableSelection(context, context.selections.primaryModelId, defaultId);
}

export function resolvePrimaryReasoningEffort(
  context: ModelPurposeResolutionContext,
): ReasoningEffort | null {
  const modelId = resolvePrimaryModelId(context);
  const model = context.models.find(candidate => candidate.id === modelId);
  return resolveEffectiveEffort(context.selections.primaryReasoningEffort, model?.reasoning);
}

export function reasoningEffortOptionsForModel(
  models: readonly ModelCatalogItem[],
  modelId: string | null,
): readonly ReasoningEffort[] {
  return models.find(model => model.id === modelId)?.reasoning?.supported_efforts ?? [];
}

export function resolveAuxiliaryPurposeDefaultModelId(
  context: ModelPurposeResolutionContext,
  purposeKey: AuxiliaryModelPurposeKey,
): string | null {
  const definition = findAuxiliaryModelPurposeDefinition(purposeKey);
  if (!definition) return null;
  if (definition.defaultStrategy === ModelPurposeDefaultStrategy.PRIMARY_MODEL) {
    return resolvePrimaryModelId(context);
  }
  return context.purposeDefaults[purposeKey] ?? definition.defaultModelId ?? null;
}

export function resolveAuxiliaryModelId(
  context: ModelPurposeResolutionContext,
  purposeKey: AuxiliaryModelPurposeKey,
): string | null {
  return resolveAvailableSelection(
    context,
    context.selections.auxiliaryModelIds[purposeKey] ?? null,
    resolveAuxiliaryPurposeDefaultModelId(context, purposeKey),
  );
}

export function resolveEmbeddingModelId(context: ModelPurposeResolutionContext): string | null {
  const defaultId = firstModelId(context.models, model => modelHasVisibility(model, 'embedding'))
    ?? firstModelId(context.models, model => modelHasCapability(model, 'embedding'));
  return resolveAvailableSelection(context, context.selections.embeddingModelId, defaultId);
}

export function resolveRerankModelId(context: ModelPurposeResolutionContext): string | null {
  const defaultId = firstModelId(context.models, model => modelHasVisibility(model, 'rerank'))
    ?? firstModelId(context.models, model => modelHasCapability(model, 'rerank'));
  return resolveAvailableSelection(context, context.selections.rerankModelId, defaultId);
}

export function resolvePdfOcrModelId(context: ModelPurposeResolutionContext): string | null {
  const defaultId = firstModelId(context.models, model => modelHasCapability(model, 'pdf_ocr_default'))
    ?? firstModelId(context.models, isDocumentUploadOcrModel);
  return resolveAvailableSelection(context, context.selections.pdfOcrModelId, defaultId);
}

export function resolveImageVisionModelId(context: ModelPurposeResolutionContext): string | null {
  const defaultId = firstModelId(
    context.models,
    model => modelHasVisibility(model, 'vision') && !isDocumentUploadOcrModel(model),
  )
    ?? firstModelId(
      context.models,
      model => modelHasCapability(model, 'vision') && !isDocumentUploadOcrModel(model),
    )
    ?? firstModelId(context.models, model => modelHasVisibility(model, 'vision'))
    ?? firstModelId(context.models, model => modelHasCapability(model, 'vision'));
  return resolveAvailableSelection(context, context.selections.imageVisionModelId, defaultId);
}

export function resolveImageGenerationModelId(
  context: ModelPurposeResolutionContext,
): string | null {
  const defaultId = firstModelId(context.models, model => modelHasVisibility(model, 'image_generation'))
    ?? firstModelId(context.models, model => modelHasCapability(model, 'image_generation'));
  return resolveAvailableSelection(context, context.selections.imageGenerationModelId, defaultId);
}

export function resolveTranscriptionModelId(context: ModelPurposeResolutionContext): string | null {
  const defaultId = firstModelId(context.models, model => modelHasVisibility(model, 'audio_transcription'))
    ?? firstModelId(context.models, model => modelHasCapability(model, 'audio_transcription'));
  return resolveAvailableSelection(context, context.selections.transcriptionModelId, defaultId);
}
