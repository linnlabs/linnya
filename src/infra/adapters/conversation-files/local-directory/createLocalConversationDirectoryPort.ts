import { randomUUID } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';

import {
  CONVERSATION_WORK_DIRECTORY_CONTENT_DIRECTORY,
  CONVERSATION_WORK_DIRECTORY_INITIALIZED_SUFFIX,
  CONVERSATION_WORK_DIRECTORY_METADATA_DIRECTORY,
  CONVERSATION_WORK_DIRECTORY_NAMESPACE,
  CONVERSATION_WORK_DIRECTORY_OWNER_SUFFIX,
  ConversationDirectoryError,
  createConversationWorkDirectoryInitializedMarker,
  createConversationWorkDirectoryOwnerMarker,
  deriveConversationWorkDirectoryIdentity,
  planConversationWorkDirectoryResolution,
  validateConversationDirectoryIdentity,
  validateConversationDirectoryInitialized,
  type ConversationDirectoryFailureCode,
  type ConversationDirectoryFailureStage,
  type ConversationDirectoryDeletionPort,
  type ConversationDirectoryPort,
  type ConversationWorkDirectoryUsage,
  type ConversationWorkDirectoryUsagePort,
  type ConversationWorkDirectoryIdentity,
  type ConversationWorkDirectoryResolution,
} from '../../../../domains/conversation-files';

const MAX_MARKER_BYTES = 4 * 1024;
const DELETE_MAX_RETRIES = 3;
const DELETE_RETRY_DELAY_MS = 100;

interface ConversationDirectoryStoragePaths {
  readonly namespaceRoot: string;
  readonly revisionRoot: string;
  readonly metadataRoot: string;
  readonly contentRoot: string;
  readonly ownerMarkerPath: string;
  readonly initializedMarkerPath: string;
  readonly workDirectoryPath: string;
}

function validateDerivedIdentity(
  identity: ConversationWorkDirectoryIdentity,
): ConversationWorkDirectoryIdentity {
  const expected = deriveConversationWorkDirectoryIdentity(identity.conversationId);
  if (
    identity.kind !== expected.kind
    || identity.revision !== expected.revision
    || identity.conversationIdDigest !== expected.conversationIdDigest
    || identity.directoryKey !== expected.directoryKey
  ) {
    throw new ConversationDirectoryError(
      'invalid_conversation_identity',
      'derive_identity',
    );
  }
  return expected;
}

function readNodeErrorCode(error: unknown): string | undefined {
  if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  return undefined;
}

function mapFileSystemFailure(input: {
  readonly error: unknown;
  readonly stage: ConversationDirectoryFailureStage;
  readonly fallbackCode: ConversationDirectoryFailureCode;
}): ConversationDirectoryError {
  if (input.error instanceof ConversationDirectoryError) {
    return input.error;
  }
  const osCode = readNodeErrorCode(input.error);
  if (osCode === 'EACCES' || osCode === 'EPERM') {
    return new ConversationDirectoryError(
      'work_directory_permission_denied',
      input.stage,
      osCode,
    );
  }
  if (osCode === 'ENOSPC' || osCode === 'EDQUOT') {
    return new ConversationDirectoryError(
      'work_directory_storage_full',
      input.stage,
      osCode,
    );
  }
  return new ConversationDirectoryError(input.fallbackCode, input.stage, osCode);
}

function isMissing(error: unknown): boolean {
  return readNodeErrorCode(error) === 'ENOENT';
}

function isAlreadyPresent(error: unknown): boolean {
  return readNodeErrorCode(error) === 'EEXIST';
}

function assertWithinRoot(candidate: string, root: string): void {
  const relative = path.relative(root, candidate);
  if (
    relative === '..'
    || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative)
  ) {
    throw new ConversationDirectoryError(
      'work_directory_unsafe_entry',
      'resolve_path',
    );
  }
}

