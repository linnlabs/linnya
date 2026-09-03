import { describe, expect, it } from 'vitest';

import { classifyCommandPlatformLaunchFailure } from './classifyCommandPlatformLaunchFailure';

function errorWithCode(code: string): Error {
  const error = new Error(`spawn failed with ${code}`);
  Object.defineProperty(error, 'code', { value: code, enumerable: true });
  return error;
}

function errorWithCause(message: string, cause: Error): Error {
  const error = new Error(message);
  Object.defineProperty(error, 'cause', { value: cause, enumerable: false });
  return error;
}

describe('classifyCommandPlatformLaunchFailure', () => {
  it.each(['E2BIG', 'ENAMETOOLONG'])('识别 cause 链中的 %s 启动载荷错误', (code) => {
    const platformError = errorWithCause(
      'platform owner failed',
      errorWithCause('sandbox wrapper failed', errorWithCode(code)),
    );

    expect(classifyCommandPlatformLaunchFailure(platformError))
      .toBe('launch_payload_too_large');
  });

  it('识别 Windows native 的最终 UTF-16 command line 预算错误', () => {
    const nativeError = new Error(
      'windows_process_owner stage=command_line detail=payload has 32768 UTF-16 units; '
      + 'maximum including NUL is 32767',
    );

    expect(classifyCommandPlatformLaunchFailure(nativeError))
      .toBe('launch_payload_too_large');
  });

  it('不把其他参数错误或普通 owner 失败误报为载荷过大', () => {
    expect(classifyCommandPlatformLaunchFailure(
      new Error('windows_process_owner stage=environment detail=value contains NUL'),
    )).toBeUndefined();
    expect(classifyCommandPlatformLaunchFailure(errorWithCode('ENOENT'))).toBeUndefined();
  });
});
