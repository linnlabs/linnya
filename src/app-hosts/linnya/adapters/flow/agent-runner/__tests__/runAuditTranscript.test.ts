import { describe, expect, it } from 'vitest';
import {
  createFinalAnswerEvent,
  createThoughtEvent,
  createUserInputEvent,
} from '@linnlabs/linnkit/contracts';
import { buildRootRunTranscriptMessages } from '../runAuditTranscript';

describe('runAuditTranscript', () => {
  it('应把主 run 的用户输入、AI 思考和最终回答写入 transcript messages', () => {
    const inputEvents = [
      createUserInputEvent('user_1', 'conv_1', 'turn_1', '你好', {
        timestamp: 1000,
      }),
    ];
    const generatedEvents = [
      createThoughtEvent('thought_1', 'conv_1', 'turn_1', '需要友好回应。', {
        timestamp: 1001,
        is_complete: true,
      }),
      createFinalAnswerEvent('answer_1', 'conv_1', 'turn_1', '你好！', {
        completion_reason: 'terminal',
        timestamp: 1002,
        provider_continuations: [{
          schema_version: 2,
          producer: {
            model_id: 'reasoner',
            endpoint_id: 'example-reasoner',
            api_surface: 'openai_chat_completions',
            capability_id: 'test:reasoning-codec',
            endpoint_model_id: 'reasoner-upstream',
          },
          kind: 'reasoning_content',
          payload: { type: 'reasoning_content', reasoning_content: '需要友好回应。' },
        }],
      }),
    ];

    const messages = buildRootRunTranscriptMessages({ inputEvents, generatedEvents });

    expect(messages).toMatchObject([
      { role: 'user', content: '你好' },
      { role: 'assistant', type: 'thought', content: '需要友好回应。' },
      {
        role: 'assistant',
        type: 'final_answer',
        content: '你好！',
        metadata: {
          provider_continuations: [expect.objectContaining({
            kind: 'reasoning_content',
            payload: { type: 'reasoning_content', reasoning_content: '需要友好回应。' },
          })],
        },
      },
    ]);
  });
});
