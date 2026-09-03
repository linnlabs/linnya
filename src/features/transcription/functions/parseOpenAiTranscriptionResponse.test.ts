import { describe, expect, it } from 'vitest';
import { parseOpenAiTranscriptionResponse } from './parseOpenAiTranscriptionResponse';

describe('parseOpenAiTranscriptionResponse', () => {
  it('keeps verbose segment timestamps required by long-audio merging', () => {
    expect(parseOpenAiTranscriptionResponse({
      text: 'hello world',
      language: 'en',
      duration: 1.5,
      segments: [{ start: 0, end: 1.5, text: 'hello world' }],
      usage: { type: 'duration', seconds: 2 },
    })).toEqual({
      text: 'hello world',
      language: 'en',
      duration: 1.5,
      segments: [{ start: 0, end: 1.5, text: 'hello world' }],
    });
  });

  it('rejects responses without transcription text', () => {
    expect(() => parseOpenAiTranscriptionResponse({ transcript: 'legacy' })).toThrow();
  });
});
