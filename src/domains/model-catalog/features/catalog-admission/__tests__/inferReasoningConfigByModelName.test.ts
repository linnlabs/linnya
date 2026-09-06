/**
 * @file reasoning-capabilities.test.ts
 *
 * @description 测试 inferReasoningConfigByModelName() 对常见 reasoning 模型的契约推断。
 * 档位事实来源：各 provider 公开 API 文档；测试锁定当前正式产品合同。
 */

import { describe, expect, it } from 'vitest';

import { inferReasoningConfigByModelName } from '../functions/inferReasoningConfigByModelName';

describe('inferReasoningConfigByModelName', () => {
  describe('GPT-5 系列', () => {
    it('gpt-5 全系列统一 off/low/medium/high/xhigh（UI 一致，不区分版本）', () => {
      for (const name of [
        'gpt-5', 'gpt5', 'gpt-5-mini', 'gpt-5-nano', 'openai/gpt-5', 'GPT-5-Mini',
        'gpt-5.1', 'gpt-5.1-codex',
        'gpt-5.2', 'gpt-5.3', 'gpt-5.4', 'gpt-5.5', 'gpt-5.2-codex',
      ]) {
        const cfg = inferReasoningConfigByModelName(name);
        expect(cfg?.supported_efforts).toEqual(['off', 'low', 'medium', 'high', 'xhigh']);
        expect(cfg?.default_effort).toBe('medium');
      }
    });
  });

  describe('OpenAI o 系列（Chat Completions reasoning_effort）', () => {
    it('o1 / o3 / o4-mini 匹配，档位 low/medium/high', () => {
      for (const name of ['o1', 'o3', 'o4-mini', 'o1-mini', 'openai/o3', 'O3']) {
        const cfg = inferReasoningConfigByModelName(name);
        expect(cfg?.supported_efforts).toEqual(['low', 'medium', 'high']);
        expect(cfg?.default_effort).toBe('medium');
      }
    });
  });

  describe('Claude 3.7+ / 4 系列', () => {
    it('claude-3.7-sonnet / claude-opus-4 / claude-sonnet-4 / claude-haiku-4 匹配', () => {
      for (const name of [
        'claude-3.7-sonnet',
        'claude-3-7-sonnet',
        'anthropic/claude-opus-4-20250514',
        'claude-sonnet-4-5',
        'claude-haiku-4-5',
      ]) {
        const cfg = inferReasoningConfigByModelName(name);
        expect(cfg?.supported_efforts).toEqual(['off', 'low', 'medium', 'high']);
        expect(cfg?.default_effort).toBe('medium');
      }
    });

    it('claude-3-5-sonnet（不支持 extended thinking）不匹配', () => {
      expect(inferReasoningConfigByModelName('claude-3-5-sonnet')).toBeUndefined();
    });
  });

  describe('Gemini 2.5+ / 3+ 系列（thinkingConfig）', () => {
    it('gemini-2.5-pro / gemini-3-flash 匹配，档位 off/low/medium/high', () => {
      for (const name of ['gemini-2.5-pro', 'gemini-2-5-flash', 'google/gemini-3-pro', 'gemini-3-flash-preview']) {
        const cfg = inferReasoningConfigByModelName(name);
        expect(cfg?.supported_efforts).toEqual(['off', 'low', 'medium', 'high']);
        expect(cfg?.default_effort).toBe('medium');
      }
    });

    it('gemini-1.5-pro（不在 thinkingConfig 支持范围）不匹配', () => {
      expect(inferReasoningConfigByModelName('gemini-1.5-pro')).toBeUndefined();
    });
  });

  describe('Qwen3 thinking 系列', () => {
    it('qwen3-235b-a22b-thinking 匹配', () => {
      const cfg = inferReasoningConfigByModelName('qwen3-235b-a22b-thinking-2507');
      expect(cfg?.supported_efforts).toEqual(['off', 'low', 'medium', 'high']);
    });
  });

  describe('Grok reasoning 系列', () => {
    it('grok-3-mini / grok-4 匹配，档位 low/medium/high', () => {
      for (const name of ['grok-3-mini', 'grok-4', 'xai/grok-4']) {
        const cfg = inferReasoningConfigByModelName(name);
        expect(cfg?.supported_efforts).toEqual(['low', 'medium', 'high']);
      }
    });
  });

  describe('DeepSeek 系列', () => {
    it('deepseek-v4-pro / v4-flash 档位 off/low/medium/high/xhigh，default high', () => {
      for (const name of ['deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-v4-pro-preview']) {
        const cfg = inferReasoningConfigByModelName(name);
        expect(cfg?.supported_efforts).toEqual(['off', 'low', 'medium', 'high', 'xhigh']);
        expect(cfg?.default_effort).toBe('high');
      }
    });

    it('deepseek-reasoner / r1 / r1-0528（固定思考）返回 undefined', () => {
      for (const name of ['deepseek-reasoner', 'deepseek-r1', 'deepseek-r1-0528']) {
        expect(inferReasoningConfigByModelName(name)).toBeUndefined();
      }
    });
  });

  describe('GLM-5.3 系列（Ollama reasoning）', () => {
    it('glm-5.3 / glm-5.3-flash 公开当前 Ollama codec 可执行的 low/high', () => {
      for (const name of [
        'glm-5.3',
        'glm-5.3-flash',
        'glm-5.3-flash:cloud',
        'ollama/glm-5.3-flash',
      ]) {
        const cfg = inferReasoningConfigByModelName(name);
        expect(cfg?.supported_efforts).toEqual(['low', 'high']);
        expect(cfg?.default_effort).toBe('high');
      }
    });

    it('不会误匹配相邻版本', () => {
      expect(inferReasoningConfigByModelName('glm-5.2')).toBeUndefined();
      expect(inferReasoningConfigByModelName('glm-5.30')).toBeUndefined();
    });
  });

  describe('固定思考 / 非 reasoning 模型不补契约', () => {
    it('deepseek-chat / 普通 chat / embedding / mock 模型返回 undefined', () => {
      for (const name of ['deepseek-chat', 'gpt-4o', 'BAAI/bge-m3', 'mock-chat', 'kimi-k2']) {
        expect(inferReasoningConfigByModelName(name)).toBeUndefined();
      }
    });
  });
});
