import { createHash } from 'node:crypto';

import {
  CommandOutputArtifactOwnerSchema,
  type CommandOutputArtifactOwner,
} from '../../../../../domains/commands/definitions/commandOutputArtifact';

export interface CommandOutputArtifactRelativePaths {
  readonly directorySegments: readonly string[];
  readonly streamFileNames: readonly ('stdout.bin' | 'stderr.bin' | 'terminal.bin')[];
  readonly manifestFileName: 'manifest.json';
}

function encodeOwnerSegment(prefix: 'conversation' | 'instance', value: string): string {
  const digest = createHash('sha256').update(value, 'utf8').digest('hex');
  return `${prefix}_${digest}`;
}

/**
 * 通用 path sanitizer 会把不同非法字符都替换成 `_`，也会直接截断长身份，因此不能承担
 * command artifact 的 owner 隔离。这里使用稳定摘要生成路径段，原始身份仍由 manifest 校验。
 */
export function deriveCommandOutputArtifactRelativePaths(
  rawOwner: CommandOutputArtifactOwner,
  mode: 'pipe' | 'pty',
): CommandOutputArtifactRelativePaths {
  const owner = CommandOutputArtifactOwnerSchema.parse(rawOwner);
  const streamFileNames = mode === 'pipe'
    ? ['stdout.bin', 'stderr.bin'] as const
    : ['terminal.bin'] as const;

  return {
    directorySegments: [
      encodeOwnerSegment('conversation', owner.identity.conversation_id),
      'instances',
      encodeOwnerSegment('instance', owner.instance_id),
      'command-output',
      owner.identity.command_execution_id,
    ],
    streamFileNames,
    manifestFileName: 'manifest.json',
  };
}
