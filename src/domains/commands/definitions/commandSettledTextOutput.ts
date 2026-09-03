import type { ToolOutputBlobId } from '@app/schemas';

export type CommandSettledTextResource =
  | {
      readonly status: 'published';
      readonly completeness: 'complete' | 'incomplete';
      readonly blobId: ToolOutputBlobId;
      readonly persistedCharacters: number;
      readonly persistedLines: number;
    }
  | {
      readonly status: 'not_created';
      readonly reason: 'source_not_started' | 'empty';
    }
  | { readonly status: 'unavailable' };

/**
 * 命令终态的稳定文本 sidecar。它只表达 Agent 可续读的 ToolOutputStore 事实，
 * 不持有 writer、文件路径、raw artifact、renderer 屏幕或平台进程资源。
 */
export type CommandSettledTextOutput =
  | {
      readonly mode: 'pipe';
      readonly stdout: CommandSettledTextResource;
      readonly stderr: CommandSettledTextResource;
    }
  | {
      readonly mode: 'pty';
      readonly terminal: CommandSettledTextResource;
    };

export function createUnavailableCommandSettledTextOutput(
  mode: CommandSettledTextOutput['mode'],
): CommandSettledTextOutput {
  return mode === 'pipe'
    ? Object.freeze({
        mode: 'pipe',
        stdout: Object.freeze({ status: 'unavailable' }),
        stderr: Object.freeze({ status: 'unavailable' }),
      })
    : Object.freeze({
        mode: 'pty',
        terminal: Object.freeze({ status: 'unavailable' }),
      });
}
