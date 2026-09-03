import { describe, expect, it } from 'vitest';

import type { AiMessage, RuntimeEvent } from '../src/contracts';
import type {
  ImageInputAdmissionEvidence,
  ResolvedLlmInputMessage,
} from '../src/ports';

const resolvedMessage: ResolvedLlmInputMessage = {
  role: 'user',
  content: '',
  attachments: [{
    id: 'attachment-1',
    resourceId: 'asset-1',
    mediaType: 'image/png',
    byteLength: 4,
    width: 1,
    height: 1,
    placement: 'user_image',
    bytes: new Uint8Array([1, 2, 3, 4]),
  }],
};

const evidence: ImageInputAdmissionEvidence = {
  inputBudget: 1000,
  nonImageEstimatedTokens: 100,
  initialProfileId: 'profile-v1',
  attachments: [{
    messageIndex: 0,
    attachmentIndex: 0,
    id: 'attachment-1',
    resourceId: 'asset-1',
    placement: 'user_image',
    estimatedTokens: 80,
  }],
};

// @ts-expect-error resolved bytes 不能进入 durable AiMessage。
const invalidAiMessage: AiMessage = resolvedMessage;
// @ts-expect-error admission evidence 不是 RuntimeEvent。
const invalidRuntimeEvent: RuntimeEvent = evidence;

describe('LLM input materialization type boundary', () => {
  it('keeps resolved input and admission evidence outside durable contracts', () => {
    expect(resolvedMessage.role).toBe('user');
    expect(evidence.attachments).toHaveLength(1);
    expect(invalidAiMessage).toBe(resolvedMessage);
    expect(invalidRuntimeEvent).toBe(evidence);
  });
});
