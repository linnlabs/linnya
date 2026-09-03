import { createHash, randomUUID, type Hash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';

import {
  TOOL_OUTPUT_BLOCK_CHAR_CAPACITY,
  TOOL_OUTPUT_BODY_ENCODING,
  TOOL_OUTPUT_BODY_FILE_NAME,
  TOOL_OUTPUT_BLOB_FORMAT_VERSION,
  TOOL_OUTPUT_INDEX_FILE_NAME,
  TOOL_OUTPUT_INDEX_RECORD_BYTES,
  TOOL_OUTPUT_MANIFEST_FILE_NAME,
  TOOL_OUTPUT_MANIFEST_MAX_BYTES,
  ToolOutputBlobManifestSchema,
  ToolOutputBlobSourceSchema,
  type ToolOutputBlobManifest,
  type ToolOutputBlobSource,
  type ToolOutputTextBlobCommittedPrefixResult,
  type ToolOutputTextBlobSaveResult,
  type ToolOutputTextBlobWriter,
} from '../definitions/toolOutputBlob';
import { computeToolOutputBlobId } from '../functions/computeToolOutputBlobId';
import { encodeToolOutputBlockIndexRecord } from '../functions/toolOutputBlockIndex';

const FILE_READ_BUFFER_BYTES = 64 * 1024;

function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xd800 && codeUnit <= 0xdbff;
}

export interface ToolOutputTextBlobWritableFile {
  write(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ readonly bytesWritten: number }>;
  truncate(length: number): Promise<void>;
  sync(): Promise<void>;
  close(): Promise<void>;
}

export interface ToolOutputTextBlobWriterDependencies {
  readonly openStagingFile: (filePath: string) => Promise<ToolOutputTextBlobWritableFile>;
}

const DEFAULT_DEPENDENCIES: ToolOutputTextBlobWriterDependencies = Object.freeze({
  openStagingFile: async (filePath: string) => fsp.open(filePath, 'wx'),
});

function readNodeErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}

function countNewlines(text: string): number {
  let count = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 0x0a) count += 1;
  }
  return count;
}

async function writeFully(
  file: ToolOutputTextBlobWritableFile,
  bytes: Uint8Array,
  position: number,
): Promise<void> {
  let written = 0;
  while (written < bytes.byteLength) {
    const result = await file.write(
      bytes,
      written,
      bytes.byteLength - written,
      position + written,
    );
    if (result.bytesWritten <= 0) {
      throw new Error('[ToolOutputStore] 文件写入没有前进');
    }
    written += result.bytesWritten;
  }
}

async function calculateFileSha256(input: {
  readonly filePath: string;
  readonly expectedBytes: number;
  readonly earlyEndMessage: string;
}): Promise<string> {
  const { filePath, expectedBytes, earlyEndMessage } = input;
  const file = await fsp.open(filePath, 'r');
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(FILE_READ_BUFFER_BYTES);
  let position = 0;
  try {
    while (position < expectedBytes) {
      const requested = Math.min(buffer.byteLength, expectedBytes - position);
      const result = await file.read(buffer, 0, requested, position);
      if (result.bytesRead <= 0) {
        throw new Error(earlyEndMessage);
      }
      hash.update(buffer.subarray(0, result.bytesRead));
      position += result.bytesRead;
    }
  } finally {
    await file.close();
  }
  return hash.digest('hex');
}

async function hashPublishedFile(filePath: string, expectedBytes: number): Promise<string> {
  const stat = await fsp.lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== expectedBytes) {
    throw new Error('[ToolOutputStore] 内容地址已存在，但文件形状不一致');
  }
  return calculateFileSha256({
    filePath,
    expectedBytes,
    earlyEndMessage: '[ToolOutputStore] 内容地址文件提前结束',
  });
}

async function publishFileWithoutReplacement(input: {
  readonly stagingPath: string;
  readonly finalPath: string;
  readonly expectedBytes: number;
  readonly expectedSha256: string;
}): Promise<void> {
  try {
    // APFS 与 NTFS 都支持 hard link 的 no-replace 语义；目录 rename 在两个平台并不等价。
    await fsp.link(input.stagingPath, input.finalPath);
  } catch (error: unknown) {
    if (readNodeErrorCode(error) !== 'EEXIST') throw error;
    const existingSha256 = await hashPublishedFile(input.finalPath, input.expectedBytes);
    if (existingSha256 !== input.expectedSha256) {
      throw new Error('[ToolOutputStore] content_address_conflict');
    }
  }
}

