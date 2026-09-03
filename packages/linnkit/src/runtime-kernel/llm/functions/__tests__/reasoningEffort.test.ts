import { describe, expect, it } from 'vitest';

import { resolveEffectiveEffort } from '../reasoningEffort';
import type { ModelReasoningConfig, ReasoningEffort } from '../reasoningEffort';

const cfg = (supported: ReasoningEffort[], extra?: Partial<ModelReasoningConfig>): ModelReasoningConfig => ({
  supported_efforts: supported,
  ...extra,
});

describe('resolveEffectiveEffort', () => {
  describe('无契约 / 空契约', () => {
    it('config 为 undefined 时返回 null（调用方不发任何字段）', () => {
      expect(resolveEffectiveEffort('high', undefined)).toBeNull();
    });

    it('supported_efforts 为空数组时返回 null', () => {
      expect(resolveEffectiveEffort('high', cfg([]))).toBeNull();
    });
  });

  describe('空输入取默认', () => {
    it('requested 为 null 且有合法 default_effort 时取 default', () => {
      expect(resolveEffectiveEffort(null, cfg(['low', 'medium', 'high'], { default_effort: 'low' }))).toBe('low');
    });

    it('requested 为 undefined 时同样走 default 分支', () => {
      expect(resolveEffectiveEffort(undefined, cfg(['low', 'medium'], { default_effort: 'medium' }))).toBe('medium');
    });

    it('无 default_effort 但 medium 在 supported 时取 medium', () => {
      expect(resolveEffectiveEffort(null, cfg(['low', 'medium', 'high']))).toBe('medium');
    });

    it('无 default_effort 且 medium 不在 supported 时取首项（最弱档）', () => {
      expect(resolveEffectiveEffort(null, cfg(['low', 'high']))).toBe('low');
    });

    it('default_effort 不在 supported 时回落到 medium / 首项', () => {
      expect(resolveEffectiveEffort(null, cfg(['low', 'medium'], { default_effort: 'xhigh' }))).toBe('medium');
    });
  });

  describe('正常命中', () => {
    it('requested 在 supported 中时原样返回', () => {
      expect(resolveEffectiveEffort('high', cfg(['low', 'medium', 'high', 'xhigh']))).toBe('high');
      expect(resolveEffectiveEffort('off', cfg(['off', 'low', 'medium']))).toBe('off');
      expect(resolveEffectiveEffort('minimal', cfg(['off', 'minimal', 'high']))).toBe('minimal');
    });
  });

  describe('降级链', () => {
    it('xhigh 不支持时降级到 high', () => {
      expect(resolveEffectiveEffort('xhigh', cfg(['low', 'medium', 'high']))).toBe('high');
    });

    it('xhigh/high 都不支持时降级到 medium', () => {
      expect(resolveEffectiveEffort('xhigh', cfg(['low', 'medium']))).toBe('medium');
    });

    it('xhigh/high/medium 都不支持时取首项', () => {
      expect(resolveEffectiveEffort('xhigh', cfg(['low']))).toBe('low');
    });

    it('minimal 不支持时升档到 low', () => {
      expect(resolveEffectiveEffort('minimal', cfg(['low', 'medium', 'high']))).toBe('low');
    });

    it('minimal/low 都不支持时降级到 medium', () => {
      expect(resolveEffectiveEffort('minimal', cfg(['medium', 'high']))).toBe('medium');
    });

    it('minimal/low/medium 都不支持时取首项', () => {
      expect(resolveEffectiveEffort('minimal', cfg(['high']))).toBe('high');
    });

    it('中间档位（low/medium/high）不支持时走 medium 兜底', () => {
      // low 不在 supported（模型只支持 off/medium/high）→ medium
      expect(resolveEffectiveEffort('low', cfg(['off', 'medium', 'high']))).toBe('medium');
      // high 不在 supported → medium
      expect(resolveEffectiveEffort('high', cfg(['low', 'medium']))).toBe('medium');
    });

    it('中间档位与 medium 都不支持时取首项', () => {
      // 模型只支持 off/high 两档，用户选 medium → medium 不在 → 首项 off
      expect(resolveEffectiveEffort('medium', cfg(['off', 'high']))).toBe('off');
    });

    it('off 不支持时降级到 medium 或首项（模型不支持关闭思考）', () => {
      expect(resolveEffectiveEffort('off', cfg(['low', 'medium', 'high']))).toBe('medium');
      expect(resolveEffectiveEffort('off', cfg(['low', 'high']))).toBe('low');
    });
  });
});
