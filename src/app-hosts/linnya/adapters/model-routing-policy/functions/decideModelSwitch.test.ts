import { describe, expect, it } from 'vitest';
import { MODEL_ROUTABLE_INFERENCE_FAILURE_CODES } from '../../inference';
import { createDefaultModelRoutingPolicy } from '../orchestration/createDefaultModelRoutingPolicy';

function canonicalFailure(code: string): Error {
  const error = new Error('sanitized canonical failure');
  Object.defineProperty(error, 'errorCode', { value: `llm.${code}` });
  return error;
}

describe('default model routing policy', () => {
  it.each([
    [
      MODEL_ROUTABLE_INFERENCE_FAILURE_CODES.PROVIDER_LOCATION_RESTRICTED,
      'selected provider route is unavailable in the current location',
    ],
    [
      MODEL_ROUTABLE_INFERENCE_FAILURE_CODES.PROVIDER_CONTINUATION_REJECTED,
      'provider rejected the structured continuation',
    ],
  ])('稳定 failure code %s 建议切换模型', (code, reason) => {
    expect(createDefaultModelRoutingPolicy().decideOnError(canonicalFailure(code))).toEqual({
      action: 'switch_model',
      reason,
    });
  });

  it('不从错误文案猜 Provider 语义', () => {
    expect(createDefaultModelRoutingPolicy().decideOnError(
      new Error('user location is not supported; missing thought_signature')
    )).toEqual({ action: 'none' });
  });
});
