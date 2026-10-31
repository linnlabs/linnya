import { CommandRunnerOwnedPipeProcessLaunchError } from '../definitions/commandRunnerOwnedPipeProcess';
import { CommandRunnerOwnedPtyProcessLaunchError } from '../definitions/commandRunnerOwnedPtyProcess';

/** 诊断只保留原生阶段与系统码。error.message 可能含路径或命令，不能整段写入日志。 */
export function projectCommandLaunchDiagnostic(error: unknown): string {
  const failure = error instanceof CommandRunnerOwnedPipeProcessLaunchError
    || error instanceof CommandRunnerOwnedPtyProcessLaunchError
    ? error.failureCode : 'unclassified';
  const stages = new Set<string>();
  const codes = new Set<string>();
  const visited = new Set<Error>();
  let current = error;
  while (current instanceof Error && !visited.has(current)) {
    visited.add(current);
    for (const match of current.message.matchAll(/\bwindows_(?:process_owner|command_isolation) stage=([a-z_]+)\b/gu)) {
      stages.add(match[1]);
    }
    for (const match of current.message.matchAll(/\bwin32_error=(\d+)\b|\b(0x[\da-fA-F]{8})\b/gu)) {
      codes.add(match[1] ?? match[2]);
    }
    current = 'cause' in current ? current.cause : undefined;
  }
  return `launch_failed code=${failure} native_stages=${[...stages].join(',')} system_codes=${[...codes].join(',')}`;
}
