import {
  createDefaultModelRequestCredentialResolver,
  ModelRequestCredentialError,
  type DefaultModelRequestCredentialResolverDependencies,
} from '../../model-request-auth';
import type { InferenceCredentialResolver } from '../definitions/inferenceCapability';
import {
  INFERENCE_ADMISSION_ERROR_CODES,
  InferenceAdmissionError,
} from '../definitions/inferenceAdmissionError';

export type DefaultCredentialResolverDependencies =
  DefaultModelRequestCredentialResolverDependencies;

/** 解析单次推理 attempt 的认证材料，凭据错误统一投影为推理准入错误。 */
export function createDefaultInferenceCredentialResolver(
  dependencies?: DefaultCredentialResolverDependencies
): InferenceCredentialResolver {
  const resolver = createDefaultModelRequestCredentialResolver(dependencies);
  return {
    async resolve(request) {
      try {
        return await resolver.resolve(request);
      } catch (error) {
        if (!(error instanceof ModelRequestCredentialError)) throw error;
        throw new InferenceAdmissionError(
          INFERENCE_ADMISSION_ERROR_CODES.CREDENTIAL_INVALID,
          error.message
        );
      }
    },
  };
}
