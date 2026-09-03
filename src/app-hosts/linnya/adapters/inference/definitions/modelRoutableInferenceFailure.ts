import { AI_SDK_MODEL_ROUTABLE_FAILURE_CODES } from '@linnlabs/linnkit-provider-ai-sdk';

/** Host routing policy 可以消费的窄 failure-code 合同。 */
export const MODEL_ROUTABLE_INFERENCE_FAILURE_CODES = AI_SDK_MODEL_ROUTABLE_FAILURE_CODES;

export type ModelRoutableInferenceFailureCode =
  typeof MODEL_ROUTABLE_INFERENCE_FAILURE_CODES[
    keyof typeof MODEL_ROUTABLE_INFERENCE_FAILURE_CODES
  ];
