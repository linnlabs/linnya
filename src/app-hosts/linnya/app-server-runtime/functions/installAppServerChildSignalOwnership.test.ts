import { EventEmitter } from 'node:events';

import { describe, expect, it } from 'vitest';

import { installAppServerChildSignalOwnership } from './installAppServerChildSignalOwnership';

describe('App Server child process ownership', () => {
  it('parent diagnostic pipe 断开不会以未处理 EPIPE 打断 Backend 收口', () => {
    const diagnosticPipe = new EventEmitter();
    const ownership = installAppServerChildSignalOwnership(diagnosticPipe);

    expect(() => diagnosticPipe.emit('error', Object.assign(
      new Error('broken pipe'),
      { code: 'EPIPE' },
    ))).not.toThrow();

    ownership.dispose();
    expect(diagnosticPipe.listenerCount('error')).toBe(0);
  });
});
