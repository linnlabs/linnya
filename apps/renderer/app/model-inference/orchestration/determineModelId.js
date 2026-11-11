import {
  isAuxiliaryModelPurposeKey,
  readEffectiveAuxiliaryModelPurposeBinding,
  readEffectiveModelPurposeBinding,
} from '@/domains/model-configuration';

// Helper function to determine which model ID to use
export function determineModelId(prompt_key) {
  const purposeKey = typeof prompt_key === 'string' ? prompt_key : 'default';
  const isAuxiliaryPurpose = isAuxiliaryModelPurposeKey(purposeKey);

  if (isAuxiliaryPurpose) {
    return readEffectiveAuxiliaryModelPurposeBinding(purposeKey);
  }

  return readEffectiveModelPurposeBinding('primary');
}

