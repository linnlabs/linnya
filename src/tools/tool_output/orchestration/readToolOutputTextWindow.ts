import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';

import { parseToolOutputBlobId } from '@app/schemas';
import {
  TOOL_OUTPUT_BLOCK_CHAR_CAPACITY,
  TOOL_OUTPUT_BODY_FILE_NAME,
  TOOL_OUTPUT_INDEX_FILE_NAME,
  TOOL_OUTPUT_INDEX_RECORD_BYTES,
  TOOL_OUTPUT_MANIFEST_FILE_NAME,
  TOOL_OUTPUT_MANIFEST_MAX_BYTES,
  ToolOutputBlobManifestSchema,
  type ToolOutputBlobManifest,
} from '../definitions/toolOutputBlob';
import type { ToolOutputReadArgs } from '../definitions/toolOutputRead';
import { computeToolOutputBlobId } from '../functions/computeToolOutputBlobId';
import {
  decodeToolOutputBlockIndexRecord,
  type ToolOutputBlockIndexRecord,
} from '../functions/toolOutputBlockIndex';
import {
  sliceToolOutputWindowCandidate,
  type ToolOutputTextWindow,
} from '../functions/sliceToolOutputWindow';

interface VerifiedBlock {
  readonly blockIndex: number;
  readonly startOffset: number;
  readonly record: ToolOutputBlockIndexRecord;
  readonly text: string;
}

function countNewlines(text: string): number {
  let count = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 0x0a) count += 1;
  }
  return count;
}

function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xd800 && codeUnit <= 0xdbff;
}

function isLowSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xdc00 && codeUnit <= 0xdfff;
}

async function readExact(
  file: FileHandle,
  byteLength: number,
  position: number,
): Promise<Buffer> {
  const buffer = Buffer.allocUnsafe(byteLength);
  let read = 0;
  while (read < byteLength) {
    const result = await file.read(buffer, read, byteLength - read, position + read);
    if (result.bytesRead <= 0) {
      throw new Error('[ToolOutputStore] 文件在预期位置前结束');
    }
    read += result.bytesRead;
  }
  return buffer;
}

async function readManifest(input: {
  readonly blobDirectory: string;
  readonly blobId: string;
}): Promise<ToolOutputBlobManifest> {
  const manifestPath = path.join(input.blobDirectory, TOOL_OUTPUT_MANIFEST_FILE_NAME);
  const stat = await fsp.lstat(manifestPath);
  if (
    !stat.isFile()
    || stat.isSymbolicLink()
    || stat.size <= 0
    || stat.size > TOOL_OUTPUT_MANIFEST_MAX_BYTES
  ) {
    throw new Error('[ToolOutputStore] manifest 文件形状非法');
  }
  const raw: unknown = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
  const manifest = ToolOutputBlobManifestSchema.parse(raw);
  if (computeToolOutputBlobId(manifest) !== input.blobId) {
    throw new Error(`[ToolOutputStore] blob 内容与 blob_id 不一致: blob=${input.blobId}`);
  }
  validateManifestMetrics(manifest);
  return manifest;
}

function validateManifestMetrics(manifest: ToolOutputBlobManifest): void {
  const expectedBlocks = Math.ceil(
    manifest.body.char_count / TOOL_OUTPUT_BLOCK_CHAR_CAPACITY,
  );
  if (
    manifest.body.byte_count !== manifest.body.char_count * 2
    || manifest.body.line_count !== manifest.body.newline_count + 1
    || manifest.body.block_count !== expectedBlocks
    || manifest.index.byte_count !== expectedBlocks * TOOL_OUTPUT_INDEX_RECORD_BYTES
  ) {
    throw new Error('[ToolOutputStore] manifest 正文计量不一致');
  }
}

async function inspectDataFile(filePath: string, expectedBytes: number): Promise<void> {
  const stat = await fsp.lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== expectedBytes) {
    throw new Error('[ToolOutputStore] 正文或索引文件形状非法');
  }
}

async function readIndexRecord(
  indexFile: FileHandle,
  blockIndex: number,
): Promise<ToolOutputBlockIndexRecord> {
  return decodeToolOutputBlockIndexRecord(await readExact(
    indexFile,
    TOOL_OUTPUT_INDEX_RECORD_BYTES,
    blockIndex * TOOL_OUTPUT_INDEX_RECORD_BYTES,
  ));
}

async function readVerifiedBlock(input: {
  readonly bodyFile: FileHandle;
  readonly indexFile: FileHandle;
  readonly manifest: ToolOutputBlobManifest;
  readonly blockIndex: number;
}): Promise<VerifiedBlock> {
  const startOffset = input.blockIndex * TOOL_OUTPUT_BLOCK_CHAR_CAPACITY;
  const expectedChars = Math.min(
    TOOL_OUTPUT_BLOCK_CHAR_CAPACITY,
    input.manifest.body.char_count - startOffset,
  );
  const record = await readIndexRecord(input.indexFile, input.blockIndex);
  if (record.charCount !== expectedChars) {
    throw new Error('[ToolOutputStore] block index 字符计量不一致');
  }
  if (input.blockIndex === 0 && record.newlinesBefore !== 0) {
    throw new Error('[ToolOutputStore] 首个 block 的行索引非法');
  }
  if (input.blockIndex > 0) {
    const previous = await readIndexRecord(input.indexFile, input.blockIndex - 1);
    if (previous.newlinesBefore + previous.newlineCount !== record.newlinesBefore) {
      throw new Error('[ToolOutputStore] block 行索引不连续');
    }
  }

  const bytes = await readExact(input.bodyFile, expectedChars * 2, startOffset * 2);
  if (createHash('sha256').update(bytes).digest('hex') !== record.bodySha256) {
    throw new Error('[ToolOutputStore] 正文 block 校验失败');
  }
  const text = bytes.toString('utf16le');
  if (text.length !== record.charCount || countNewlines(text) !== record.newlineCount) {
    throw new Error('[ToolOutputStore] 正文 block 行或字符计量不一致');
  }
  if (
    input.blockIndex === input.manifest.body.block_count - 1
    && record.newlinesBefore + record.newlineCount !== input.manifest.body.newline_count
  ) {
    throw new Error('[ToolOutputStore] 最后 block 与 manifest 行计量不一致');
  }
  return { blockIndex: input.blockIndex, startOffset, record, text };
}

