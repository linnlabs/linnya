import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  CONVERSATION_CONTROL_SCHEMA_VERSION,
  type ConversationAttachmentRef,
  type ConversationUiMessage,
  type ConversationControlToolsRequest,
} from '@app/schemas';
import {
  LinnyaCliError,
  type ConversationControlClient,
} from '../definitions/cli';
import { toolCallSucceeded } from '../functions/toolCallOutcome';
import { watchConversationStatus } from './watchConversationStatus';

interface ExecuteToolCallOptions {
  readonly client: ConversationControlClient;
  readonly request: Extract<ConversationControlToolsRequest, { action: 'call' }>;
  readonly intervalMs: number;
  readonly timeoutMs: number;
  readonly now?: () => number;
  readonly sleep?: (durationMs: number) => Promise<void>;
  /** 把工具结果图片写成本地文件并返回路径；默认写到系统临时目录。 */
  readonly saveAttachment?: SaveToolAttachment;
}

export type SaveToolAttachment = (input: {
  readonly conversationId: string;
  readonly attachment: ConversationAttachmentRef;
  readonly bytes: Uint8Array;
}) => Promise<string>;

export interface ToolAttachmentFile {
  readonly id: string;
  readonly media_type: ConversationAttachmentRef['mediaType'];
  readonly width: number;
  readonly height: number;
  readonly path: string;
}

const ATTACHMENT_EXTENSIONS: Record<ConversationAttachmentRef['mediaType'], string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** 同一内容写同一文件名；目录与文件只对当前用户可读。 */
const saveAttachmentToTemp: SaveToolAttachment = async ({ conversationId, attachment, bytes }) => {
  const directory = path.join(os.tmpdir(), 'linnya-cli', 'attachments', conversationId);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const filePath = path.join(directory, `${attachment.sha256}.${ATTACHMENT_EXTENSIONS[attachment.mediaType]}`);
  await writeFile(filePath, bytes, { mode: 0o600 });
  return filePath;
};

/**
 * CLI 不运行模型，工具结果里的图片由调用方自己查看：逐个读取已复核的原件写成本地文件，
 * 输出里给出路径。
 */
async function saveToolAttachments(input: {
  readonly client: ConversationControlClient;
  readonly conversationId: string;
  readonly message: Extract<ConversationUiMessage, { message_type: 'tool_calls' }>;
  readonly save: SaveToolAttachment;
}): Promise<readonly ToolAttachmentFile[]> {
  const files: ToolAttachmentFile[] = [];
  for (const attachment of input.message.attachments ?? []) {
    const response = await input.client.execute({
      schema_version: CONVERSATION_CONTROL_SCHEMA_VERSION,
      command: 'tools',
      action: 'read_attachment',
      conversation_id: input.conversationId,
      message_id: input.message.message_id,
      attachment_id: attachment.id,
    });
    if (response.command !== 'tools' || response.action !== 'read_attachment') {
      throw new LinnyaCliError('protocol_incompatible', 'Attachment read returned another response type', false, 'tools');
    }
    const filePath = await input.save({
      conversationId: input.conversationId,
      attachment: response.attachment,
      bytes: Buffer.from(response.content_base64, 'base64'),
    });
    files.push({
      id: attachment.id,
      media_type: response.attachment.mediaType,
      width: response.attachment.width,
      height: response.attachment.height,
      path: filePath,
    });
  }
  return files;
}

/**
 * CLI 的同步体验只负责等待 Host 已接纳的 detached run；工具执行本身仍完全归 ToolNode。
 * terminal 与 UI projection 是两个独立 durable owner，因此终态后还需短暂等待工具卡投影完成。
 */
export async function executeToolCall(options: ExecuteToolCallOptions) {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? (durationMs => new Promise(resolve => setTimeout(resolve, durationMs)));
  const startedAt = now();
  const accepted = await options.client.execute(options.request);
  if (accepted.command !== 'tools' || accepted.action !== 'call') {
    throw new LinnyaCliError(
      'protocol_incompatible',
      'Tool call returned another response type',
      false,
      'tools',
    );
  }

  const terminal = await watchConversationStatus({
    client: options.client,
    request: {
      schema_version: CONVERSATION_CONTROL_SCHEMA_VERSION,
      command: 'status',
      conversation_id: accepted.receipt.conversation_id,
      expected_run_id: accepted.receipt.run_id,
    },
    intervalMs: options.intervalMs,
    timeoutMs: options.timeoutMs,
    writeFrame: () => undefined,
    now,
    sleep,
  });
  if (!terminal || terminal.status !== 'completed') {
    throw new LinnyaCliError(
      'internal_error',
      terminal?.error?.message ?? `Tool run ended as ${terminal?.status ?? 'missing'}`,
      false,
      'tools',
    );
  }

  while (true) {
    const response = await options.client.execute({
      schema_version: CONVERSATION_CONTROL_SCHEMA_VERSION,
      command: 'messages',
      conversation_id: accepted.receipt.conversation_id,
      window: 'tail',
      limit: 200,
    });
    if (response.command !== 'messages') {
      throw new LinnyaCliError(
        'protocol_incompatible',
        'Tool result query returned another response type',
        false,
        'tools',
      );
    }
    if (response.status === 'ready') {
      const matches = response.messages.filter(
        (message): message is Extract<ConversationUiMessage, { message_type: 'tool_calls' }> => (
          message.run_id === accepted.receipt.run_id
          && message.message_type === 'tool_calls'
          && message.payload.tool_name === accepted.tool_name
          && message.payload.status !== 'loading'
        ),
      );
      if (matches.length === 1 && matches[0]) {
        const attachmentFiles = await saveToolAttachments({
          client: options.client,
          conversationId: accepted.receipt.conversation_id,
          message: matches[0],
          save: options.saveAttachment ?? saveAttachmentToTemp,
        });
        return {
          schema_version: CONVERSATION_CONTROL_SCHEMA_VERSION,
          ok: toolCallSucceeded(matches[0]),
          command: 'tools' as const,
          action: 'call' as const,
          conversation_id: accepted.receipt.conversation_id,
          run_id: accepted.receipt.run_id,
          tool: matches[0],
          ...(attachmentFiles.length > 0 ? { attachment_files: attachmentFiles } : {}),
        };
      }
      if (matches.length > 1) {
        throw new LinnyaCliError(
          'internal_error',
          `Tool run ${accepted.receipt.run_id} produced multiple terminal tool results`,
          false,
          'tools',
        );
      }
    }
    if (now() - startedAt >= options.timeoutMs) {
      throw new LinnyaCliError(
        'result_unavailable',
        `Tool result projection timed out after ${options.timeoutMs}ms`,
        true,
        'tools',
      );
    }
    await sleep(options.intervalMs);
  }
}
