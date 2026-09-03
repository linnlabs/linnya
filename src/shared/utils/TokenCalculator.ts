/**
 * @file src/agent/contextManager/TokenCalculator.ts
 * 
 * @brief Token 计算器工具类
 * 
 * @description
 * 专门为 Agent 模式设计的 Token 计算工具，支持混合策略：
 * 1. 粗略估算 (Rough Estimation): 基于UTF-8字节数和脚本感知，速度快，用于早期筛选。
 * 2. 精确计算 (Precise Calculation): 基于 tiktoken，100%准确，用于最终请求构建和关键决策。
 * 
 * 设计采纳了以下关键改进：
 * - API 统一接收 model 参数，以适应未来多模型场景。
 * - 懒加载并缓存 tiktoken 编码器实例，优化性能。
 * - 截断操作采用“编码 -> 切片 -> 解码”的精确模式。
 * - 预留了消息结构（ChatML）的固定开销位。
 */

import { get_encoding, Tiktoken } from 'tiktoken';
import { AiMessage } from 'linnkit/contracts';

/**
 * Token 计算器类
 * 提供粗略和精确两种 Token 估算功能，以及精确的文本截断。
 * 所有方法均为静态，无需实例化。
 */
export class TokenCalculator {
    // --- Constants ---
    // 根据经验值，拉丁/混合英文脚本大约每个Token占4字节，而CJK（中日韩）脚本约为3字节。
    private static readonly BYTES_PER_TOKEN_LATIN = 4;
    private static readonly BYTES_PER_TOKEN_CJK = 3;
    // 不同 SDK/模型的 ChatML 有每条消息的固定开销（role、边界标记等）。
    // 根据 OpenAI Cookbook，这个值通常在4-5之间。我们取5作为一个稳妥的估算值。
    private static readonly OVERHEAD_PER_MESSAGE = 5;
    private static readonly OVERHEAD_PER_TOOL_CALL = 10;

    // --- Caching ---
    /**
     * tiktoken 编码器缓存（按 encoding 名称缓存，而不是按“业务模型名”缓存）
     *
     * 背景：
     * - 我们系统中的模型名（如 deepseek-reasoner / gemini-2.5-flash）并不一定属于 tiktoken 内置的 TiktokenModel；
     * - 若误把“业务模型名”直接传给 encoding_for_model，会产生 `Invalid model` 的异常/噪音日志；
     * - 对于第三方/自定义模型，我们只需要选择一个合理的 encoding（大多数 OpenAI 兼容模型可用 cl100k_base）。
     */
    private static encoderCache = new Map<TokenEncodingName, Tiktoken>();

    /**
     * tiktoken 的 encoding 名称类型（通过 get_encoding 的参数类型推导，避免手写字符串 union）
     */
    private static readonly DEFAULT_ENCODING: TokenEncodingName = 'cl100k_base';

    /**
     * 将“业务模型标识”（model_name 或 model_id）映射到 tiktoken encoding。
     *
     * 重要说明：
     * - 这不是“防御性兜底”，而是对两套命名体系的显式对齐：
     *   - 业务侧：deepseek-reasoner / gemini-2.5-flash / cloud-deepseek-chat ...
     *   - tiktoken：cl100k_base / o200k_base / ...
     * - deepseek 走 OpenAI 兼容协议，实践上用 cl100k_base 是最稳妥的选择之一。
     */
    private static resolveEncodingFromModelIdentifier(modelIdentifier: string): TokenEncodingName {
        const normalized = (modelIdentifier || '').trim().toLowerCase();

        // deepseek 系列（chat/reasoner/未来变体）统一映射到 cl100k_base
        if (normalized.includes('deepseek')) {
            return 'cl100k_base';
        }

        // OpenAI 新一代模型（如 gpt-4o / o1）通常使用 o200k_base
        if (normalized.includes('gpt-4o') || normalized.startsWith('o1')) {
            return 'o200k_base';
        }

        // Gemini / Claude 等非 tiktoken 内置模型名：统一走 cl100k_base（用于预算估算/摘要触发等内部逻辑）
        if (normalized.includes('gemini') || normalized.includes('claude')) {
            return 'cl100k_base';
        }

        // 默认：使用 cl100k_base，避免把业务模型名误传给 tiktoken 的“模型映射”
        return this.DEFAULT_ENCODING;
    }

    /**
     * 获取并缓存指定模型的 tiktoken 编码器。
     * @param modelIdentifier 业务模型标识（model_name 或 model_id）
     * @returns 编码器实例
     */
    private static getEncoder(modelIdentifier: string): Tiktoken {
        const encodingName = this.resolveEncodingFromModelIdentifier(modelIdentifier);
        const cached = this.encoderCache.get(encodingName);
        if (cached) {
            return cached;
        }

        const encoder = get_encoding(encodingName);
        this.encoderCache.set(encodingName, encoder);
        return encoder;
    }

