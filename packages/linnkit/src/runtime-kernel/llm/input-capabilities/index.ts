export {
  EMPTY_MODEL_INPUT_REQUIREMENT,
  MODEL_INPUT_PLACEMENTS,
} from './definitions/modelInputCapability';
export type {
  AdapterInputSupport,
  ModelInputCompatibility,
  ModelInputIncompatibilityReason,
  ModelInputPlacement,
  ModelInputRequirement,
} from './definitions/modelInputCapability';
export {
  LLM_MODEL_ELIGIBILITY_ERROR_CODE,
  LlmModelEligibilityError,
  MODEL_INPUT_ERROR_CODES,
  ModelInputCapabilityError,
} from './definitions/modelInputCapabilityError';
export { createModelInputCompatibilityError } from './functions/createModelInputCompatibilityError';
export type {
  ModelInputErrorCode,
  ModelInputErrorMetadata,
} from './definitions/modelInputCapabilityError';
export { deriveModelInputRequirement } from './functions/deriveModelInputRequirement';
export { mergeModelInputRequirements } from './functions/mergeModelInputRequirements';
export {
  evaluateModelInputCompatibility,
  listCompatibleModelIds,
} from './functions/evaluateModelInputCompatibility';
export { assertModelInputCompatibility } from './orchestration/assertModelInputCompatibility';
