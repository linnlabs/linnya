import { createHash, type Hash } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

import {
  CommandOutputArtifactFailureSchema,
  CommandOutputArtifactManifestSchema,
  CommandOutputArtifactOwnerSchema,
  CommandOutputBytesSchema,
  CommandOutputSequenceSchema,
  CommandOutputSourceCompletionSchema,
  type CommandOutputArtifactChunk,
  type CommandOutputArtifactFailure,
  type CommandOutputArtifactFinalizeRequest,
  type CommandOutputArtifactManifest,
  type CommandOutputArtifactOpenRequest,
  type CommandOutputSourceCompletion,
  type CommandOutputStreamSummary,
} from '../../../../domains/commands/definitions/commandOutputArtifact';
import type {
  CommandOutputArtifactAppendResult,
  CommandOutputArtifactDiscardResult,
  CommandOutputArtifactFinalizationResult,
} from '../../../../domains/commands/definitions/commandOutputArtifact';
import type {
  CommandOutputArtifactOpenResult,
  CommandOutputArtifactPort,
  CommandOutputArtifactWriter,
} from '../../../../domains/commands/ports/commandOutputArtifactPort';
import {
  DEFAULT_COMMAND_OUTPUT_ARTIFACT_WRITER_LIMITS,
  validateCommandOutputArtifactWriterLimits,
  type CommandOutputArtifactWriterLimits,
} from './definitions/commandOutputArtifactWriterLimits';
import type {
  CommandOutputArtifactFileOperations,
  CommandOutputArtifactWritableFile,
} from './definitions/commandOutputArtifactFileOperations';
import { deriveCommandOutputArtifactRelativePaths } from './functions/deriveCommandOutputArtifactRelativePaths';
import { publishCommandOutputArtifactManifest } from './functions/publishCommandOutputArtifactManifest';
import { writeCommandOutputArtifactFileFully } from './functions/writeCommandOutputArtifactFileFully';

export type {
  CommandOutputArtifactFileOperations,
  CommandOutputArtifactWritableFile,
} from './definitions/commandOutputArtifactFileOperations';

type OutputChannel = 'stdout' | 'stderr' | 'terminal';

interface StreamState {
  readonly channel: OutputChannel;
  readonly fileName: 'stdout.bin' | 'stderr.bin' | 'terminal.bin';
  readonly file: CommandOutputArtifactWritableFile;
  readonly hash: Hash;
  expectedSequence: number;
  observedBytes: number;
  persistedBytes: number;
  firstFailure?: CommandOutputArtifactFailure;
}

interface PendingWrite {
  readonly stream: StreamState;
  readonly bytes: Uint8Array;
}

type CommandOutputArtifactFailureCause = Omit<
  CommandOutputArtifactFailure,
  'last_persisted_offset'
>;

function createNodeFileOperations(): CommandOutputArtifactFileOperations {
  return {
    async ensureDirectory(directoryPath) {
      await fsp.mkdir(directoryPath, { recursive: true });
    },
    async createDirectory(directoryPath) {
      await fsp.mkdir(directoryPath);
    },
    async openExclusive(filePath) {
      const handle = await fsp.open(filePath, 'wx');
      return {
        async write(bytes, offset, length, position) {
          const result = await handle.write(bytes, offset, length, position);
          return { bytesWritten: result.bytesWritten };
        },
        async sync() {
          await handle.sync();
        },
        async close() {
          await handle.close();
        },
      };
    },
    async rename(sourcePath, destinationPath) {
      await fsp.rename(sourcePath, destinationPath);
    },
    async removeFile(filePath) {
      await fsp.unlink(filePath);
    },
    async removeDirectory(directoryPath) {
      await fsp.rm(directoryPath, { recursive: true, force: true });
    },
  };
}

function readNodeErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }
  return typeof error.code === 'string' ? error.code : undefined;
}

export function classifyCommandOutputArtifactStorageError(
  error: unknown,
): CommandOutputArtifactFailure['code'] {
  switch (readNodeErrorCode(error)) {
    case 'ENOSPC':
      return 'storage_full';
    case 'EDQUOT':
      return 'quota_exceeded';
    case 'EACCES':
    case 'EPERM':
    case 'EROFS':
      return 'permission_denied';
    case 'ENOENT':
    case 'ENOTDIR':
    case 'EISDIR':
    case 'ENAMETOOLONG':
    case 'ELOOP':
    case 'EEXIST':
      return 'path_unavailable';
    default:
      return 'io_failure';
  }
}

