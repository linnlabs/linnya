import {
  parseLocalProcessPlatformRuntime,
  type LocalProcessPlatformRuntime,
} from '../definitions/localProcessPlatformRuntime';

export function serializeLocalProcessPlatformRuntime(
  runtime: LocalProcessPlatformRuntime,
): string {
  return JSON.stringify(parseLocalProcessPlatformRuntime(runtime));
}

export function parseSerializedLocalProcessPlatformRuntime(
  value: string | undefined,
): LocalProcessPlatformRuntime {
  if (!value) throw new Error('local process platform runtime argument is required');
  let decoded: unknown;
  try {
    decoded = JSON.parse(value) as unknown;
  } catch {
    throw new Error('local process platform runtime argument is not valid JSON');
  }
  return parseLocalProcessPlatformRuntime(decoded);
}
