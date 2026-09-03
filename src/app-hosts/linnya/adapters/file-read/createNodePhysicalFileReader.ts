import { promises as fsp } from 'node:fs';
import path from 'node:path';

import { CONVERSATION_IMAGE_MAX_BYTES } from '@app/schemas';
import {
  PHYSICAL_TEXT_FILE_MAX_BYTES,
  PhysicalFileReadError,
  classifyUnsupportedPhysicalFile,
  decodePhysicalFileText,
  type PhysicalFileReaderPort,
  type PhysicalFileReadResult,
  type PhysicalFileReadScope,
} from 'src/app-hosts/linnya/application/file-read';
import { detectSupportedImageMediaType } from 'src/shared/media/image-inspection';
import {
  inspectNodePhysicalRegularFile,
  projectNodePhysicalFileError,
} from './resolveNodePhysicalFileSource';

const CLASSIFICATION_HEADER_BYTES = 512;

async function readHeader(
  handle: Awaited<ReturnType<typeof fsp.open>>,
  byteLength: number,
): Promise<Buffer> {
  const header = Buffer.alloc(Math.min(CLASSIFICATION_HEADER_BYTES, byteLength));
  let offset = 0;
  while (offset < header.length) {
    const read = await handle.read(header, offset, header.length - offset, offset);
    if (read.bytesRead === 0) break;
    offset += read.bytesRead;
  }
  return header.subarray(0, offset);
}

async function readBounded(
  handle: Awaited<ReturnType<typeof fsp.open>>,
  maxBytes: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let offset = 0;
  while (offset <= maxBytes) {
    const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes + 1 - offset));
    const read = await handle.read(chunk, 0, chunk.length, offset);
    if (read.bytesRead === 0) break;
    chunks.push(chunk.subarray(0, read.bytesRead));
    offset += read.bytesRead;
  }
  if (offset > maxBytes) {
    throw new PhysicalFileReadError(
      'READ_FILE_FILE_TOO_LARGE',
      `物理文本文件超过 read_file 的 ${maxBytes} 字节上限。`,
      { maxBytes },
    );
  }
  return Buffer.concat(chunks, offset);
}

/**
 * Node 宿主 adapter。host scope 遵循 OS symlink 语义并返回 resolved target；
 * conversation scope 额外执行工作目录 containment，且必须在 lifecycle admission 内调用。
 */
export function createNodePhysicalFileReader(): PhysicalFileReaderPort {
  return Object.freeze({
    async readFile(input: {
      readonly absolutePath: string;
      readonly scope: PhysicalFileReadScope;
    }): Promise<PhysicalFileReadResult> {
      // 必须在 open 前拒绝 FIFO、socket 和设备文件，否则打开命名管道可能永久等待 writer。
      const inspected = await inspectNodePhysicalRegularFile(input);
      const resolvedPath = inspected.resolvedPath;
      let handle: Awaited<ReturnType<typeof fsp.open>>;
      try {
        handle = await fsp.open(resolvedPath, 'r');
      } catch (error: unknown) {
        projectNodePhysicalFileError(error, 'open');
      }

      try {
        let stat;
        try {
          stat = await handle.stat();
        } catch (error: unknown) {
          projectNodePhysicalFileError(error, 'fstat');
        }
        if (!stat.isFile()) {
          throw new PhysicalFileReadError(
            'READ_FILE_NOT_REGULAR_FILE',
            'read_file 只读取普通文件，目录、FIFO、socket 和设备文件均不支持。',
          );
        }

        const header = await readHeader(handle, stat.size);
        const imageMediaType = detectSupportedImageMediaType(header);
        const fileName = path.basename(input.absolutePath);
        if (imageMediaType) {
          if (stat.size > CONVERSATION_IMAGE_MAX_BYTES) {
            throw new PhysicalFileReadError(
              'READ_FILE_FILE_TOO_LARGE',
              `图片超过 read_file 的 ${CONVERSATION_IMAGE_MAX_BYTES} 字节上限。`,
              { actualBytes: stat.size, maxBytes: CONVERSATION_IMAGE_MAX_BYTES },
            );
          }
          return Object.freeze({
            kind: 'image_source' as const,
            resolvedPath,
            fileName,
            detectedMediaType: imageMediaType,
            byteLength: stat.size,
          });
        }

        if (stat.size > PHYSICAL_TEXT_FILE_MAX_BYTES) {
          throw new PhysicalFileReadError(
            'READ_FILE_FILE_TOO_LARGE',
            `物理文本文件超过 read_file 的 ${PHYSICAL_TEXT_FILE_MAX_BYTES} 字节上限。`,
            { actualBytes: stat.size, maxBytes: PHYSICAL_TEXT_FILE_MAX_BYTES },
          );
        }
        const unsupported = classifyUnsupportedPhysicalFile(header);
        if (unsupported) {
          throw new PhysicalFileReadError(
            'READ_FILE_UNSUPPORTED_FORMAT',
            `read_file 不直接读取该二进制格式：${unsupported}；请先用 Shell/CLI 转换。`,
            { format: unsupported },
          );
        }

        const bytes = await readBounded(handle, PHYSICAL_TEXT_FILE_MAX_BYTES);
        const decoded = decodePhysicalFileText({
          bytes,
          fileName,
        });
        return Object.freeze({
          kind: 'text' as const,
          resolvedPath,
          fileName,
          contentType: decoded.contentType,
          byteLength: bytes.length,
          text: decoded.text,
        });
      } catch (error: unknown) {
        if (error instanceof PhysicalFileReadError) throw error;
        projectNodePhysicalFileError(error, 'read');
      } finally {
        await handle.close();
      }
    },
  });
}
