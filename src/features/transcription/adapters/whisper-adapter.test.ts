import { afterEach, describe, expect, it, vi } from 'vitest';
import { WhisperAdapter } from './whisper-adapter';

function createAdapter(): WhisperAdapter {
  return new WhisperAdapter({
    id: 'whisper',
    credential: 'secret',
    route: {
      api_surface: 'openai_audio_transcriptions',
      capability_id: 'host:openai-audio-transcriptions',
      endpoint_id: 'openai-compatible',
      endpoint_model_id: 'whisper-1',
      base_url: 'https://speech.example.com/v1',
      auth_profile: 'bearer',
    },
  });
}

describe('WhisperAdapter', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('preserves verbose timestamps through one multipart request', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      text: 'hello',
      language: 'en',
      duration: 1,
      segments: [{ start: 0, end: 1, text: 'hello' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(createAdapter().transcribe(new Uint8Array([1, 2]), 'voice.wav', {
      language: 'en',
      responseFormat: 'verbose_json',
    })).resolves.toEqual({
      text: 'hello',
      language: 'en',
      duration: 1,
      segments: [{ start: 0, end: 1, text: 'hello' }],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://speech.example.com/v1/audio/transcriptions');
    expect(init?.body).toBeInstanceOf(FormData);
  });

  it('reads text response formats as text rather than JSON', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('plain transcript', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(createAdapter().transcribe(new Uint8Array([1]), 'voice.mp3', {
      responseFormat: 'text',
    })).resolves.toEqual({ text: 'plain transcript' });
  });
});