async function ensureFinalDirectory(finalDirectory: string): Promise<void> {
  try {
    await fsp.mkdir(finalDirectory);
  } catch (error: unknown) {
    if (readNodeErrorCode(error) !== 'EEXIST') throw error;
    const stat = await fsp.lstat(finalDirectory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error('[ToolOutputStore] blob 目标不是安全目录');
    }
  }
}

class FileToolOutputTextBlobWriter implements ToolOutputTextBlobWriter {
  private pendingText = '';
  private bodyCharCount = 0;
  private bodyByteCount = 0;
  private newlineCount = 0;
  private blockCount = 0;
  private indexByteCount = 0;
  private lastCommittedBlock?: string;
  private readonly bodyHash: Hash = createHash('sha256');
  private readonly indexHash: Hash = createHash('sha256');
  private appendInProgress = false;
  private storageFailure?: unknown;
  private finalizePromise?: Promise<ToolOutputTextBlobSaveResult>;
  private committedPrefixPromise?: Promise<ToolOutputTextBlobCommittedPrefixResult>;
  private abortPromise?: Promise<void>;
  private bodyClosed = false;
  private indexClosed = false;
  private closeFailure?: unknown;

  constructor(
    private readonly blobsDirectory: string,
    private readonly stagingDirectory: string,
    private readonly source: ToolOutputBlobSource,
    private readonly bodyFile: ToolOutputTextBlobWritableFile,
    private readonly indexFile: ToolOutputTextBlobWritableFile,
  ) {}

  async append(text: string): Promise<void> {
    if (typeof text !== 'string') {
      throw new Error('[ToolOutputStore] append 只接受稳定文本');
    }
    if (this.finalizePromise || this.committedPrefixPromise || this.abortPromise) {
      throw new Error('[ToolOutputStore] writer 已进入终结阶段');
    }
    if (this.storageFailure !== undefined) throw this.storageFailure;
    if (this.appendInProgress) {
      throw new Error('[ToolOutputStore] append 必须串行 await');
    }
    if (text.length === 0) return;

    this.appendInProgress = true;
    try {
      let cursor = 0;
      while (cursor < text.length) {
        if (this.pendingText.length === 0 && text.length - cursor >= TOOL_OUTPUT_BLOCK_CHAR_CAPACITY) {
          const block = text.slice(cursor, cursor + TOOL_OUTPUT_BLOCK_CHAR_CAPACITY);
          await this.flushBlock(block);
          cursor += TOOL_OUTPUT_BLOCK_CHAR_CAPACITY;
          continue;
        }
        const accepted = Math.min(
          TOOL_OUTPUT_BLOCK_CHAR_CAPACITY - this.pendingText.length,
          text.length - cursor,
        );
        this.pendingText += text.slice(cursor, cursor + accepted);
        cursor += accepted;
        if (this.pendingText.length === TOOL_OUTPUT_BLOCK_CHAR_CAPACITY) {
          const block = this.pendingText;
          this.pendingText = '';
          await this.flushBlock(block);
        }
      }
    } catch (error: unknown) {
      this.storageFailure = error;
      throw error;
    } finally {
      this.appendInProgress = false;
    }
  }

  finalize(): Promise<ToolOutputTextBlobSaveResult> {
    if (this.abortPromise) {
      return Promise.reject(new Error('[ToolOutputStore] writer 已中止'));
    }
    if (this.committedPrefixPromise) {
      return Promise.reject(new Error('[ToolOutputStore] writer 已进入不完整前缀封存'));
    }
    if (this.finalizePromise) return this.finalizePromise;
    if (this.appendInProgress) {
      return Promise.reject(new Error('[ToolOutputStore] finalize 不能与 append 并发'));
    }
    this.finalizePromise = this.finalizeOnce();
    return this.finalizePromise;
  }

