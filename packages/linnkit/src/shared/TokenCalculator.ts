import { get_encoding, Tiktoken } from 'tiktoken';
import type { AssistantReplayPart } from '../contracts';
import type { LlmRequestMessage } from '../ports';
import { Logger } from './logger';

export type TokenEncodingName = Parameters<typeof get_encoding>[0];

export interface TokenEstimateOptions {
  /** 显式 tiktoken encoding 名称；模型到 encoding 的选择属于 Host。 */
  encoding?: string;
  /** tiktoken 不可用或未指定 encoding 时的字符/token 兜底比。 */
  avgCharsPerToken?: number;
  /** 单个 tool_call 的额外 token 开销估算。 */
  toolCallOverhead?: number;
}

export class TokenCalculator {
  private static readonly BYTES_PER_TOKEN_LATIN = 4;
  private static readonly BYTES_PER_TOKEN_CJK = 3;
  private static readonly OVERHEAD_PER_MESSAGE = 5;
  private static readonly OVERHEAD_PER_TOOL_CALL = 10;
  private static encoderCache = new Map<TokenEncodingName, Tiktoken>();
  private static readonly failedEncodingWarnings = new Set<string>();
  private static readonly SUPPORTED_ENCODINGS = [
    'gpt2',
    'r50k_base',
    'p50k_base',
    'p50k_edit',
    'cl100k_base',
    'o200k_base',
  ] as const satisfies readonly TokenEncodingName[];

  private static requireEncodingName(value: string): TokenEncodingName {
    const normalized = value.trim().toLowerCase();
    if (this.isSupportedEncodingName(normalized)) return normalized;
    throw new Error(`不支持的 tiktoken encoding: ${value}`);
  }

  private static isSupportedEncodingName(value: string): value is TokenEncodingName {
    return this.SUPPORTED_ENCODINGS.some(encoding => encoding === value);
  }

  private static getEncoder(encoding: string): Tiktoken {
    const encodingName = this.requireEncodingName(encoding);
    const cached = this.encoderCache.get(encodingName);
    if (cached) {
      return cached;
    }

    const encoder = get_encoding(encodingName);
    this.encoderCache.set(encodingName, encoder);
    return encoder;
  }

  public static estimateTokensRough(text: string | null | undefined, _modelIdentifier?: string): number {
    if (!text) return 0;

    const hasCJK = /[\u4e00-\u9fa5]|[\u3040-\u30ff]|[\uac00-\ud7af]/.test(text);
    const ratio = hasCJK ? this.BYTES_PER_TOKEN_CJK : this.BYTES_PER_TOKEN_LATIN;
    const byteLength = new TextEncoder().encode(text).length;

    return Math.ceil(byteLength / ratio);
  }

  public static estimateTokens(text: string | null | undefined, options: TokenEstimateOptions = {}): number {
    if (!text) return 0;

    if (options.encoding) {
      try {
        return this.estimateTokensPrecise(text, options.encoding);
      } catch (error) {
        // 中文备注：tiktoken 运行时不可用时退回声明式 avgCharsPerToken，保证上下文构建不中断。
        this.warnEncodingFallbackOnce(options.encoding, error);
      }
    }

    const avgCharsPerToken = normalizePositiveNumber(options.avgCharsPerToken, 2);
    return Math.ceil(text.length / avgCharsPerToken);
  }

  public static estimateTokensPrecise(text: string | null | undefined, encoding: string): number {
    if (!text) return 0;
    const encoder = this.getEncoder(encoding);
    return encoder.encode(text).length;
  }

  public static estimateMessageTokens(
    message: LlmRequestMessage,
    options: TokenEstimateOptions = {},
  ): number {
    let totalTokens = this.OVERHEAD_PER_MESSAGE;

    const replayParts = this.extractAssistantReplayPartsForTokenEstimate(message);
    const toolCalls = this.extractToolCallsForTokenEstimate(message);
    if (replayParts) {
      for (const part of replayParts) {
        if (part.type === 'text' || part.type === 'reasoning') {
          totalTokens += this.estimateTokens(part.text, options);
          continue;
        }
        const toolCall = toolCalls.find(call => this.readToolCallId(call) === part.tool_call_id);
        totalTokens += this.estimateToolCallTokens(toolCall, options);
      }
      return totalTokens;
    }

    if (message.content) {
      totalTokens += this.estimateTokens(String(message.content), options);
    }

    for (const toolCall of toolCalls) {
      totalTokens += this.estimateToolCallTokens(toolCall, options);
    }

    const toolCallId = this.extractToolCallIdForTokenEstimate(message);
    if (toolCallId) {
      totalTokens += this.estimateTokens(toolCallId, options);
    }

    return totalTokens;
  }