function assertTimestamp(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative safe integer`);
  }
  return value;
}

function createFailure(input: {
  readonly error: unknown;
  readonly stage: CommandOutputArtifactFailure['stage'];
  readonly occurredAtMs: number;
  readonly lastPersistedOffset: number;
}): CommandOutputArtifactFailure {
  return CommandOutputArtifactFailureSchema.parse({
    code: classifyCommandOutputArtifactStorageError(input.error),
    stage: input.stage,
    occurred_at_ms: assertTimestamp(input.occurredAtMs, 'occurredAtMs'),
    last_persisted_offset: input.lastPersistedOffset,
  });
}

function createFailureCause(input: {
  readonly error: unknown;
  readonly stage: CommandOutputArtifactFailure['stage'];
  readonly occurredAtMs: number;
}): CommandOutputArtifactFailureCause {
  return {
    code: classifyCommandOutputArtifactStorageError(input.error),
    stage: input.stage,
    occurred_at_ms: assertTimestamp(input.occurredAtMs, 'occurredAtMs'),
  };
}

function materializeFailure(
  cause: CommandOutputArtifactFailureCause,
  lastPersistedOffset: number,
): CommandOutputArtifactFailure {
  return CommandOutputArtifactFailureSchema.parse({
    ...cause,
    last_persisted_offset: lastPersistedOffset,
  });
}

function validateFinalizeRequest(
  request: CommandOutputArtifactFinalizeRequest,
): CommandOutputArtifactFinalizeRequest {
  const sealedAtMs = assertTimestamp(request.sealedAtMs, 'sealedAtMs');
  const retentionUntilMs = assertTimestamp(request.retentionUntilMs, 'retentionUntilMs');
  if (retentionUntilMs <= sealedAtMs) {
    throw new Error('retentionUntilMs must be greater than sealedAtMs');
  }
  if (request.source.mode === 'pipe') {
    return {
      sealedAtMs,
      retentionUntilMs,
      source: {
        mode: 'pipe',
        stdout: CommandOutputSourceCompletionSchema.parse(request.source.stdout),
        stderr: CommandOutputSourceCompletionSchema.parse(request.source.stderr),
      },
    };
  }
  return {
    sealedAtMs,
    retentionUntilMs,
    source: {
      mode: 'pty',
      terminal: CommandOutputSourceCompletionSchema.parse(request.source.terminal),
    },
  };
}

function requirePipeSource(
  request: CommandOutputArtifactFinalizeRequest,
): Extract<CommandOutputArtifactFinalizeRequest, { readonly source: { readonly mode: 'pipe' } }>['source'] {
  if (request.source.mode !== 'pipe') {
    throw new Error('command output finalize mode mismatch: expected pipe, received pty');
  }
  return request.source;
}

function requirePtySource(
  request: CommandOutputArtifactFinalizeRequest,
): Extract<CommandOutputArtifactFinalizeRequest, { readonly source: { readonly mode: 'pty' } }>['source'] {
  if (request.source.mode !== 'pty') {
    throw new Error('command output finalize mode mismatch: expected pty, received pipe');
  }
  return request.source;
}

function channelForFileName(
  fileName: StreamState['fileName'],
): OutputChannel {
  switch (fileName) {
    case 'stdout.bin':
      return 'stdout';
    case 'stderr.bin':
      return 'stderr';
    case 'terminal.bin':
      return 'terminal';
  }
}

function findStream(
  streams: readonly StreamState[],
  channel: OutputChannel,
): StreamState | undefined {
  return streams.find(stream => stream.channel === channel);
}

function validateChunk(
  mode: CommandOutputArtifactOpenRequest['mode'],
  streams: readonly StreamState[],
  chunk: CommandOutputArtifactChunk,
): StreamState {
  if (chunk.mode !== mode) {
    throw new Error(`command output mode mismatch: expected ${mode}, received ${chunk.mode}`);
  }
  CommandOutputBytesSchema.parse(chunk.bytes);
  const sequence = CommandOutputSequenceSchema.parse(chunk.sequence);
  const stream = findStream(streams, chunk.channel);
  if (!stream) {
    throw new Error(`command output channel ${chunk.channel} is unavailable in ${mode} mode`);
  }
  if (sequence !== stream.expectedSequence) {
    throw new Error(
      `command output sequence mismatch for ${chunk.channel}: `
      + `expected ${stream.expectedSequence}, received ${sequence}`,
    );
  }
  return stream;
}

function markStreamFailure(
  stream: StreamState,
  failure: CommandOutputArtifactFailure,
): void {
  if (stream.firstFailure) {
    return;
  }
  stream.firstFailure = CommandOutputArtifactFailureSchema.parse({
    ...failure,
    last_persisted_offset: stream.persistedBytes,
  });
}

function buildStreamSummary(
  stream: StreamState,
  sourceCompletion: CommandOutputSourceCompletion,
): CommandOutputStreamSummary {
  if (stream.firstFailure) {
    return {
      status: 'incomplete',
      source_completion: sourceCompletion,
      observed_bytes: stream.observedBytes,
      persisted_bytes: stream.persistedBytes,
      last_persisted_offset: stream.persistedBytes,
      first_error: stream.firstFailure,
    };
  }
  if (stream.persistedBytes !== stream.observedBytes) {
    throw new Error(`command output stream ${stream.channel} lost bytes without a storage failure`);
  }
  if (sourceCompletion === 'interrupted') {
    return {
      status: 'incomplete',
      source_completion: 'interrupted',
      observed_bytes: stream.observedBytes,
      persisted_bytes: stream.persistedBytes,
      last_persisted_offset: stream.persistedBytes,
      sha256: stream.hash.digest('hex'),
    };
  }
  return {
    status: 'complete',
    source_completion: 'complete',
    observed_bytes: stream.observedBytes,
    persisted_bytes: stream.persistedBytes,
    last_persisted_offset: stream.persistedBytes,
    sha256: stream.hash.digest('hex'),
  };
}

class FileCommandOutputArtifactWriter implements CommandOutputArtifactWriter {
  readonly owner;
  readonly mode;

  private readonly queue: PendingWrite[] = [];
  private readonly affectedChannels = new Set<OutputChannel>();
  private pendingEvents = 0;
  private pendingBytes = 0;
  private pumpPromise?: Promise<void>;
  private firstWriteFailureCause?: CommandOutputArtifactFailureCause;
  private storageIoStopped = false;
  private outputObserved = false;
  private terminalAction?: 'finalize' | 'discard';

  constructor(
    request: CommandOutputArtifactOpenRequest,
    private readonly streams: readonly StreamState[],
    private readonly executionDirectory: string,
    private readonly manifestFileName: string,
    private readonly operations: CommandOutputArtifactFileOperations,
    private readonly now: () => number,
    private readonly limits: CommandOutputArtifactWriterLimits,
  ) {
    this.owner = request.owner;
    this.mode = request.mode;
  }

  append(chunk: CommandOutputArtifactChunk): CommandOutputArtifactAppendResult {
    if (this.terminalAction) {
      throw new Error(`command output artifact writer already started ${this.terminalAction}`);
    }
    const stream = validateChunk(this.mode, this.streams, chunk);
    this.outputObserved = true;
    stream.expectedSequence += 1;
    stream.observedBytes += chunk.bytes.byteLength;

    if (this.firstWriteFailureCause) {
      this.affectedChannels.add(stream.channel);
      return {
        status: 'disabled',
        firstFailureCode: this.firstWriteFailureCause.code,
      };
    }

    if (!this.fits(chunk.bytes.byteLength)) {
      this.firstWriteFailureCause = {
        code: 'sink_overloaded',
        stage: 'append',
        occurred_at_ms: assertTimestamp(this.now(), 'now()'),
      };
      this.affectedChannels.add(stream.channel);
      return { status: 'disabled', firstFailureCode: 'sink_overloaded' };
    }

    // Node Buffer 常被复用，subarray 也可能暗中保留巨大 backing store；准入时复制为精确所有权。
    const ownedBytes = Uint8Array.from(chunk.bytes);
    this.queue.push({ stream, bytes: ownedBytes });
    this.pendingEvents += 1;
    this.pendingBytes += ownedBytes.byteLength;
    this.schedulePump();
    return { status: 'accepted' };
  }

  async discardBeforeSourceStart(): Promise<CommandOutputArtifactDiscardResult> {
    if (this.terminalAction) {
      throw new Error(`command output artifact writer already started ${this.terminalAction}`);
    }
    if (this.outputObserved) {
      throw new Error('command output artifact already observed output');
    }

    // 先封住 writer 再执行任何 await，确保迟到 output 不能在关闭文件与删目录之间进入。
    this.terminalAction = 'discard';
    const closeResults = await Promise.allSettled(
      this.streams.map(stream => stream.file.close()),
    );
    const closeFailure = closeResults.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    // macOS 可以删除仍被打开的文件而 Windows 通常拒绝；关闭失败时保留目录，确保两端事实一致。
    if (closeFailure) {
      return {
        status: 'discard_failed',
        failure: createFailure({
          error: closeFailure.reason,
          stage: 'discard',
          occurredAtMs: this.now(),
          lastPersistedOffset: 0,
        }),
      };
    }

    try {
      await this.operations.removeDirectory(this.executionDirectory);
    } catch (error: unknown) {
      return {
        status: 'discard_failed',
        failure: createFailure({
          error,
          stage: 'discard',
          occurredAtMs: this.now(),
          lastPersistedOffset: 0,
        }),
      };
    }
    return { status: 'discarded' };
  }

  async finalize(
    rawRequest: CommandOutputArtifactFinalizeRequest,
  ): Promise<CommandOutputArtifactFinalizationResult> {
    if (this.terminalAction) {
      throw new Error(`command output artifact writer already started ${this.terminalAction}`);
    }
    const request = validateFinalizeRequest(rawRequest);
    const source = this.mode === 'pipe'
      ? requirePipeSource(request)
      : requirePtySource(request);
    this.terminalAction = 'finalize';
    this.schedulePump();
    await this.pumpPromise;

    if (this.firstWriteFailureCause) {
      for (const channel of this.affectedChannels) {
        const stream = this.requireStream(channel);
        markStreamFailure(
          stream,
          materializeFailure(this.firstWriteFailureCause, stream.persistedBytes),
        );
      }
    }

    for (const stream of this.streams) {
      try {
        await stream.file.sync();
      } catch (error) {
        markStreamFailure(stream, createFailure({
          error,
          stage: 'finalize',
          occurredAtMs: this.now(),
          lastPersistedOffset: stream.persistedBytes,
        }));
      }
      try {
        await stream.file.close();
      } catch (error) {
        markStreamFailure(stream, createFailure({
          error,
          stage: 'finalize',
          occurredAtMs: this.now(),
          lastPersistedOffset: stream.persistedBytes,
        }));
      }
    }

    const base = {
      version: 1 as const,
      owner: this.owner,
      sealed_at_ms: request.sealedAtMs,
      retention_until_ms: request.retentionUntilMs,
    };
    let manifest: CommandOutputArtifactManifest;
    if (source.mode === 'pipe') {
      manifest = CommandOutputArtifactManifestSchema.parse({
        ...base,
        mode: 'pipe',
        stdout: buildStreamSummary(this.requireStream('stdout'), source.stdout),
        stderr: buildStreamSummary(this.requireStream('stderr'), source.stderr),
      });
    } else {
      manifest = CommandOutputArtifactManifestSchema.parse({
        ...base,
        mode: 'pty',
        terminal: buildStreamSummary(this.requireStream('terminal'), source.terminal),
      });
    }

    try {
      await publishCommandOutputArtifactManifest({
        manifest,
        executionDirectory: this.executionDirectory,
        manifestFileName: this.manifestFileName,
        operations: this.operations,
      });
      return { status: 'manifest_persisted', manifest };
    } catch (error) {
      return {
        status: 'manifest_unavailable',
        manifest,
        failure: createFailure({
          error,
          stage: 'finalize',
          occurredAtMs: this.now(),
          lastPersistedOffset: 0,
        }),
      };
    }
  }

  private requireStream(channel: OutputChannel): StreamState {
    const stream = findStream(this.streams, channel);
    if (!stream) {
      throw new Error(`command output stream ${channel} is unavailable`);
    }
    return stream;
  }

  private fits(byteLength: number): boolean {
    return this.pendingEvents < this.limits.maxPendingEvents
      && byteLength <= this.limits.maxPendingBytes - this.pendingBytes;
  }

  private schedulePump(): void {
    if (this.pumpPromise || this.storageIoStopped || this.queue.length === 0) {
      return;
    }
    this.pumpPromise = Promise.resolve()
      .then(() => this.pump())
      .finally(() => {
        this.pumpPromise = undefined;
        if (this.queue.length > 0 && !this.storageIoStopped) {
          this.schedulePump();
        }
      });
  }

  private async pump(): Promise<void> {
    while (this.queue.length > 0 && !this.storageIoStopped) {
      const pending = this.queue.shift();
      if (!pending) break;
      try {
        await writeCommandOutputArtifactFileFully(
          pending.stream.file,
          pending.bytes,
          pending.stream.persistedBytes,
          persisted => {
            pending.stream.hash.update(persisted);
            pending.stream.persistedBytes += persisted.byteLength;
          },
        );
      } catch (error) {
        this.stopStorageIo(
          this.firstWriteFailureCause ?? createFailureCause({
            error,
            stage: 'append',
            occurredAtMs: this.now(),
          }),
          pending.stream.channel,
        );
      } finally {
        this.pendingEvents -= 1;
        this.pendingBytes -= pending.bytes.byteLength;
      }
    }
  }

  private stopStorageIo(
    cause: CommandOutputArtifactFailureCause,
    failingChannel: OutputChannel,
  ): void {
    this.firstWriteFailureCause ??= cause;
    this.storageIoStopped = true;
    this.affectedChannels.add(failingChannel);

    for (const pending of this.queue.splice(0)) {
      this.affectedChannels.add(pending.stream.channel);
      this.pendingEvents -= 1;
      this.pendingBytes -= pending.bytes.byteLength;
    }
  }
}

async function closeStreams(streams: readonly StreamState[]): Promise<void> {
  await Promise.all(streams.map(stream => stream.file.close().catch(() => undefined)));
}

export function createFileCommandOutputArtifactPort(input: {
  /** `<workspace>/Artifacts/v1/conversations`，由组合根显式注入。 */
  readonly storageRoot: string;
  readonly operations?: CommandOutputArtifactFileOperations;
  readonly now?: () => number;
  readonly writerLimits?: CommandOutputArtifactWriterLimits;
}): CommandOutputArtifactPort {
  if (!path.isAbsolute(input.storageRoot)) {
    throw new Error('command output artifact storageRoot must be absolute');
  }
  const storageRoot = path.resolve(input.storageRoot);
  const operations = input.operations ?? createNodeFileOperations();
  const now = input.now ?? Date.now;
  const writerLimits = validateCommandOutputArtifactWriterLimits(
    input.writerLimits ?? DEFAULT_COMMAND_OUTPUT_ARTIFACT_WRITER_LIMITS,
  );

  return {
    async open(rawRequest): Promise<CommandOutputArtifactOpenResult> {
      const request: CommandOutputArtifactOpenRequest = {
        owner: CommandOutputArtifactOwnerSchema.parse(rawRequest.owner),
        mode: rawRequest.mode,
      };
      const relativePaths = deriveCommandOutputArtifactRelativePaths(
        request.owner,
        request.mode,
      );
      const executionDirectory = path.join(storageRoot, ...relativePaths.directorySegments);
      const parentDirectory = path.dirname(executionDirectory);
      const streams: StreamState[] = [];
      let ownsExecutionDirectory = false;
      try {
        await operations.ensureDirectory(parentDirectory);
        await operations.createDirectory(executionDirectory);
        ownsExecutionDirectory = true;
        for (const fileName of relativePaths.streamFileNames) {
          streams.push({
            channel: channelForFileName(fileName),
            fileName,
            file: await operations.openExclusive(path.join(executionDirectory, fileName)),
            hash: createHash('sha256'),
            expectedSequence: 0,
            observedBytes: 0,
            persistedBytes: 0,
          });
        }
      } catch (error) {
        await closeStreams(streams);
        // 相同 execution identity 的第二次 open 不能清理第一位 writer 正在使用的目录。
        if (ownsExecutionDirectory) {
          await operations.removeDirectory(executionDirectory).catch(() => undefined);
        }
        return {
          status: 'unavailable',
          failure: createFailure({
            error,
            stage: 'open',
            occurredAtMs: now(),
            lastPersistedOffset: 0,
          }),
        };
      }

      return {
        status: 'opened',
        writer: new FileCommandOutputArtifactWriter(
          request,
          streams,
          executionDirectory,
          relativePaths.manifestFileName,
          operations,
          now,
          writerLimits,
        ),
      };
    },
  };
}
