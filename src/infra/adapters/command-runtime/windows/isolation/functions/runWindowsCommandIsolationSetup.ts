import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';

const execute = promisify(execFile);
const StatusSchema = z.enum(['ready', 'setup_required']);
const EnableSchema = z.enum(['ready', 'cancelled']);

/** 只调用已校验的固定产品 helper；不通过 Shell 拼接提升命令。 */
export function createWindowsCommandIsolationSetupProcess(input: {
  readonly helperPath: string;
  readonly environment: Readonly<Record<string, string>>;
}) {
  async function invoke(mode: 'status' | 'enable'): Promise<unknown> {
    const result = await execute(input.helperPath, [mode], {
      env: { ...input.environment },
      windowsHide: true,
      encoding: 'utf8',
      timeout: mode === 'status' ? 10_000 : 240_000,
      maxBuffer: 16 * 1024,
    });
    return JSON.parse(result.stdout) as unknown;
  }
  return Object.freeze({
    async status() { return StatusSchema.parse(await invoke('status')); },
    async enable() { return EnableSchema.parse(await invoke('enable')); },
  });
}