  public static estimateMessageTokensPrecise(message: LlmRequestMessage, encoding: string): number {
    return this.estimateMessageTokens(message, {
      encoding,
      toolCallOverhead: this.OVERHEAD_PER_TOOL_CALL,
    });
  }

  public static estimateMessagesTokensPrecise(messages: LlmRequestMessage[], encoding: string): number {
    return messages.reduce(
      (total, message) => total + this.estimateMessageTokensPrecise(message, encoding),
      0
    );
  }

  private static extractToolCallsForTokenEstimate(message: LlmRequestMessage): unknown[] {
    const direct = 'tool_calls' in message ? message.tool_calls : undefined;
    if (Array.isArray(direct)) return direct;

    const metadata = 'metadata' in message ? message.metadata : undefined;
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return [];
    const metadataRecord = metadata as Record<string, unknown>;
    const metadataToolCalls = metadataRecord['tool_calls'];
    return Array.isArray(metadataToolCalls) ? metadataToolCalls : [];
  }

  private static extractAssistantReplayPartsForTokenEstimate(
    message: LlmRequestMessage,
  ): readonly AssistantReplayPart[] | undefined {
    const direct = 'assistant_replay_parts' in message
      ? message.assistant_replay_parts
      : undefined;
    if (direct?.length) return direct;

    const metadata = 'metadata' in message ? message.metadata : undefined;
    return metadata?.assistant_replay_parts?.length
      ? metadata.assistant_replay_parts
      : undefined;
  }

  private static estimateToolCallTokens(
    toolCall: unknown,
    options: TokenEstimateOptions,
  ): number {
    const overhead = normalizeNonNegativeInteger(
      options.toolCallOverhead,
      this.OVERHEAD_PER_TOOL_CALL,
    );
    if (!this.isRecord(toolCall)) return overhead;
    const fn = toolCall['function'];
    if (!this.isRecord(fn)) return overhead;
    return overhead
      + this.estimateTokens(String(fn['name'] ?? ''), options)
      + this.estimateTokens(String(fn['arguments'] ?? ''), options);
  }

  private static readToolCallId(toolCall: unknown): string | undefined {
    if (!this.isRecord(toolCall)) return undefined;
    return typeof toolCall['id'] === 'string' ? toolCall['id'] : undefined;
  }

  private static isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  private static extractToolCallIdForTokenEstimate(message: LlmRequestMessage): string | undefined {
    if ('tool_call_id' in message && typeof message.tool_call_id === 'string') {
      return message.tool_call_id;
    }

    const metadata = 'metadata' in message ? message.metadata : undefined;
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return undefined;
    const metadataRecord = metadata as Record<string, unknown>;
    const toolCallId = metadataRecord['tool_call_id'];
    return typeof toolCallId === 'string' ? toolCallId : undefined;
  }

  public static truncateTextByTokens(
    text: string,
    maxTokens: number,
    encoding: string,
    strategy: 'start' | 'end' | 'middle' = 'end',
  ): string {
    if (!text || maxTokens <= 0) return '';

    const encoder = this.getEncoder(encoding);
    const tokens = encoder.encode(text);

    if (tokens.length <= maxTokens) {
      return text;
    }

    let truncatedTokens: Uint32Array;
    const ellipsis = '...';

    switch (strategy) {
      case 'start':
        truncatedTokens = tokens.slice(0, maxTokens);
        return encoder.decode(truncatedTokens) + ellipsis;
      case 'end':
        truncatedTokens = tokens.slice(tokens.length - maxTokens);
        return ellipsis + encoder.decode(truncatedTokens);
      case 'middle': {
        const half = Math.floor(maxTokens / 2);
        const head = tokens.slice(0, half);
        const tail = tokens.slice(tokens.length - (maxTokens - half));
        return encoder.decode(head) + ellipsis + encoder.decode(tail);
      }
      default:
        truncatedTokens = tokens.slice(0, maxTokens);
        return encoder.decode(truncatedTokens) + ellipsis;
    }
  }

  public static cleanup(): void {
    for (const encoder of this.encoderCache.values()) {
      encoder.free();
    }
    this.encoderCache.clear();
    this.failedEncodingWarnings.clear();
  }

  private static warnEncodingFallbackOnce(requestedEncoding: string, error: unknown): void {
    if (this.failedEncodingWarnings.has(requestedEncoding)) {
      return;
    }
    this.failedEncodingWarnings.add(requestedEncoding);
    const logger = new Logger('TokenCalculator');
    logger.warn('tiktoken encoding unavailable, falling back to avgCharsPerToken estimator', {
      requestedEncoding,
      error,
    });
  }
}

function normalizePositiveNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function normalizeNonNegativeInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.floor(value));
}
