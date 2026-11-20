import { Router, type Request } from 'express';
import busboy from 'busboy';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { getRegisteredBackendPluginUploadChannel } from '../../app-hosts/linnya/plugin-registry/builtin';
import {
  createBackendPluginUploadEvent,
  invokeBackendPluginIpcHandler,
} from '../../plugin-sdk/backend/pluginIpcRuntime';
import { pathManager } from '../../shared/utils/pathManager';
import { Logger } from '../../shared/logger';
import { z } from 'zod';
import { UserFacingMessageSchema } from '@app/schemas';
import {
  createPluginFileStage,
  PLUGIN_INPUT_MAX_BYTES,
} from '../../app-hosts/linnya/adapters/plugin-file-input';

const logger = new Logger('PluginMultipartUpload');
const UploadResult = z.discriminatedUnion('success', [
  z.object({ success: z.literal(true), data: z.unknown() }),
  z.object({ success: z.literal(false), error: z.string(), userMessage: UserFacingMessageSchema.optional() }),
]);

/** 完整 multipart 结束后才返回，保证 file 后面的模型字段也已接收。 */
async function receiveFile(req: Request, filePath: string, signal: AbortSignal) {
  const parser = busboy({
    headers: req.headers,
    defParamCharset: 'utf8',
    limits: {
      fileSize: PLUGIN_INPUT_MAX_BYTES,
      files: 1,
      fields: 32,
      fieldSize: 64 * 1024,
    },
  });
  const fields = new Map<string, string>();
  const writes: Promise<void>[] = [];
  let file: { path: string; name: string; size: number } | undefined;
  let invalid: Error | undefined;
  parser.on('file', (_field, stream, info) => {
    const received = { path: filePath, name: info.filename, size: 0 };
    file = received;
    stream.on('data', (bytes: Buffer) => {
      received.size += bytes.length;
    });
    stream.on('limit', () => {
      invalid = new Error('文件超过 50 MiB 上传限制');
    });
    // pipeline 提供磁盘背压；不能一边读取一边无界 write() 缓存。
    writes.push(
      pipeline(stream, createWriteStream(filePath, { flags: 'wx' }), { signal }).catch(error => {
        invalid = error instanceof Error ? error : new Error(String(error));
        parser.destroy(invalid);
      })
    );
  });
  parser.on('field', (name, value, info) => {
    if (info.valueTruncated || info.nameTruncated) invalid = new Error('上传字段超过限制');
    fields.set(name, value);
  });
  parser.on('filesLimit', () => {
    invalid = new Error('每次只能上传一个文件');
  });
  parser.on('fieldsLimit', () => {
    invalid = new Error('上传字段过多');
  });
  try {
    await pipeline(req, parser, { signal });
    await Promise.all(writes);
    signal.throwIfAborted();
    if (invalid) throw invalid;
    if (!file) throw new Error('未找到上传的文件');
    return { file, fields: Object.fromEntries(fields) };
  } finally {
    await Promise.all(writes);
  }
}

/** 固定单文件上传面，不允许插件注册任意 HTTP 路由。 */
export function createPluginMultipartUploadRouter(): Router {
  const router = Router();
  router.post('/:pluginId/documents/upload', async (req, res) => {
    const pluginId = req.params.pluginId;
    const channel = getRegisteredBackendPluginUploadChannel(pluginId);
    if (!channel) {
      res.status(404).json({ error: '插件上传能力未启用' });
      return;
    }
    const controller = new AbortController();
    const abort = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.once('close', abort);
    const directory = path.join(pathManager.getUploadsPath(), 'temp');
    let staged: Awaited<ReturnType<typeof createPluginFileStage>> | undefined;
    try {
      const stage = await createPluginFileStage(directory);
      staged = stage;
      const received = await receiveFile(req, stage.filePath, controller.signal);
      if (getRegisteredBackendPluginUploadChannel(pluginId) !== channel)
        throw new Error('插件已停用，请重新启用后再上传');
      const event = createBackendPluginUploadEvent({
        file: received.file,
        signal: controller.signal,
        acceptFile: stage.acceptFile,
      });
      const result = UploadResult.parse(
        await invokeBackendPluginIpcHandler(pluginId, channel, event, received.fields)
      );
      if (!result.success) {
        if (!result.userMessage) throw new Error(result.error);
        logger.warn('插件拒绝上传', { pluginId, error: result.error });
        const { key, params, fallback } = result.userMessage;
        if (!res.destroyed) res.status(400).json({ error: 'Plugin upload was rejected', userMessage: { key, params, fallback } });
        return;
      }
      res.status(201).json(result.data);
    } catch (error) {
      logger.warn('插件上传未完成', { pluginId, accepted: staged?.accepted ?? false, error });
      if (!res.destroyed)
        res.status(400).json({ error: error instanceof Error ? error.message : '上传失败' });
    } finally {
      res.off('close', abort);
      await staged?.dispose().catch(error => {
        logger.error('删除未接纳的临时上传失败', { pluginId, error });
      });
    }
  });
  return router;
}
