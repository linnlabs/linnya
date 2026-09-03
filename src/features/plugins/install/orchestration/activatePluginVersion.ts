import fs from 'node:fs';
import path from 'node:path';

import { parsePluginManifest, type PluginId } from '@app/schemas';

interface ActivePluginPointer {
  readonly version: string;
  readonly previousVersion?: string;
}

export type ActivatePluginVersionResult =
  | {
      readonly status: 'activated';
      readonly pluginId: PluginId;
      readonly version: string;
      readonly previousVersion: string | null;
    }
  | {
      readonly status: 'failed';
      readonly pluginId: PluginId;
      readonly version: string;
      readonly error: string;
    };

export type RollbackActivePluginVersionResult =
  | {
      readonly status: 'rolled-back';
      readonly pluginId: PluginId;
      readonly fromVersion: string;
      readonly toVersion: string;
    }
  | {
      readonly status: 'skipped';
      readonly pluginId: PluginId;
      readonly reason: 'no-active' | 'no-previous' | 'failed-version-mismatch' | 'previous-version-missing';
      readonly detail?: string;
    }
  | {
      readonly status: 'failed';
      readonly pluginId: PluginId;
      readonly error: string;
    };

export interface ActivatePluginVersionOptions {
  readonly userPluginRoot: string;
  readonly pluginId: PluginId;
  readonly version: string;
  readonly expectedPreviousVersion?: string | null;
}

export type PreparePluginVersionActivationResult =
  | {
      readonly status: 'ready';
      readonly pluginId: PluginId;
      readonly version: string;
      readonly previousVersion: string | null;
    }
  | {
      readonly status: 'failed';
      readonly pluginId: PluginId;
      readonly version: string;
      readonly error: string;
    };

