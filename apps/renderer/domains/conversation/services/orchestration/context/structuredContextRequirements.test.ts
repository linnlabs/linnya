import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearRendererStructuredContextRequirementsForTest,
  registerRendererStructuredContextRequirement,
} from '@plugin/renderer/structuredContextRequirementPort';
import { validateStructuredContextRequirements } from './structuredContextRequirements';

beforeEach(() => {
  clearRendererStructuredContextRequirementsForTest();
});

describe('validateStructuredContextRequirements', () => {
  it('allows ordinary chat without structured context', () => {
    expect(validateStructuredContextRequirements({
      userMessage: { text: '帮我总结一下这个项目' },
      options: {},
    })).toEqual({ ok: true });
  });

  it('delegates send-time validation to registered renderer requirements', () => {
    registerRendererStructuredContextRequirement({
      id: 'demo.requirement',
      validate(input) {
        return input.prompt.includes('需要结构化上下文')
          ? { ok: false, message: '缺少 demo 结构化上下文。' }
          : { ok: true };
      },
    });

    expect(validateStructuredContextRequirements({
      userMessage: { text: '这个需要结构化上下文' },
      options: {},
    })).toEqual({
      ok: false,
      message: '缺少 demo 结构化上下文。',
    });
  });
});
