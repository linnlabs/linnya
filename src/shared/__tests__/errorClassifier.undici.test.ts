import { describe, expect, it } from 'vitest';

import { ErrorCategory, ErrorClassifier } from '../../shared/errorClassifier';

describe('ErrorClassifier - undici/terminated', () => {
  it('不应将包含 terminated 的本地业务错误视为网络错误', () => {
    const err = new Error('cancelled terminal must remain terminated after replay');
    const classification = ErrorClassifier.classify(err);

    expect(classification.category).toBe(ErrorCategory.NON_RETRYABLE);
    expect(classification.reason).toBe('未知错误类型（保守策略）');
  });

  it('应将 TypeError("terminated") 视为可重试网络错误', () => {
    const err = new TypeError('terminated');
    const classification = ErrorClassifier.classify(err);
    expect(classification.category).toBe(ErrorCategory.RETRYABLE);
  });

  it('应将 cause.code=UND_ERR_SOCKET 视为可重试网络错误', () => {
    const err = new TypeError('terminated');
    Object.defineProperty(err, 'cause', {
      value: { name: 'SocketError', message: 'other side closed', code: 'UND_ERR_SOCKET' },
      enumerable: false,
    });
    const classification = ErrorClassifier.classify(err);
    expect(classification.category).toBe(ErrorCategory.RETRYABLE);
  });
});
