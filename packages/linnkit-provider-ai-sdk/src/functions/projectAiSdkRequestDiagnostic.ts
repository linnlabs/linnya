import { createHash } from 'node:crypto';
import type {
  CanonicalInferenceMessage,
  CanonicalInferenceRequest,
} from '@linnlabs/linnkit/ports';

export interface AiSdkRequestDiagnosticSummary {
  readonly request_fingerprint: string;
  readonly message_count: number;
  readonly message_roles: Readonly<{
    readonly system: number;
    readonly user: number;
    readonly assistant: number;
    readonly tool: number;
  }>;
  readonly image_message_roles: Readonly<{
    readonly system: number;
    readonly user: number;
    readonly assistant: number;
    readonly tool: number;
  }>;
  readonly tool_count: number;
  readonly text_characters: number;
  readonly estimated_input_tokens: number;
  readonly image_count: number;
  readonly image_bytes: number;
  readonly image_media_types: readonly string[];
}

interface RequestShape {
  readonly model_id: string;
  readonly messages: readonly unknown[];
  readonly tools: readonly unknown[];
  readonly sampling: CanonicalInferenceRequest['sampling'];
}

function messageShape(message: CanonicalInferenceMessage): unknown {
  if (message.role === 'system') {
    return { role: message.role, text_characters: message.content.length };
  }
  const blocks = message.role === 'assistant'
    ? undefined
    : message.content.map(block => block.type === 'text'
        ? { type: block.type, text_characters: block.text.length }
        : { type: block.type, media_type: block.media_type, bytes: block.bytes.byteLength });
  return {
    role: message.role,
    ...(message.role === 'tool' ? { tool_call_id: message.tool_call_id } : {}),
    ...(message.role === 'assistant'
      ? {
          parts: message.parts.map(part => ({
            type: part.type,
            text_characters: part.type === 'tool_call' ? 0 : part.text.length,
            ...(part.type === 'tool_call' ? { tool_call_id: part.call.id, tool_name: part.call.name } : {}),
          })),
        }
      : { blocks: blocks ?? [] }),
  };
}

/**
 * 只保存请求形状，不把 prompt、工具 schema 正文或图片 bytes 写入诊断。
 * 4 个字符约 1 token 仅用于比较历史请求大小，不能替代 provider usage。
 */
export function projectAiSdkRequestDiagnostic(
  request: CanonicalInferenceRequest,
): AiSdkRequestDiagnosticSummary {
  const messageRoles = { system: 0, user: 0, assistant: 0, tool: 0 };
  const imageMessageRoles = { system: 0, user: 0, assistant: 0, tool: 0 };
  let textCharacters = 0;
  let imageCount = 0;
  let imageBytes = 0;
  const imageMediaTypes = new Set<string>();

  for (const message of request.messages) {
    messageRoles[message.role] += 1;
    if (message.role === 'system') {
      textCharacters += message.content.length;
      continue;
    }
    if (message.role === 'assistant') {
      for (const part of message.parts) {
        if (part.type !== 'tool_call') textCharacters += part.text.length;
      }
      continue;
    }
    for (const block of message.content) {
      if (block.type === 'text') {
        textCharacters += block.text.length;
      } else {
        imageCount += 1;
        imageBytes += block.bytes.byteLength;
        imageMediaTypes.add(block.media_type);
        imageMessageRoles[message.role] += 1;
      }
    }
  }

  const shape: RequestShape = {
    model_id: request.model_id,
    messages: request.messages.map(messageShape),
    tools: request.tools.map(tool => ({
      name: tool.name,
      description_characters: tool.description.length,
      parameter_keys: Object.keys(tool.parameters.properties ?? {}).sort(),
    })),
    sampling: request.sampling,
  };
  const requestFingerprint = createHash('sha256')
    .update(JSON.stringify(shape))
    .digest('hex')
    .slice(0, 32);

  return {
    request_fingerprint: requestFingerprint,
    message_count: request.messages.length,
    message_roles: messageRoles,
    image_message_roles: imageMessageRoles,
    tool_count: request.tools.length,
    text_characters: textCharacters,
    estimated_input_tokens: Math.ceil(textCharacters / 4),
    image_count: imageCount,
    image_bytes: imageBytes,
    image_media_types: [...imageMediaTypes].sort(),
  };
}
