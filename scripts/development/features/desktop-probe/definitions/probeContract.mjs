import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const repoRoot = realpathSync(fileURLToPath(new URL('../../../../../', import.meta.url)));
export const defaultOptions = Object.freeze({ name: 'default', mode: 'dev', window: 'hidden', width: 1400, height: 900 });
export const idleMs = 30 * 60_000;

const exitCodes = {
  USAGE: 2, NOT_RUNNING: 3, TIMEOUT: 4,
  STALE_REF: 5, NOT_FOUND: 5, NOT_VISIBLE: 5, HIT_TEST_BLOCKED: 5,
  FOLLOW_MISMATCH: 6,
};

export class ProbeError extends Error {
  constructor(code, message, hint, details) {
    super(message);
    this.code = code;
    this.hint = hint;
    this.details = details;
    this.exitCode = exitCodes[code] ?? 1;
  }
}
