import { PromptKeys } from '@app/schemas';

export const ModelPurposeDefaultStrategy = {
  FIXED_MODEL: 'fixed_model',
  PRIMARY_MODEL: 'primary_model',
} as const;

export type ModelPurposeDefaultStrategy =
  typeof ModelPurposeDefaultStrategy[keyof typeof ModelPurposeDefaultStrategy];

export type AuxiliaryModelPurposeKey =
  | typeof PromptKeys.AUTOCOMPLETE
  | typeof PromptKeys.TRANSLATION
  | typeof PromptKeys.AUDIO_SUMMARY
  | typeof PromptKeys.WRITING
  | typeof PromptKeys.ANNOTATION
  | typeof PromptKeys.REVIEW
  | typeof PromptKeys.CONVERSATION_TITLE
  | typeof PromptKeys.KNOWLEDGE_GRAPH_EXTRACTION;

export interface AuxiliaryModelPurposeDefinition {
  readonly purposeKey: AuxiliaryModelPurposeKey;
  readonly defaultStrategy: ModelPurposeDefaultStrategy;
  readonly defaultModelId?: string;
}

export type AuxiliaryModelSelections = Partial<Record<AuxiliaryModelPurposeKey, string | null>>;

export const AUXILIARY_MODEL_PURPOSE_REGISTRY = [
  {
    purposeKey: PromptKeys.AUTOCOMPLETE,
    defaultStrategy: ModelPurposeDefaultStrategy.FIXED_MODEL,
    defaultModelId: 'cloud-deepseek-v4-flash',
  },
  {
    purposeKey: PromptKeys.TRANSLATION,
    defaultStrategy: ModelPurposeDefaultStrategy.FIXED_MODEL,
    defaultModelId: 'cloud-deepseek-v4-flash',
  },
  {
    purposeKey: PromptKeys.AUDIO_SUMMARY,
    defaultStrategy: ModelPurposeDefaultStrategy.PRIMARY_MODEL,
  },
  {
    purposeKey: PromptKeys.WRITING,
    defaultStrategy: ModelPurposeDefaultStrategy.PRIMARY_MODEL,
  },
  {
    purposeKey: PromptKeys.ANNOTATION,
    defaultStrategy: ModelPurposeDefaultStrategy.PRIMARY_MODEL,
  },
  {
    purposeKey: PromptKeys.REVIEW,
    defaultStrategy: ModelPurposeDefaultStrategy.PRIMARY_MODEL,
  },
  {
    purposeKey: PromptKeys.CONVERSATION_TITLE,
    defaultStrategy: ModelPurposeDefaultStrategy.FIXED_MODEL,
    defaultModelId: 'cloud-deepseek-v4-flash',
  },
  {
    purposeKey: PromptKeys.KNOWLEDGE_GRAPH_EXTRACTION,
    defaultStrategy: ModelPurposeDefaultStrategy.FIXED_MODEL,
    defaultModelId: 'gemini-3-flash-preview',
  },
] as const satisfies readonly AuxiliaryModelPurposeDefinition[];

export const AUXILIARY_MODEL_PURPOSE_KEYS: readonly AuxiliaryModelPurposeKey[] =
  AUXILIARY_MODEL_PURPOSE_REGISTRY.map(purpose => purpose.purposeKey);

export const DOCUMENT_AUXILIARY_MODEL_PURPOSE_KEYS = [
  PromptKeys.AUTOCOMPLETE,
  PromptKeys.TRANSLATION,
  PromptKeys.AUDIO_SUMMARY,
  PromptKeys.WRITING,
  PromptKeys.ANNOTATION,
  PromptKeys.REVIEW,
] as const satisfies readonly AuxiliaryModelPurposeKey[];

export const GLOBAL_AUXILIARY_MODEL_PURPOSE_KEYS = [
  PromptKeys.CONVERSATION_TITLE,
  PromptKeys.KNOWLEDGE_GRAPH_EXTRACTION,
] as const satisfies readonly AuxiliaryModelPurposeKey[];

export function isAuxiliaryModelPurposeKey(value: string): value is AuxiliaryModelPurposeKey {
  return AUXILIARY_MODEL_PURPOSE_KEYS.some(purposeKey => purposeKey === value);
}

export function findAuxiliaryModelPurposeDefinition(
  purposeKey: string,
): AuxiliaryModelPurposeDefinition | undefined {
  return AUXILIARY_MODEL_PURPOSE_REGISTRY.find(purpose => purpose.purposeKey === purposeKey);
}

function selectPurposes(
  purposeKeys: readonly AuxiliaryModelPurposeKey[],
): readonly AuxiliaryModelPurposeDefinition[] {
  const keys = new Set(purposeKeys);
  return AUXILIARY_MODEL_PURPOSE_REGISTRY.filter(purpose => keys.has(purpose.purposeKey));
}

export const DOCUMENT_AUXILIARY_MODEL_PURPOSES = selectPurposes(
  DOCUMENT_AUXILIARY_MODEL_PURPOSE_KEYS,
);

export const GLOBAL_AUXILIARY_MODEL_PURPOSES = selectPurposes(
  GLOBAL_AUXILIARY_MODEL_PURPOSE_KEYS,
);