async function inspectRealDirectory(
  directoryPath: string,
  stage: ConversationDirectoryFailureStage,
  nonDirectoryCode: ConversationDirectoryFailureCode = 'work_directory_unsafe_entry',
): Promise<void> {
  let stat;
  try {
    stat = await fsp.lstat(directoryPath);
  } catch (error: unknown) {
    throw mapFileSystemFailure({
      error,
      stage,
      fallbackCode: stage === 'prepare_namespace'
        ? 'work_directory_root_unavailable'
        : 'work_directory_io_failed',
    });
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new ConversationDirectoryError(nonDirectoryCode, stage);
  }
}

async function inspectDeletionRootIfPresent(directoryPath: string): Promise<boolean> {
  let stat;
  try {
    stat = await fsp.lstat(directoryPath);
  } catch (error: unknown) {
    if (isMissing(error)) {
      return false;
    }
    throw mapFileSystemFailure({
      error,
      stage: 'inspect_deletion_root',
      fallbackCode: 'work_directory_io_failed',
    });
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new ConversationDirectoryError(
      'work_directory_unsafe_entry',
      'inspect_deletion_root',
    );
  }
  return true;
}

async function ensureRealDirectory(directoryPath: string): Promise<void> {
  try {
    await fsp.mkdir(directoryPath, { mode: 0o700 });
  } catch (error: unknown) {
    if (!isAlreadyPresent(error)) {
      throw mapFileSystemFailure({
        error,
        stage: 'prepare_namespace',
        fallbackCode: 'work_directory_root_unavailable',
      });
    }
  }
  await inspectRealDirectory(directoryPath, 'prepare_namespace');
}

async function readMarkerIfPresent(input: {
  readonly markerPath: string;
  readonly identity: ConversationWorkDirectoryIdentity;
  readonly validate: (
    value: unknown,
    expected: ConversationWorkDirectoryIdentity,
  ) => unknown;
}): Promise<boolean> {
  let markerStat;
  try {
    markerStat = await fsp.lstat(input.markerPath);
  } catch (error: unknown) {
    if (isMissing(error)) {
      return false;
    }
    throw mapFileSystemFailure({
      error,
      stage: 'read_identity_marker',
      fallbackCode: 'work_directory_io_failed',
    });
  }
  if (
    !markerStat.isFile()
    || markerStat.isSymbolicLink()
    || markerStat.size > MAX_MARKER_BYTES
  ) {
    throw new ConversationDirectoryError(
      'work_directory_unsafe_entry',
      'read_identity_marker',
    );
  }

  let rawMarker: unknown;
  try {
    rawMarker = JSON.parse(await fsp.readFile(input.markerPath, 'utf8'));
  } catch (error: unknown) {
    throw mapFileSystemFailure({
      error,
      stage: 'read_identity_marker',
      fallbackCode: 'work_directory_unsafe_entry',
    });
  }
  input.validate(rawMarker, input.identity);
  return true;
}

async function publishMarkerWithoutReplacement(input: {
  readonly markerPath: string;
  readonly marker: Readonly<Record<string, string | number>>;
}): Promise<'published' | 'existing'> {
  const stagingPath = `${input.markerPath}.tmp-${randomUUID()}`;
  let stagingMayExist = false;
  let outcome: 'published' | 'existing' | undefined;
  let operationError: unknown;

  try {
    stagingMayExist = true;
    await fsp.writeFile(stagingPath, `${JSON.stringify(input.marker)}\n`, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600,
    });
    try {
      // hard link 是 Node 在 APFS/NTFS 上可用的 no-replace 发布原语；目录 rename 在 POSIX
      // 会覆盖空目标目录，不能用于 owner 事实。
      await fsp.link(stagingPath, input.markerPath);
      outcome = 'published';
    } catch (error: unknown) {
      if (isAlreadyPresent(error)) {
        outcome = 'existing';
      } else {
        operationError = error;
      }
    }
  } catch (error: unknown) {
    operationError = error;
  }

  if (stagingMayExist) {
    try {
      await fsp.unlink(stagingPath);
    } catch (cleanupError: unknown) {
      if (!isMissing(cleanupError)) {
        // 发布错误是这次操作失败的根因；若清理也失败，不能用次生错误覆盖它。
        if (operationError === undefined) {
          throw mapFileSystemFailure({
            error: cleanupError,
            stage: 'cleanup_identity_staging',
            fallbackCode: 'work_directory_io_failed',
          });
        }
      }
    }
  }
  if (operationError !== undefined) {
    throw mapFileSystemFailure({
      error: operationError,
      stage: 'publish_identity_marker',
      fallbackCode: 'work_directory_io_failed',
    });
  }
  if (outcome === undefined) {
    throw new ConversationDirectoryError(
      'work_directory_io_failed',
      'publish_identity_marker',
    );
  }
  return outcome;
}

