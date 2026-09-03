import { describe, expect, it } from 'vitest';
import { readToolExecutionErrorCode } from './readToolExecutionErrorCode';

describe('readToolExecutionErrorCode', () => {
  it('读取工具 owner 声明的稳定错误码', () => {
    const error = new Error('model missing');
    Object.defineProperty(error, 'code', {
      value: 'image_generation.model_not_configured',
      enumerable: true,
    });
    expect(readToolExecutionErrorCode(error)).toBe('image_generation.model_not_configured');
  });

  it('普通异常不制造业务错误码', () => {
    expect(readToolExecutionErrorCode(new Error('network failed'))).toBeUndefined();
    expect(readToolExecutionErrorCode({ code: '' })).toBeUndefined();
  });
});
