import { describe, expect, it } from 'vitest';
import { selectConversationSurfaceError } from './selectConversationSurfaceError';

describe('selectConversationSurfaceError', () => {
  it('按执行域优先级选择当前横幅', () => {
    expect(selectConversationSurfaceError({
      interactiveRun: '前台错误',
      legacyExecution: '旧执行错误',
      annotationRun: '批注错误',
    })).toEqual({ source: 'interactive-run', message: '前台错误' });
    expect(selectConversationSurfaceError({
      legacyExecution: '旧执行错误',
      annotationRun: '批注错误',
    })).toEqual({ source: 'legacy-execution', message: '旧执行错误' });
    expect(selectConversationSurfaceError({ annotationRun: '批注错误' })).toEqual({
      source: 'annotation-run', message: '批注错误',
    });
  });

  it('忽略空白错误，所有来源为空时返回 null', () => {
    expect(selectConversationSurfaceError({
      interactiveRun: '  ', legacyExecution: null, annotationRun: undefined,
    })).toBeNull();
  });
});