async function inspectWorkDirectoryIfPresent(directoryPath: string): Promise<boolean> {
  let stat;
  try {
    stat = await fsp.lstat(directoryPath);
  } catch (error: unknown) {
    if (isMissing(error)) {
      return false;
    }
    throw mapFileSystemFailure({
      error,
      stage: 'inspect_directory',
      fallbackCode: 'work_directory_io_failed',
    });
  }
  if (!stat.isDirectory()) {
    throw new ConversationDirectoryError(
      stat.isSymbolicLink()
        ? 'work_directory_unsafe_entry'
        : 'work_directory_path_occupied',
      'inspect_directory',
    );
  }
  return true;
}

async function ensureWorkDirectory(directoryPath: string): Promise<void> {
  if (await inspectWorkDirectoryIfPresent(directoryPath)) {
    return;
  }
  try {
    await fsp.mkdir(directoryPath, { mode: 0o700 });
  } catch (error: unknown) {
    if (isAlreadyPresent(error)) {
      await inspectWorkDirectoryIfPresent(directoryPath);
      return;
    }
    throw mapFileSystemFailure({
      error,
      stage: 'create_directory',
      fallbackCode: 'work_directory_io_failed',
    });
  }
}

async function measureDirectoryTree(directoryPath: string): Promise<{
  readonly byteSize: number;
  readonly fileCount: number;
}> {
  let entries;
  try {
    entries = await fsp.readdir(directoryPath, { withFileTypes: true });
  } catch (error: unknown) {
    // Agent 可以在统计期间正常删除子目录；占用是快照而不是事务，消失的子树按 0 计。
    if (isMissing(error)) {
      return Object.freeze({ byteSize: 0, fileCount: 0 });
    }
    throw mapFileSystemFailure({
      error,
      stage: 'measure_work_directory',
      fallbackCode: 'work_directory_io_failed',
    });
  }

  let byteSize = 0;
  let fileCount = 0;
  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);
    let stat;
    try {
      stat = await fsp.lstat(entryPath);
    } catch (error: unknown) {
      // readdir 与 lstat 之间文件消失是活跃工作目录的正常竞争，不应污染整个设置页。
      if (isMissing(error)) {
        continue;
      }
      throw mapFileSystemFailure({
        error,
        stage: 'measure_work_directory',
        fallbackCode: 'work_directory_io_failed',
      });
    }

    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      const nested = await measureDirectoryTree(entryPath);
      byteSize += nested.byteSize;
      fileCount += nested.fileCount;
      continue;
    }

    byteSize += stat.size;
    fileCount += 1;
  }
  return Object.freeze({ byteSize, fileCount });
}

