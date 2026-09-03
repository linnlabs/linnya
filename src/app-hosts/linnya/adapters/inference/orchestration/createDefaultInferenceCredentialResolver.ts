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

/**
 * 解析单次推理 attempt 的认证材料。
 *
 * Linnya Cloud 的设备身份属于 host-managed credential，而不是模型资料；只有显式
 * `host_managed:linnya-cloud` reference 可以获得该附属请求头。
 */
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
