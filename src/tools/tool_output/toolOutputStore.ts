/**
 * ToolOutputStore 对外门面。
 *
 * 这里保留既有一次性保存与 observation 截断 API；磁盘写入、原子发布和窗口读取分别
 * 下沉到 orchestration，避免 Shell 接入后在一个文件里复制第二套生命周期。
 */

import type { ToolExecutionContext } from '@linnlabs/linnkit/runtime-kernel';
import type { ObservationPreviewMeta } from '@linnlabs/linnkit/runtime-kernel';
import { ToolCallIdSchema, TurnIdSchema } from '@linnlabs/linnkit/contracts';
import type { ToolOutputBlobId } from '@app/schemas';

import {
  requireToolConversationScope,
  type ToolConversationScopeContext,
} from 'src/app-hosts/linnya/adapters/tools/conversation-scope';
import { pathManager } from '../../shared/utils/pathManager';
import {
  ToolOutputBlobSourceNameSchema,
  ToolOutputBlobSourceSchema,
  ToolOutputStoreCleanupError,
  ToolOutputBlobUiMetaSchema,
  type ToolOutputTextBlobSaveResult,
  type ToolOutputTextBlobWriter,
} from './definitions/toolOutputBlob';
import type { ToolOutputReadArgs } from './definitions/toolOutputRead';
import type { ToolOutputTextWindow } from './functions/sliceToolOutputWindow';
import { createToolOutputTextBlobWriter } from './orchestration/createToolOutputTextBlobWriter';
import { readToolOutputTextWindow } from './orchestration/readToolOutputTextWindow';
import { buildToolOutputPreview } from './functions/buildToolOutputPreview';

type ToolOutputContext = ToolExecutionContext & ToolConversationScopeContext;

function createBlobSource(params: {
  readonly context: ToolOutputContext;
  readonly toolName: string;
  readonly meta?: ObservationPreviewMeta;
}) {
  const toolName = ToolOutputBlobSourceNameSchema.parse(params.toolName);
  const { conversationId, instanceId } = requireToolConversationScope({
    context: params.context,
    errorPrefix: '[ToolOutputStore]',
  });
  const turnId = params.context.turnId === undefined
    ? undefined
    : TurnIdSchema.parse(params.context.turnId);
  const toolCallId = params.context.parentToolCallId === undefined
    ? undefined
    : ToolCallIdSchema.parse(params.context.parentToolCallId);
  const meta = params.meta === undefined
    ? undefined
    : ToolOutputBlobUiMetaSchema.parse(params.meta);
  return ToolOutputBlobSourceSchema.parse({
    kind: 'tool_output_text',
    conversation_id: conversationId,
    instance_id: instanceId,
    tool_name: toolName,
    ...(turnId ? { turn_id: turnId } : {}),
    ...(toolCallId ? { tool_call_id: toolCallId } : {}),
    ...(meta ? { meta } : {}),
  });
}

export async function openToolOutputTextBlobWriter(params: {
  readonly context: ToolOutputContext;
  readonly toolName: string;
  readonly meta?: ObservationPreviewMeta;
}): Promise<ToolOutputTextBlobWriter> {
  const source = createBlobSource(params);
  return createToolOutputTextBlobWriter({
    blobsDirectory: pathManager.getConversationToolOutputBlobsPath({
      conversationId: source.conversation_id,
      instanceId: source.instance_id,
    }),
    source,
  });
}

/** 兼容普通工具的一次性保存；内部统一走同一个流式 writer。 */
export async function saveToolOutputTextBlob(params: {
  readonly context: ToolOutputContext;
  readonly toolName: string;
  readonly text: string;
  readonly meta?: ObservationPreviewMeta;
}): Promise<ToolOutputTextBlobSaveResult> {
  const writer = await openToolOutputTextBlobWriter(params);
  try {
    await writer.append(params.text);
    return await writer.finalize();
  } catch (error: unknown) {
    try {
      await writer.abort();
    } catch (cleanupError: unknown) {
      throw new ToolOutputStoreCleanupError(
        '[ToolOutputStore] 保存失败且 staging 未能清理',
        error,
        cleanupError,
      );
    }
    throw error;
  }
}

export async function readToolOutputTextWindowByContext(params: {
  readonly context: ToolOutputContext;
  readonly blobId: ToolOutputBlobId | string;
  readonly args: Pick<ToolOutputReadArgs, 'offset' | 'limit'>;
}): Promise<ToolOutputTextWindow> {
  const { conversationId, instanceId } = requireToolConversationScope({
    context: params.context,
    errorPrefix: '[ToolOutputStore]',
  });
  const blobDirectory = pathManager.getConversationToolOutputBlobDirPath({
    conversationId,
    instanceId,
    blobId: params.blobId,
  });
  return readToolOutputTextWindow({
    blobDirectory,
    blobId: params.blobId,
    conversationId,
    instanceId,
    args: params.args,
  });
}

export type TruncatePreviewResult =
  | { truncated: false; preview: string }
  | {
      truncated: true;
      preview: string;
      blob_id: string;
      originalChars: number;
      previewChars: number;
      originalLines: number;
      previewLines: number;
    };

function countLines(text: string): number {
  let lines = 1;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 0x0a) lines += 1;
  }
  return lines;
}

export async function truncateObservationToPreview(params: {
  context: ToolOutputContext;
  toolName: string;
  text: string;
  maxChars: number;
  maxLines: number;
  meta?: ObservationPreviewMeta;
}): Promise<TruncatePreviewResult> {
  const raw = String(params.text ?? '');
  if (!raw.trim()) return { truncated: false, preview: raw };

  const originalLines = countLines(raw);
  const overByLines = originalLines > params.maxLines;
  const overByChars = raw.length > params.maxChars;
  if (!overByLines && !overByChars) {
    return { truncated: false, preview: raw };
  }

  const { blobId } = await saveToolOutputTextBlob({
    context: params.context,
    toolName: params.toolName,
    text: raw,
    meta: params.meta,
  });

  const preview = buildToolOutputPreview({
    blobId,
    text: raw,
    maxChars: params.maxChars,
    maxLines: params.maxLines,
  });

  return {
    truncated: true,
    preview,
    blob_id: blobId,
    originalChars: raw.length,
    previewChars: preview.length,
    originalLines,
    previewLines: preview.split('\n').length,
  };
}
