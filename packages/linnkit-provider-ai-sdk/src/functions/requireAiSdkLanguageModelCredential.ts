import type { AiSdkLanguageModelFactoryInput } from '../definitions/aiSdkInferenceSurface';

export function requireAiSdkLanguageModelCredential(
  input: AiSdkLanguageModelFactoryInput
): NonNullable<AiSdkLanguageModelFactoryInput['credential']> {
  if (!input.credential) {
    throw new Error(`[AiSdkInference] ${input.capability_id} route 缺少凭据。`);
  }
  return input.credential;
}
