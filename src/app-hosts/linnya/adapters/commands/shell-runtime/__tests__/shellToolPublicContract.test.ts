import { describe, expect, it } from 'vitest';

import {
  parseProcessToolRuntimeResult,
  parseShellToolRuntimeResult,
} from '../definitions';
import { projectProcessToolRejectionCode } from '../functions';

describe('Shell/process Agent public contract', () => {
  it('把跨 scope handle 与未知 handle 投影成同一公开结果', () => {
    expect(projectProcessToolRejectionCode('scope_mismatch')).toBe('unknown_handle');
    expect(projectProcessToolRejectionCode('unknown_handle')).toBe('unknown_handle');
    expect(projectProcessToolRejectionCode('handle_expired')).toBe('handle_expired');
    expect(projectProcessToolRejectionCode('stdin_closed')).toBe('stdin_closed');
  });

  it('拒绝 runtime 误带的进程和 artifact 内部事实', () => {
    expect(() => parseShellToolRuntimeResult({
      status: 'completed',
      terminal: { outcome: 'exited', exitCode: 0, signal: null },
      observation: 'done',
      pid: 42,
    })).toThrow();
    expect(() => parseProcessToolRuntimeResult({
      status: 'running',
      nextCursor: 1,
      observation: 'still running',
      artifactPath: '/private/command-output/stdout.bin',
    })).toThrow();
    expect(() => parseProcessToolRuntimeResult({
      status: 'rejected',
      code: 'scope_mismatch',
      observation: 'wrong scope',
    })).toThrow();
  });
});
