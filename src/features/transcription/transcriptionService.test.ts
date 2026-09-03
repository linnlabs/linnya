import { describe, expect, it, vi } from 'vitest';
import type { TranscriptionPort } from './definitions/transcriptionPort';
import { TranscriptionService } from './transcriptionService';

describe('TranscriptionService', () => {
  it('delegates through the narrow port and formats the actual selected model', async () => {
    const transcribe = vi.fn<TranscriptionPort['transcribe']>().mockResolvedValue({
      modelId: 'whisper-selected-by-policy',
      text: '你好，Linnya。',
      language: 'zh',
      duration: 2.5,
      segments: [{ start: 0, end: 2.5, text: '你好，Linnya。' }],
    });
    const service = new TranscriptionService({ transcribe });

    const result = await service.transcribe(
      new Uint8Array([1, 2, 3]),
      'meeting.webm',
      { language: 'zh', prompt: '产品评审' },
    );

    expect(transcribe).toHaveBeenCalledWith(
      undefined,
      new Uint8Array([1, 2, 3]),
      'meeting.webm',
      {
        language: 'zh',
        prompt: '产品评审',
        responseFormat: 'verbose_json',
      },
    );
    expect(result.metadata).toEqual({
      language: 'zh',
      duration: 2.5,
      model: 'whisper-selected-by-policy',
    });
    expect(result.segments).toEqual([{
      text: '你好，Linnya。',
      timestamp: '00:00:00',
      startTime: 0,
      endTime: 2.5,
    }]);
  });
});