    /**
     * **[粗略估算]** 基于UTF-8字节数和脚本感知的快速估算。
     * @param text 文本内容
     * @param modelIdentifier (可选) 为保持API统一性而保留，当前实现不使用。
     * @returns 估算的 Token 数量
     */
    public static estimateTokensRough(text: string | null | undefined, modelIdentifier?: string): number {
        if (!text) return 0;
        
        // CJK 字符检测（包括中、日、韩文）
        const hasCJK = /[\u4e00-\u9fa5]|[\u3040-\u30ff]|[\uac00-\ud7af]/.test(text);
        const ratio = hasCJK ? this.BYTES_PER_TOKEN_CJK : this.BYTES_PER_TOKEN_LATIN;

        // TextEncoder.encode(text).length 是获取UTF-8字节长度的最准确方法。
        const byteLength = new TextEncoder().encode(text).length;

        return Math.ceil(byteLength / ratio);
    }

    /**
     * **[精确计算]** 使用 tiktoken 进行精确计算。
     * @param text 文本内容
     * @param modelIdentifier 业务模型标识（model_name 或 model_id）
     * @returns 精确的 Token 数量
     */
    public static estimateTokensPrecise(text: string | null | undefined, modelIdentifier: string): number {
        if (!text) return 0;
        const encoder = this.getEncoder(modelIdentifier);
        return encoder.encode(text).length;
    }

    /**
     * **[精确计算]** 估算单条消息的 Token 数量。
     * @param message 对话消息
     * @param modelIdentifier 业务模型标识（model_name 或 model_id）
     * @returns 精确的 Token 数量
     */
    public static estimateMessageTokensPrecise(message: AiMessage, modelIdentifier: string): number {
        let totalTokens = this.OVERHEAD_PER_MESSAGE;

        if (message.content) {
            totalTokens += this.estimateTokensPrecise(message.content, modelIdentifier);
        }

        if (message.metadata?.tool_calls && message.metadata.tool_calls.length > 0) {
            for (const toolCall of message.metadata.tool_calls) {
                totalTokens += this.OVERHEAD_PER_TOOL_CALL;
                totalTokens += this.estimateTokensPrecise(toolCall.function.name, modelIdentifier);
                totalTokens += this.estimateTokensPrecise(toolCall.function.arguments, modelIdentifier);
            }
        }

        if (message.metadata?.tool_call_id) {
            totalTokens += this.estimateTokensPrecise(message.metadata.tool_call_id, modelIdentifier);
        }

        return totalTokens;
    }

     /**
      * **[精确计算]** 估算消息数组的总 Token 数量。
      * @param messages 消息数组
      * @param modelIdentifier 业务模型标识（model_name 或 model_id）
      * @returns 总 Token 数量
      */
    public static estimateMessagesTokensPrecise(messages: AiMessage[], modelIdentifier: string): number {
        return messages.reduce((total, msg) => total + this.estimateMessageTokensPrecise(msg, modelIdentifier), 0);
    }

    /**
     * **[精确截断]** 根据 Token 预算精确截断文本。
     * 采用“编码 -> 切片 -> 解码”的流程，确保结果的 Token 数符合预期。
     * @param text 原始文本
     * @param maxTokens 最大 Token 数
     * @param modelIdentifier 业务模型标识（model_name 或 model_id）
     * @param strategy 截断策略：'start'(保留开头), 'end'(保留结尾), 'middle'(保留两端)
     * @returns 截断后的文本
     */
    public static truncateTextByTokens(
        text: string, 
        maxTokens: number, 
        modelIdentifier: string,
        strategy: 'start' | 'end' | 'middle' = 'end'
    ): string {
        if (!text || maxTokens <= 0) return '';

        const encoder = this.getEncoder(modelIdentifier);
        const tokens = encoder.encode(text);

        if (tokens.length <= maxTokens) {
            return text;
        }

        let truncatedTokens: Uint32Array;
        const ellipsis = '...';

        switch (strategy) {
            case 'start':
                // 从末尾截断，保留开头
                truncatedTokens = tokens.slice(0, maxTokens);
                return encoder.decode(truncatedTokens) + ellipsis;
            
            case 'end':
                // 从开头截断，保留结尾
                truncatedTokens = tokens.slice(tokens.length - maxTokens);
                return ellipsis + encoder.decode(truncatedTokens);
            
            case 'middle':
                const half = Math.floor(maxTokens / 2);
                const head = tokens.slice(0, half);
                const tail = tokens.slice(tokens.length - (maxTokens - half));
                // 使用 Uint32Array.of 来合并两个 TypedArray
                const combinedTokens = new Uint32Array(head.length + tail.length);
                combinedTokens.set(head);
                combinedTokens.set(tail, head.length);
                
                // 在中间插入省略号的Token（如果需要更精确）
                // 为简化起见，我们直接在解码后的字符串间插入
                return encoder.decode(head) + ellipsis + encoder.decode(tail);
            
            default:
                // 默认行为，同 'start'
                truncatedTokens = tokens.slice(0, maxTokens);
                return encoder.decode(truncatedTokens) + ellipsis;
        }
    }

    /**
     * 释放所有缓存的 tiktoken 编码器资源。
     * 在应用关闭或不再需要 Token 计算时调用，以防止内存泄漏。
     */
    public static cleanup(): void {
        for (const encoder of this.encoderCache.values()) {
            encoder.free();
        }
        this.encoderCache.clear();
    }
}

/**
 * tiktoken encoding 名称类型（通过 get_encoding 参数类型推导）
 */
type TokenEncodingName = Parameters<typeof get_encoding>[0];