export function createLocalConversationDirectoryPort(input: {
  readonly storageRoot: string;
}): ConversationDirectoryPort
  & ConversationDirectoryDeletionPort
  & ConversationWorkDirectoryUsagePort {
  if (!path.isAbsolute(input.storageRoot)) {
    throw new ConversationDirectoryError(
      'work_directory_root_unavailable',
      'resolve_path',
    );
  }

  const storageRoot = path.resolve(input.storageRoot);
  const inFlight = new Map<string, Promise<ConversationWorkDirectoryResolution>>();

  function resolvePaths(identity: ConversationWorkDirectoryIdentity): ConversationDirectoryStoragePaths {
    const namespaceRoot = path.join(storageRoot, CONVERSATION_WORK_DIRECTORY_NAMESPACE);
    const revisionRoot = path.join(namespaceRoot, `v${identity.revision}`);
    const metadataRoot = path.join(revisionRoot, CONVERSATION_WORK_DIRECTORY_METADATA_DIRECTORY);
    const contentRoot = path.join(revisionRoot, CONVERSATION_WORK_DIRECTORY_CONTENT_DIRECTORY);
    const paths = {
      namespaceRoot,
      revisionRoot,
      metadataRoot,
      contentRoot,
      ownerMarkerPath: path.join(
        metadataRoot,
        `${identity.directoryKey}${CONVERSATION_WORK_DIRECTORY_OWNER_SUFFIX}`,
      ),
      initializedMarkerPath: path.join(
        metadataRoot,
        `${identity.directoryKey}${CONVERSATION_WORK_DIRECTORY_INITIALIZED_SUFFIX}`,
      ),
      workDirectoryPath: path.join(contentRoot, identity.directoryKey),
    };
    for (const candidate of Object.values(paths)) {
      assertWithinRoot(candidate, storageRoot);
    }
    return paths;
  }

  function resolvePath(identity: ConversationWorkDirectoryIdentity): string {
    return resolvePaths(validateDerivedIdentity(identity)).workDirectoryPath;
  }

  async function ensureDirectory(
    rawIdentity: ConversationWorkDirectoryIdentity,
  ): Promise<ConversationWorkDirectoryResolution> {
    const identity = validateDerivedIdentity(rawIdentity);
    const existing = inFlight.get(identity.directoryKey);
    if (existing) {
      return existing;
    }

    const operation = (async (): Promise<ConversationWorkDirectoryResolution> => {
      await inspectRealDirectory(
        storageRoot,
        'prepare_namespace',
        'work_directory_root_unavailable',
      );
      const paths = resolvePaths(identity);
      await ensureRealDirectory(paths.namespaceRoot);
      await ensureRealDirectory(paths.revisionRoot);
      await ensureRealDirectory(paths.metadataRoot);
      await ensureRealDirectory(paths.contentRoot);

      const ownerExists = await readMarkerIfPresent({
        markerPath: paths.ownerMarkerPath,
        identity,
        validate: validateConversationDirectoryIdentity,
      });
      const initializedBefore = await readMarkerIfPresent({
        markerPath: paths.initializedMarkerPath,
        identity,
        validate: validateConversationDirectoryInitialized,
      });
      const directoryExists = await inspectWorkDirectoryIfPresent(paths.workDirectoryPath);
      const plan = planConversationWorkDirectoryResolution({
        ownerExists,
        initializedExists: initializedBefore,
        directoryExists,
      });

      if (plan.ownerAction === 'publish') {
        const ownerPublish = await publishMarkerWithoutReplacement({
          markerPath: paths.ownerMarkerPath,
          marker: createConversationWorkDirectoryOwnerMarker(identity),
        });
        if (ownerPublish === 'existing') {
          const publishedOwnerExists = await readMarkerIfPresent({
            markerPath: paths.ownerMarkerPath,
            identity,
            validate: validateConversationDirectoryIdentity,
          });
          if (!publishedOwnerExists) {
            throw new ConversationDirectoryError(
              'work_directory_unsafe_entry',
              'read_identity_marker',
            );
          }
        }
      }

      await ensureWorkDirectory(paths.workDirectoryPath);
      if (plan.initializedAction === 'publish') {
        const initializedPublish = await publishMarkerWithoutReplacement({
          markerPath: paths.initializedMarkerPath,
          marker: createConversationWorkDirectoryInitializedMarker(identity),
        });
        if (initializedPublish === 'existing') {
          await readMarkerIfPresent({
            markerPath: paths.initializedMarkerPath,
            identity,
            validate: validateConversationDirectoryInitialized,
          });
        }
      }

      return Object.freeze({
        identity,
        absolutePath: paths.workDirectoryPath,
        status: plan.resolutionStatus,
      });
    })();

    inFlight.set(identity.directoryKey, operation);
    try {
      return await operation;
    } finally {
      inFlight.delete(identity.directoryKey);
    }
  }

  async function hasCompleteDirectoryChain(paths: readonly string[]): Promise<boolean> {
    for (const directoryPath of paths) {
      if (!await inspectDeletionRootIfPresent(directoryPath)) {
        return false;
      }
    }
    return true;
  }

  async function observeDeletionState(
    paths: ConversationDirectoryStoragePaths,
    identity: ConversationWorkDirectoryIdentity,
  ): Promise<{
    readonly ownerExists: boolean;
    readonly initializedExists: boolean;
    readonly directoryExists: boolean;
  }> {
    const contentRootsExist = await hasCompleteDirectoryChain([
      storageRoot,
      paths.namespaceRoot,
      paths.revisionRoot,
      paths.contentRoot,
    ]);
    const directoryExists = contentRootsExist
      ? await inspectWorkDirectoryIfPresent(paths.workDirectoryPath)
      : false;
    const metadataRootsExist = await hasCompleteDirectoryChain([
      storageRoot,
      paths.namespaceRoot,
      paths.revisionRoot,
      paths.metadataRoot,
    ]);
    const ownerExists = metadataRootsExist && await readMarkerIfPresent({
      markerPath: paths.ownerMarkerPath,
      identity,
      validate: validateConversationDirectoryIdentity,
    });
    const initializedExists = metadataRootsExist && await readMarkerIfPresent({
      markerPath: paths.initializedMarkerPath,
      identity,
      validate: validateConversationDirectoryInitialized,
    });
    return { ownerExists, initializedExists, directoryExists };
  }

  async function deleteWorkDirectory(
    rawIdentity: ConversationWorkDirectoryIdentity,
  ): Promise<void> {
    const identity = validateDerivedIdentity(rawIdentity);
    const paths = resolvePaths(identity);
    const observed = await observeDeletionState(paths, identity);
    planConversationWorkDirectoryResolution(observed);
    if (!observed.directoryExists) return;

    try {
      // Node 只会对 Windows 常见的 EBUSY/EPERM/ENOTEMPTY 等瞬时失败做有限线性重试；
      // 超过预算后把真实失败交给 cleanup job 重试，不能在 adapter 内无限等待。
      await fsp.rm(paths.workDirectoryPath, {
        recursive: true,
        force: true,
        maxRetries: DELETE_MAX_RETRIES,
        retryDelay: DELETE_RETRY_DELAY_MS,
      });
    } catch (error: unknown) {
      throw mapFileSystemFailure({
        error,
        stage: 'delete_work_directory',
        fallbackCode: 'work_directory_io_failed',
      });
    }
  }

  async function measureWorkDirectory(
    rawIdentity: ConversationWorkDirectoryIdentity,
  ): Promise<ConversationWorkDirectoryUsage> {
    const identity = validateDerivedIdentity(rawIdentity);
    const paths = resolvePaths(identity);
    const observed = await observeDeletionState(paths, identity);
    planConversationWorkDirectoryResolution(observed);

    if (!observed.directoryExists) {
      return Object.freeze({
        identity,
        state: observed.initializedExists
          ? 'previous_files_unavailable'
          : 'not_created',
        byteSize: 0,
        fileCount: 0,
      });
    }

    const measured = await measureDirectoryTree(paths.workDirectoryPath);
    return Object.freeze({
      identity,
      state: 'available',
      byteSize: measured.byteSize,
      fileCount: measured.fileCount,
    });
  }

  async function deleteIdentityMetadata(
    rawIdentity: ConversationWorkDirectoryIdentity,
  ): Promise<void> {
    const identity = validateDerivedIdentity(rawIdentity);
    const paths = resolvePaths(identity);
    const observed = await observeDeletionState(paths, identity);
    planConversationWorkDirectoryResolution(observed);
    if (observed.directoryExists) {
      throw new ConversationDirectoryError(
        'work_directory_still_present',
        'delete_identity_metadata',
      );
    }
    if (!observed.ownerExists && !observed.initializedExists) {
      return;
    }

    try {
      // initialized 先删、owner 最后删；中途失败时，重试仍能用 owner 验证归属。
      await fsp.rm(paths.initializedMarkerPath, { force: true });
      await fsp.rm(paths.ownerMarkerPath, { force: true });
    } catch (error: unknown) {
      throw mapFileSystemFailure({
        error,
        stage: 'delete_identity_metadata',
        fallbackCode: 'work_directory_io_failed',
      });
    }
  }

  return Object.freeze({
    resolvePath,
    ensureDirectory,
    measureWorkDirectory,
    deleteWorkDirectory,
    deleteIdentityMetadata,
  });
}
