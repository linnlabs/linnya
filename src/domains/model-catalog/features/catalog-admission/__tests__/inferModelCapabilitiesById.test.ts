import { describe, expect, it } from 'vitest';
import {
  inferContextWindowByModelId,
  inferMaxOutputTokensByModelId,
  inferImageInputSupportByModelId,
  inferModelCapabilitiesById,
} from '../functions/inferModelCapabilitiesById';

describe('inferModelCapabilitiesById', () => {
  it('correctly infers explicit k-token suffixes', () => {
    expect(inferContextWindowByModelId('custom-qwen-72b-128k')).toBe(128 * 1024);
    expect(inferContextWindowByModelId('llama-3-8b-32k-instruct')).toBe(32 * 1024);
  });

  it('correctly infers context windows for well-known models', () => {
    expect(inferContextWindowByModelId('gpt-4o')).toBe(128000);
    expect(inferContextWindowByModelId('claude-3-5-sonnet-20241022')).toBe(200000);
    expect(inferContextWindowByModelId('deepseek-chat')).toBe(64000);
    expect(inferContextWindowByModelId('gemini-1.5-pro')).toBe(1048576);
  });

  it('correctly infers image input capabilities', () => {
    expect(inferImageInputSupportByModelId('gpt-4o')).toBe(true);
    expect(inferImageInputSupportByModelId('gpt-4o-mini')).toBe(true);
    expect(inferImageInputSupportByModelId('claude-3-haiku')).toBe(true);
    expect(inferImageInputSupportByModelId('gemini-2.0-flash')).toBe(true);
    expect(inferImageInputSupportByModelId('qwen-vl-plus')).toBe(true);
    expect(inferImageInputSupportByModelId('deepseek-chat')).toBe(false);
    expect(inferImageInputSupportByModelId('deepseek-r1')).toBe(false);
  });

  it('correctly returns comprehensive capability record', () => {
    const caps = inferModelCapabilitiesById('deepseek-chat');
    expect(caps.context_window_tokens).toBe(64000);
    expect(caps.max_output_tokens).toBe(8192);
    expect(caps.supports_image_input).toBe(false);
  });
});