  finalizeCommittedPrefix(): Promise<ToolOutputTextBlobCommittedPrefixResult> {
    if (this.abortPromise) {
      return Promise.reject(new Error('[ToolOutputStore] writer 已中止'));
    }
    if (this.finalizePromise) {
      return Promise.reject(new Error('[ToolOutputStore] writer 已进入完整封存'));
    }
    if (this.committedPrefixPromise) return this.committedPrefixPromise;
    if (this.appendInProgress) {
      return Promise.reject(new Error('[ToolOutputStore] 前缀封存不能与 append 并发'));
    }
    if (this.storageFailure === undefined) {
      return Promise.reject(new Error('[ToolOutputStore] 只有 append 失败后才能封存完整前缀'));
    }
    this.committedPrefixPromise = this.finalizeCommittedPrefixOnce();
    return this.committedPrefixPromise;
  }

  abort(): Promise<void> {
    if (this.abortPromise) return this.abortPromise;
    this.abortPromise = this.abortOnce();
    return this.abortPromise;
  }

  private async flushBlock(text: string): Promise<void> {
    if (text.length === 0 || text.length > TOOL_OUTPUT_BLOCK_CHAR_CAPACITY) {
      throw new Error('[ToolOutputStore] 内部正文 block 长度非法');
    }
    const bodyBytes = Buffer.from(text, TOOL_OUTPUT_BODY_ENCODING);
    const blockNewlines = countNewlines(text);
    const bodySha256 = createHash('sha256').update(bodyBytes).digest('hex');
    const indexBytes = encodeToolOutputBlockIndexRecord({
      newlinesBefore: this.newlineCount,
      charCount: text.length,
      newlineCount: blockNewlines,
      bodySha256,
    });

    await writeFully(this.bodyFile, bodyBytes, this.bodyByteCount);
    await writeFully(this.indexFile, indexBytes, this.indexByteCount);
    this.bodyHash.update(bodyBytes);
    this.indexHash.update(indexBytes);
    this.bodyCharCount += text.length;
    this.bodyByteCount += bodyBytes.byteLength;
    this.newlineCount += blockNewlines;
    this.blockCount += 1;
    this.indexByteCount += indexBytes.byteLength;
    this.lastCommittedBlock = text;
  }

  private async finalizeOnce(): Promise<ToolOutputTextBlobSaveResult> {
    if (this.storageFailure !== undefined) throw this.storageFailure;
    try {
      if (this.pendingText.length > 0) {
        const finalBlock = this.pendingText;
        this.pendingText = '';
        await this.flushBlock(finalBlock);
      }
      if (this.bodyCharCount === 0) {
        throw new Error('[ToolOutputStore] 正文不能为空');
      }
      if (this.bodyByteCount !== this.bodyCharCount * 2) {
        throw new Error('[ToolOutputStore] UTF-16LE 正文字节计量不一致');
      }
      if (this.indexByteCount !== this.blockCount * TOOL_OUTPUT_INDEX_RECORD_BYTES) {
        throw new Error('[ToolOutputStore] block index 字节计量不一致');
      }

      await Promise.all([this.bodyFile.sync(), this.indexFile.sync()]);
      await this.closeHandles();

      const manifest = this.createManifest({
        bodySha256: this.bodyHash.digest('hex'),
        indexSha256: this.indexHash.digest('hex'),
      });
      return await this.publish(manifest);
    } catch (error: unknown) {
      this.storageFailure = error;
      await this.closeHandles().catch(() => undefined);
      throw error;
    }
  }

  private async finalizeCommittedPrefixOnce(): Promise<ToolOutputTextBlobCommittedPrefixResult> {
    if (this.blockCount === 0) {
      return Object.freeze({ status: 'not_created', reason: 'no_committed_block' });
    }
    try {
      // 失败 block 可能只写入了 body 或 index 的一部分。只有两个计数器共同确认的
      // 边界才属于可发布事实，必须先截回该边界再计算最终文件身份。
      await Promise.all([
        this.bodyFile.truncate(this.bodyByteCount),
        this.indexFile.truncate(this.indexByteCount),
      ]);
      await this.repairTrailingHighSurrogate();
      await Promise.all([this.bodyFile.sync(), this.indexFile.sync()]);
      await this.closeHandles();
      const bodyPath = path.join(this.stagingDirectory, TOOL_OUTPUT_BODY_FILE_NAME);
      const indexPath = path.join(this.stagingDirectory, TOOL_OUTPUT_INDEX_FILE_NAME);
      const manifest = this.createManifest({
        bodySha256: await calculateFileSha256({
          filePath: bodyPath,
          expectedBytes: this.bodyByteCount,
          earlyEndMessage: '[ToolOutputStore] staging 正文提前结束',
        }),
        indexSha256: await calculateFileSha256({
          filePath: indexPath,
          expectedBytes: this.indexByteCount,
          earlyEndMessage: '[ToolOutputStore] staging 索引提前结束',
        }),
      });
      const blob = await this.publish(manifest);
      return Object.freeze({
        status: 'published',
        blob,
        persistedCharacters: this.bodyCharCount,
        persistedLines: this.newlineCount + 1,
      });
    } catch (error: unknown) {
      await this.closeHandles().catch(() => undefined);
      throw error;
    }
  }

