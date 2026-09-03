import { describe, expect, it } from 'vitest';
import { parseQwenAsrResponse } from './parseQwenAsrResponse';

describe('parseQwenAsrResponse', () => {
  it('projects the documented non-streaming response into the transcription contract', () => {
    expect(parseQwenAsrResponse({
      choices: [{
        finish_reason: 'stop',
        message: {
          role: 'assistant',
          content: '欢迎使用 Linnya。',
          annotations: [{ type: 'audio_info', language: 'zh', emotion: 'neutral' }],
        },
      }],
      usage: { total_tokens: 54 },
    })).toEqual({
      text: '欢迎使用 Linnya。',
      language: 'zh',
    });
  });

  it('rejects an unknown response shape instead of guessing a legacy field', () => {
    expect(() => parseQwenAsrResponse({ output: { text: 'legacy' } })).toThrow();
  });
});