export interface RollbackActivePluginVersionOptions {
  readonly userPluginRoot: string;
  readonly pluginId: PluginId;
  readonly failedVersion?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getPluginInstallDir(userPluginRoot: string, pluginId: PluginId): string {
  return path.join(userPluginRoot, pluginId);
}

function getActivePath(userPluginRoot: string, pluginId: PluginId): string {
  return path.join(getPluginInstallDir(userPluginRoot, pluginId), 'active.json');
}

function parseActivePluginPointer(input: unknown): ActivePluginPointer {
  if (!isRecord(input) || typeof input.version !== 'string' || input.version.trim().length === 0) {
    throw new Error('active.json 必须声明非空 version');
  }
  const previousVersion = input.previousVersion;
  if (previousVersion !== undefined && typeof previousVersion !== 'string') {
    throw new Error('active.json previousVersion 必须是字符串');
  }
  return previousVersion && previousVersion.trim().length > 0
    ? { version: input.version, previousVersion }
    : { version: input.version };
}

export function readActivePluginPointer(
  userPluginRoot: string,
  pluginId: PluginId,
): ActivePluginPointer | null {
  const activePath = getActivePath(userPluginRoot, pluginId);
  if (!fs.existsSync(activePath)) return null;
  return parseActivePluginPointer(JSON.parse(fs.readFileSync(activePath, 'utf8')) as unknown);
}

export function writeActivePluginPointerAtomically(
  userPluginRoot: string,
  pluginId: PluginId,
  pointer: ActivePluginPointer,
): void {
  const activePath = getActivePath(userPluginRoot, pluginId);
  fs.mkdirSync(path.dirname(activePath), { recursive: true });
  const tempPath = path.join(path.dirname(activePath), `.active.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tempPath, `${JSON.stringify(pointer, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, activePath);
}

export function syncActivePluginPointer(
  options: {
    readonly userPluginRoot: string;
    readonly pluginId: PluginId;
    readonly version: string;
    readonly previousVersion?: string | null;
  },
): void {
  readVersionManifest(options.userPluginRoot, options.pluginId, options.version);
  const pointer: ActivePluginPointer = options.previousVersion && options.previousVersion !== options.version
    ? { version: options.version, previousVersion: options.previousVersion }
    : { version: options.version };
  writeActivePluginPointerAtomically(options.userPluginRoot, options.pluginId, pointer);
}

function readVersionManifest(userPluginRoot: string, pluginId: PluginId, version: string): void {
  const manifestPath = path.join(getPluginInstallDir(userPluginRoot, pluginId), version, 'plugin.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`插件版本目录缺少 plugin.json: ${pluginId}@${version}`);
  }
  const manifest = parsePluginManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as unknown);
  if (manifest.id !== pluginId || manifest.version !== version) {
    throw new Error(`插件版本目录 manifest 不匹配: expected=${pluginId}@${version}, actual=${manifest.id}@${manifest.version}`);
  }
}

function assertExpectedPreviousVersion(
  expectedPreviousVersion: string | null | undefined,
  actualPreviousVersion: string | null,
): void {
  if (expectedPreviousVersion === undefined) {
    return;
  }

  if (expectedPreviousVersion !== actualPreviousVersion) {
    throw new Error(
      `active.json previousVersion changed during activation: expected=${expectedPreviousVersion ?? 'none'}, actual=${actualPreviousVersion ?? 'none'}`,
    );
  }
}

export function activatePluginVersion(options: ActivatePluginVersionOptions): ActivatePluginVersionResult {
  try {
    const prepared = preparePluginVersionActivation(options);
    if (prepared.status === 'failed') {
      return prepared;
    }
    const previousVersion = prepared.previousVersion;
    assertExpectedPreviousVersion(options.expectedPreviousVersion, previousVersion);
    syncActivePluginPointer({
      userPluginRoot: options.userPluginRoot,
      pluginId: options.pluginId,
      version: options.version,
      previousVersion,
    });
    return {
      status: 'activated',
      pluginId: options.pluginId,
      version: options.version,
      previousVersion,
    };
  } catch (error) {
    return {
      status: 'failed',
      pluginId: options.pluginId,
      version: options.version,
      error: readErrorMessage(error),
    };
  }
}

export function preparePluginVersionActivation(
  options: ActivatePluginVersionOptions,
): PreparePluginVersionActivationResult {
  try {
    readVersionManifest(options.userPluginRoot, options.pluginId, options.version);
    const active = readActivePluginPointer(options.userPluginRoot, options.pluginId);
    return {
      status: 'ready',
      pluginId: options.pluginId,
      version: options.version,
      previousVersion: active?.version ?? null,
    };
  } catch (error) {
    return {
      status: 'failed',
      pluginId: options.pluginId,
      version: options.version,
      error: readErrorMessage(error),
    };
  }
}

export function rollbackActivePluginVersion(
  options: RollbackActivePluginVersionOptions,
): RollbackActivePluginVersionResult {
  try {
    const active = readActivePluginPointer(options.userPluginRoot, options.pluginId);
    if (!active) {
      return { status: 'skipped', pluginId: options.pluginId, reason: 'no-active' };
    }
    if (options.failedVersion && active.version !== options.failedVersion) {
      return {
        status: 'skipped',
        pluginId: options.pluginId,
        reason: 'failed-version-mismatch',
        detail: `active=${active.version}, failed=${options.failedVersion}`,
      };
    }
    if (!active.previousVersion) {
      return { status: 'skipped', pluginId: options.pluginId, reason: 'no-previous' };
    }

    const previousVersionDir = path.join(getPluginInstallDir(options.userPluginRoot, options.pluginId), active.previousVersion);
    if (!fs.existsSync(previousVersionDir)) {
      return {
        status: 'skipped',
        pluginId: options.pluginId,
        reason: 'previous-version-missing',
        detail: previousVersionDir,
      };
    }

    readVersionManifest(options.userPluginRoot, options.pluginId, active.previousVersion);
    writeActivePluginPointerAtomically(options.userPluginRoot, options.pluginId, {
      version: active.previousVersion,
    });
    return {
      status: 'rolled-back',
      pluginId: options.pluginId,
      fromVersion: active.version,
      toVersion: active.previousVersion,
    };
  } catch (error) {
    return {
      status: 'failed',
      pluginId: options.pluginId,
      error: readErrorMessage(error),
    };
  }
}