  private async repairTrailingHighSurrogate(): Promise<void> {
    const lastBlock = this.lastCommittedBlock;
    if (!lastBlock || !isHighSurrogate(lastBlock.charCodeAt(lastBlock.length - 1))) return;

    // block 容量按 UTF-16 单位计量，合法 emoji 可能刚好跨 block。失败 block 不可见时，
    // 前一个 block 的高代理项也必须回退，否则 reader 会拿到结构损坏的“完整前缀”。
    const repairedBlock = lastBlock.slice(0, -1);
    if (repairedBlock.length === 0) {
      throw new Error('[ToolOutputStore] 已提交 block 无法形成合法 UTF-16 前缀');
    }
    const repairedBodyBytes = Buffer.from(repairedBlock, TOOL_OUTPUT_BODY_ENCODING);
    const repairedIndexBytes = encodeToolOutputBlockIndexRecord({
      newlinesBefore: this.newlineCount - countNewlines(lastBlock),
      charCount: repairedBlock.length,
      newlineCount: countNewlines(repairedBlock),
      bodySha256: createHash('sha256').update(repairedBodyBytes).digest('hex'),
    });
    this.bodyCharCount -= 1;
    this.bodyByteCount -= 2;
    this.lastCommittedBlock = repairedBlock;
    await this.bodyFile.truncate(this.bodyByteCount);
    await writeFully(
      this.indexFile,
      repairedIndexBytes,
      this.indexByteCount - TOOL_OUTPUT_INDEX_RECORD_BYTES,
    );
  }

  private createManifest(input: {
    readonly bodySha256: string;
    readonly indexSha256: string;
  }): ToolOutputBlobManifest {
    return ToolOutputBlobManifestSchema.parse({
      ...this.source,
      format_version: TOOL_OUTPUT_BLOB_FORMAT_VERSION,
      body: {
        file_name: TOOL_OUTPUT_BODY_FILE_NAME,
        encoding: TOOL_OUTPUT_BODY_ENCODING,
        char_count: this.bodyCharCount,
        byte_count: this.bodyByteCount,
        newline_count: this.newlineCount,
        line_count: this.newlineCount + 1,
        sha256: input.bodySha256,
        block_char_capacity: TOOL_OUTPUT_BLOCK_CHAR_CAPACITY,
        block_count: this.blockCount,
      },
      index: {
        file_name: TOOL_OUTPUT_INDEX_FILE_NAME,
        record_bytes: TOOL_OUTPUT_INDEX_RECORD_BYTES,
        byte_count: this.indexByteCount,
        sha256: input.indexSha256,
      },
    });
  }

