import fsp from 'node:fs/promises';
import path from 'node:path';

import { CommandExecutionIdSchema } from '@app/schemas/commands';

import {
  CommandOutputArtifactManifestSchema,
  type CommandOutputArtifactManifest,
} from '../../../../domains/commands/definitions/commandOutputArtifact';
import type {
  CommandOutputArtifactMaintenanceStats,
} from '../../../../domains/commands/definitions/commandOutputArtifactMaintenance';
import type {
  CommandOutputArtifactMaintenancePort,
} from '../../../../domains/commands/ports/commandOutputArtifactMaintenancePort';
import { deriveCommandOutputArtifactRelativePaths } from './functions/deriveCommandOutputArtifactRelativePaths';

const HASHED_CONVERSATION_DIRECTORY = /^conversation_[a-f0-9]{64}$/;
const HASHED_INSTANCE_DIRECTORY = /^instance_[a-f0-9]{64}$/;
const MANIFEST_FILE_NAME = 'manifest.json';
const MAX_MANIFEST_BYTES = 64 * 1024;

export interface CommandOutputArtifactMaintenanceLogger {
  warn(message: string): void;
}

function readNodeErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}

function assertTimestamp(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('command output artifact maintenance nowMs must be a non-negative safe integer');
  }
  return value;
}

async function listMatchingDirectories(
  parentPath: string,
  acceptsName: (name: string) => boolean,
): Promise<string[]> {
  let entries;
  try {
    entries = await fsp.readdir(parentPath, { withFileTypes: true });
  } catch (error: unknown) {
    if (readNodeErrorCode(error) === 'ENOENT') return [];
    throw error;
  }
  return entries
    .filter(entry => entry.isDirectory() && acceptsName(entry.name))
    .map(entry => path.join(parentPath, entry.name));
}

async function readSealedManifest(executionDirectory: string): Promise<CommandOutputArtifactManifest> {
  const manifestPath = path.join(executionDirectory, MANIFEST_FILE_NAME);
  const stat = await fsp.lstat(manifestPath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error('command output artifact manifest is not a regular file');
  }
  if (stat.size > MAX_MANIFEST_BYTES) {
    throw new Error(`command output artifact manifest exceeds ${MAX_MANIFEST_BYTES} bytes`);
  }
  const raw = await fsp.readFile(manifestPath, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  return CommandOutputArtifactManifestSchema.parse(parsed);
}

function assertManifestOwnsDirectory(input: {
  readonly storageRoot: string;
  readonly executionDirectory: string;
  readonly manifest: CommandOutputArtifactManifest;
}): void {
  const relativePaths = deriveCommandOutputArtifactRelativePaths(
    input.manifest.owner,
    input.manifest.mode,
  );
  const expectedDirectory = path.join(input.storageRoot, ...relativePaths.directorySegments);
  if (path.resolve(input.executionDirectory) !== path.resolve(expectedDirectory)) {
    throw new Error('command output artifact manifest owner does not match its directory');
  }
}

async function discoverExecutionDirectories(input: {
  readonly storageRoot: string;
  readonly logger: CommandOutputArtifactMaintenanceLogger;
}): Promise<{ readonly directories: string[]; readonly failed: number }> {
  const directories: string[] = [];
  let failed = 0;
  let conversationDirectories: string[];
  try {
    conversationDirectories = await listMatchingDirectories(
      input.storageRoot,
      name => HASHED_CONVERSATION_DIRECTORY.test(name),
    );
  } catch (error: unknown) {
    input.logger.warn(
      `原始命令输出扫描失败: root=${input.storageRoot}, `
      + `err=${error instanceof Error ? error.message : String(error)}`,
    );
    return { directories, failed: 1 };
  }

  for (const conversationDirectory of conversationDirectories) {
    const instancesRoot = path.join(conversationDirectory, 'instances');
    let instanceDirectories: string[];
    try {
      instanceDirectories = await listMatchingDirectories(
        instancesRoot,
        name => HASHED_INSTANCE_DIRECTORY.test(name),
      );
    } catch (error: unknown) {
      failed += 1;
      input.logger.warn(
        `原始命令输出扫描失败: root=${instancesRoot}, `
        + `err=${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
    for (const instanceDirectory of instanceDirectories) {
      const commandOutputRoot = path.join(instanceDirectory, 'command-output');
      try {
        directories.push(...await listMatchingDirectories(
          commandOutputRoot,
          name => CommandExecutionIdSchema.safeParse(name).success,
        ));
      } catch (error: unknown) {
        failed += 1;
        input.logger.warn(
          `原始命令输出扫描失败: root=${commandOutputRoot}, `
          + `err=${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
  return { directories, failed };
}

/**
 * 只在 Agent 命令入口开放前运行。manifest-last 是“writer 已封口”的唯一事实，
 * 所以损坏 manifest、身份错位和未封口目录一律保留；维护不能根据 mtime 猜测并误删。
 */
export function createFileCommandOutputArtifactMaintenancePort(input: {
  readonly storageRoot: string;
  readonly logger: CommandOutputArtifactMaintenanceLogger;
}): CommandOutputArtifactMaintenancePort {
  if (!path.isAbsolute(input.storageRoot)) {
    throw new Error('command output artifact maintenance storageRoot must be absolute');
  }
  const storageRoot = path.resolve(input.storageRoot);

  return {
    async cleanupExpired(request): Promise<CommandOutputArtifactMaintenanceStats> {
      const nowMs = assertTimestamp(request.nowMs);
      const stats = { scanned: 0, retained: 0, deleted: 0, failed: 0 };
      const discovery = await discoverExecutionDirectories({
        storageRoot,
        logger: input.logger,
      });
      stats.failed += discovery.failed;

      for (const executionDirectory of discovery.directories) {
        stats.scanned += 1;
        try {
          const manifest = await readSealedManifest(executionDirectory);
          assertManifestOwnsDirectory({ storageRoot, executionDirectory, manifest });
          if (manifest.retention_until_ms > nowMs) {
            stats.retained += 1;
            continue;
          }
          await fsp.rm(executionDirectory, {
            recursive: true,
            maxRetries: 10,
            retryDelay: 100,
          });
          stats.deleted += 1;
        } catch (error: unknown) {
          stats.failed += 1;
          input.logger.warn(
            `原始命令输出清理失败: path=${executionDirectory}, `
            + `err=${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      return stats;
    },
  };
}