function requireBlock(
  blocks: readonly VerifiedBlock[],
  blockIndex: number,
): VerifiedBlock {
  const block = blocks.find((candidate) => candidate.blockIndex === blockIndex);
  if (!block) throw new Error('[ToolOutputStore] reader 缺少已验证正文 block');
  return block;
}

/**
 * 只读取请求附近的固定 block；晚 offset 不会再从正文开头扫描，也不会把全文载入内存。
 */
export async function readToolOutputTextWindow(input: {
  readonly blobDirectory: string;
  readonly blobId: string;
  readonly conversationId: string;
  readonly instanceId: string;
  readonly args: Pick<ToolOutputReadArgs, 'offset' | 'limit'>;
}): Promise<ToolOutputTextWindow> {
  const blobId = parseToolOutputBlobId(input.blobId);
  const manifest = await readManifest({ blobDirectory: input.blobDirectory, blobId });
  if (
    manifest.conversation_id !== input.conversationId
    || manifest.instance_id !== input.instanceId
  ) {
    throw new Error(
      `[ToolOutputStore] blob 归属与读取上下文不一致: blob=${blobId}, `
      + `record=${manifest.conversation_id}/${manifest.instance_id}, `
      + `context=${input.conversationId}/${input.instanceId}`,
    );
  }
  if (input.args.offset >= manifest.body.char_count) {
    throw new Error(
      `[tool_output_read] offset=${input.args.offset} 超出正文范围`
      + `（total_chars=${manifest.body.char_count}）`,
    );
  }

  const bodyPath = path.join(input.blobDirectory, TOOL_OUTPUT_BODY_FILE_NAME);
  const indexPath = path.join(input.blobDirectory, TOOL_OUTPUT_INDEX_FILE_NAME);
  await Promise.all([
    inspectDataFile(bodyPath, manifest.body.byte_count),
    inspectDataFile(indexPath, manifest.index.byte_count),
  ]);
  const [bodyFile, indexFile] = await Promise.all([
    fsp.open(bodyPath, 'r'),
    fsp.open(indexPath, 'r'),
  ]);
  try {
    const verificationStart = Math.max(0, input.args.offset - 1);
    const candidateEnd = Math.min(
      manifest.body.char_count,
      input.args.offset + input.args.limit + 1,
    );
    const firstBlockIndex = Math.floor(
      verificationStart / TOOL_OUTPUT_BLOCK_CHAR_CAPACITY,
    );
    const lastBlockIndex = Math.floor(
      (candidateEnd - 1) / TOOL_OUTPUT_BLOCK_CHAR_CAPACITY,
    );
    const blocks: VerifiedBlock[] = [];
    for (let blockIndex = firstBlockIndex; blockIndex <= lastBlockIndex; blockIndex += 1) {
      blocks.push(await readVerifiedBlock({
        bodyFile,
        indexFile,
        manifest,
        blockIndex,
      }));
    }

    const offsetBlockIndex = Math.floor(
      input.args.offset / TOOL_OUTPUT_BLOCK_CHAR_CAPACITY,
    );
    const offsetBlock = requireBlock(blocks, offsetBlockIndex);
    const offsetWithinBlock = input.args.offset - offsetBlock.startOffset;
    if (
      input.args.offset > 0
      && isLowSurrogate(offsetBlock.text.charCodeAt(offsetWithinBlock))
    ) {
      const previousCodeUnit = offsetWithinBlock > 0
        ? offsetBlock.text.charCodeAt(offsetWithinBlock - 1)
        : requireBlock(blocks, offsetBlockIndex - 1).text.charCodeAt(
          requireBlock(blocks, offsetBlockIndex - 1).text.length - 1,
        );
      if (isHighSurrogate(previousCodeUnit)) {
        throw new Error(`[tool_output_read] offset=${input.args.offset} 位于 Unicode 字符中间`);
      }
    }

    const combinedStart = blocks[0]?.startOffset;
    if (combinedStart === undefined) {
      throw new Error('[ToolOutputStore] reader 未取得正文 block');
    }
    const combinedText = blocks.map((block) => block.text).join('');
    const localStart = input.args.offset - combinedStart;
    const localEnd = candidateEnd - combinedStart;
    const candidateText = combinedText.slice(localStart, localEnd);
    const startLine = offsetBlock.record.newlinesBefore
      + countNewlines(offsetBlock.text.slice(0, offsetWithinBlock))
      + 1;

    return sliceToolOutputWindowCandidate({
      text: candidateText,
      startOffset: input.args.offset,
      totalChars: manifest.body.char_count,
      startLine,
      totalLines: manifest.body.line_count,
    }, input.args);
  } finally {
    // Windows 清理依赖真实句柄关闭，不能只让 FileHandle 离开作用域。
    await Promise.all([bodyFile.close(), indexFile.close()]);
  }
}