  private async publish(manifest: ToolOutputBlobManifest): Promise<ToolOutputTextBlobSaveResult> {
    const blobId = computeToolOutputBlobId(manifest);
    const finalDirectory = path.join(this.blobsDirectory, blobId);
    const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    if (manifestBytes.byteLength > TOOL_OUTPUT_MANIFEST_MAX_BYTES) {
      throw new Error('[ToolOutputStore] manifest 超出固定上限');
    }
    const stagingManifestPath = path.join(this.stagingDirectory, TOOL_OUTPUT_MANIFEST_FILE_NAME);
    const manifestFile = await fsp.open(stagingManifestPath, 'wx');
    try {
      await writeFully(manifestFile, manifestBytes, 0);
      await manifestFile.sync();
    } finally {
      await manifestFile.close();
    }

    await ensureFinalDirectory(finalDirectory);
    await publishFileWithoutReplacement({
      stagingPath: path.join(this.stagingDirectory, TOOL_OUTPUT_BODY_FILE_NAME),
      finalPath: path.join(finalDirectory, TOOL_OUTPUT_BODY_FILE_NAME),
      expectedBytes: manifest.body.byte_count,
      expectedSha256: manifest.body.sha256,
    });
    await publishFileWithoutReplacement({
      stagingPath: path.join(this.stagingDirectory, TOOL_OUTPUT_INDEX_FILE_NAME),
      finalPath: path.join(finalDirectory, TOOL_OUTPUT_INDEX_FILE_NAME),
      expectedBytes: manifest.index.byte_count,
      expectedSha256: manifest.index.sha256,
    });
    const manifestSha256 = createHash('sha256').update(manifestBytes).digest('hex');
    const finalManifestPath = path.join(finalDirectory, TOOL_OUTPUT_MANIFEST_FILE_NAME);
    // manifest 永远最后发布；reader 因此不会观察到正文或索引半成品。
    await publishFileWithoutReplacement({
      stagingPath: stagingManifestPath,
      finalPath: finalManifestPath,
      expectedBytes: manifestBytes.byteLength,
      expectedSha256: manifestSha256,
    });
    let stagingCleanup: ToolOutputTextBlobSaveResult['stagingCleanup'] = 'complete';
    try {
      await fsp.rm(this.stagingDirectory, { recursive: true });
    } catch {
      // manifest 已经是可读事实；次生 staging 清理失败由启动维护收口，不能让调用方误判正文未保存。
      stagingCleanup = 'pending';
    }
    return { blobId, filePath: finalManifestPath, stagingCleanup };
  }

  private async closeHandles(): Promise<void> {
    if (this.closeFailure !== undefined) throw this.closeFailure;
    const failures: unknown[] = [];
    if (!this.bodyClosed) {
      this.bodyClosed = true;
      await this.bodyFile.close().catch((error: unknown) => failures.push(error));
    }
    if (!this.indexClosed) {
      this.indexClosed = true;
      await this.indexFile.close().catch((error: unknown) => failures.push(error));
    }
    if (failures.length > 0) {
      this.closeFailure = failures[0];
      throw this.closeFailure;
    }
  }

  private async abortOnce(): Promise<void> {
    if (this.finalizePromise) {
      await this.finalizePromise.catch(() => undefined);
    }
    if (this.committedPrefixPromise) {
      const prefix = await this.committedPrefixPromise.catch(() => undefined);
      if (prefix?.status === 'published') return;
    }
    // close 失败时保留 staging；macOS 可删除打开文件而 Windows 通常拒绝，不能让两端事实分叉。
    await this.closeHandles();
    await fsp.rm(this.stagingDirectory, { recursive: true, force: true });
  }
}

export async function createToolOutputTextBlobWriter(
  input: {
    readonly blobsDirectory: string;
    readonly source: ToolOutputBlobSource;
  },
  dependencies: ToolOutputTextBlobWriterDependencies = DEFAULT_DEPENDENCIES,
): Promise<ToolOutputTextBlobWriter> {
  if (!path.isAbsolute(input.blobsDirectory)) {
    throw new Error('[ToolOutputStore] blobsDirectory 必须是绝对路径');
  }
  const source = ToolOutputBlobSourceSchema.parse(input.source);
  await fsp.mkdir(input.blobsDirectory, { recursive: true });
  const stagingDirectory = path.join(
    input.blobsDirectory,
    `.pending-${process.pid}-${randomUUID()}`,
  );
  await fsp.mkdir(stagingDirectory);
  let bodyFile: ToolOutputTextBlobWritableFile | undefined;
  let indexFile: ToolOutputTextBlobWritableFile | undefined;
  try {
    bodyFile = await dependencies.openStagingFile(
      path.join(stagingDirectory, TOOL_OUTPUT_BODY_FILE_NAME),
    );
    indexFile = await dependencies.openStagingFile(
      path.join(stagingDirectory, TOOL_OUTPUT_INDEX_FILE_NAME),
    );
    return new FileToolOutputTextBlobWriter(
      path.resolve(input.blobsDirectory),
      stagingDirectory,
      source,
      bodyFile,
      indexFile,
    );
  } catch (error: unknown) {
    await Promise.allSettled([bodyFile?.close(), indexFile?.close()]);
    await fsp.rm(stagingDirectory, { recursive: true, force: true });
    throw error;
  }
}
