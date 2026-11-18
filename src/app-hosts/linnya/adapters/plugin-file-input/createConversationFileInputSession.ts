import { createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parseFileLocator } from '@app/schemas';
import type { ConversationWorkDirectoryAdmissionPort } from '../../application/conversation-lifecycle';
import type { PluginCliConversationInputSession } from '../../application/plugin-cli-shell-bridge';
import { PhysicalFileReadError } from '../../application/file-read';
import { inspectNodePhysicalRegularFile } from '../file-read';
import { createPluginFileStage, PLUGIN_INPUT_MAX_BYTES } from './createPluginFileStage';

/** 会话 admission 覆盖整个复制，删除会话不能在检查路径后抢走正在读取的原件。 */
export function createConversationFileInputSession(input: {
  readonly conversationId: string;
  readonly admission: ConversationWorkDirectoryAdmissionPort;
  readonly temporaryDirectory: string;
  readonly signal: AbortSignal;
}): PluginCliConversationInputSession {
  const stages = new Set<Awaited<ReturnType<typeof createPluginFileStage>>>();
  return {
    async stage(locator) {
      input.signal.throwIfAborted();
      const parsed = parseFileLocator(locator);
      if (parsed.kind !== 'conversation') {
        throw new PhysicalFileReadError(
          'READ_FILE_LOCATOR_INVALID',
          '导入只接受当前会话的 conversation:/ 文件。'
        );
      }
      return input.admission.withAdmission(
        { conversationId: input.conversationId },
        async directory => {
          input.signal.throwIfAborted();
          const source = await inspectNodePhysicalRegularFile({
            absolutePath: path.join(directory.absolutePath, parsed.relativePath),
            scope: { kind: 'conversation', rootPath: directory.absolutePath },
          });
          const tooLarge = () =>
            new PhysicalFileReadError('READ_FILE_FILE_TOO_LARGE', '文件超过 50 MiB 导入限制。');
          if (source.byteLength > PLUGIN_INPUT_MAX_BYTES) throw tooLarge();
          const staged = await createPluginFileStage(input.temporaryDirectory);
          stages.add(staged);
          let size = 0;
          try {
            // 复制时继续限制实际字节，保持与上传一致；不把整份资料放进内存或 CLI JSON。
            const bounded = new Transform({
              transform(chunk: Buffer, _encoding, callback) {
                size += chunk.byteLength;
                callback(size > PLUGIN_INPUT_MAX_BYTES ? tooLarge() : null, chunk);
              },
            });
            await pipeline(
              createReadStream(source.resolvedPath),
              bounded,
              createWriteStream(staged.filePath, { flags: 'wx' }),
              { signal: input.signal }
            );
            input.signal.throwIfAborted();
            return {
              file: { path: staged.filePath, name: source.fileName, size },
              acceptFile: staged.acceptFile,
            };
          } catch (error) {
            await staged.dispose();
            stages.delete(staged);
            throw error;
          }
        }
      );
    },
    async close() {
      await Promise.all([...stages].map(stage => stage.dispose()));
      stages.clear();
    },
  };
}
