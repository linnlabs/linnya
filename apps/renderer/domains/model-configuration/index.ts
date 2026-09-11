import { defineAsyncComponent } from 'vue';

// 公开组件保持同一合同；读取模型状态不应顺带加载整套设置表单。
export const ModelRegistrationSettingsPage = defineAsyncComponent(() => import('./ui/ModelRegistrationSettingsPage.vue'));
export { loadProviderCatalog, useProviderCatalogReadModel } from './features/provider-catalog';
export type {
  ProviderCatalogGeneration,
  ProviderCatalogReadModel,
  ProviderDefinition,
  ProviderModelDefinition,
  ProviderSetupField,
} from './features/provider-catalog';
export {
  modelAcceptsUserImageInput,
  startModelCatalogLifecycle,
  stopModelCatalogLifecycle,
  useModelCatalogReadModel,
} from './features/model-catalog';
export {
  buildConversationModelSelectOptions,
  loadModelPicker,
  setModelPickerModelVisibility,
  setModelPickerProviderVisibility,
  startModelPickerLifecycle,
  stopModelPickerLifecycle,
  useModelPickerReadModel,
} from './features/model-picker';
export type {
  BuildConversationModelSelectOptionsInput,
  ConversationModelSelectOption,
  ConversationModelSelectOptionLabels,
  ModelPickerOperation,
  ModelPickerOperationError,
  ModelPickerReadModel,
} from './features/model-picker';
export type {
  ModelCatalogError,
  ModelCatalogItem,
  ModelCatalogOperation,
  ModelCatalogReadModel,
  ModelCatalogSnapshot,
} from './features/model-catalog';
export {
  AUXILIARY_MODEL_PURPOSE_KEYS,
  AUXILIARY_MODEL_PURPOSE_REGISTRY,
  DOCUMENT_AUXILIARY_MODEL_PURPOSE_KEYS,
  DOCUMENT_AUXILIARY_MODEL_PURPOSES,
  findAuxiliaryModelPurposeDefinition,
  GLOBAL_AUXILIARY_MODEL_PURPOSE_KEYS,
  GLOBAL_AUXILIARY_MODEL_PURPOSES,
  isAuxiliaryModelPurposeKey,
  isDocumentUploadOcrModel,
  ModelPurposeDefaultStrategy,
  modelHasCapability,
  modelHasVisibility,
  modelSupportsBindingSlot,
  readEffectiveAuxiliaryModelPurposeBinding,
  readEffectiveModelPurposeBinding,
  readPrimaryReasoningEffort,
  readSelectedModelPurposeBinding,
  setAuxiliaryModelPurposeBinding,
  setModelPurposeBinding,
  setPrimaryReasoningEffort,
  useModelPurposeBindings,
} from './features/purpose-model-bindings';
export type {
  AuxiliaryModelPurposeDefinition,
  AuxiliaryModelPurposeKey,
  AuxiliaryModelSelections,
  ModelBindingSlot,
  ModelPurposeBindingsReadModel,
  ModelPurposeSelections,
} from './features/purpose-model-bindings';
export { deleteConfiguredModel } from './orchestration/deleteConfiguredModel';
export { shouldPromptForModelSetup } from './functions/shouldPromptForModelSetup';
export { removeConfiguredProvider } from './orchestration/removeConfiguredProvider';
export {
  getEmbeddingModelChangeImpactPort,
  registerEmbeddingModelChangeImpactPort,
} from './ports/embeddingModelChangeImpactPort';
export const ModelConfigurationSettingsPage = defineAsyncComponent(() => import('./ui/ModelConfigurationSettingsPage.vue'));
export const ModelManagementSettingsPage = defineAsyncComponent(() => import('./ui/ModelManagementSettingsPage.vue'));
export { default as AuxiliaryModelPurposeSelectGroup } from './features/purpose-model-bindings/ui/AuxiliaryModelPurposeSelectGroup.vue';
export type {
  EmbeddingModelChangeImpact,
  EmbeddingModelChangeImpactPort,
} from './ports/embeddingModelChangeImpactPort';
