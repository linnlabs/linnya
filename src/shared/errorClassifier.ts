/**
 * @file src/shared/errorClassifier.ts
 * 
 * @brief 智能错误分类器 - 用于判断错误类型和重试策略
 * 
 * @description
 * 提供统一的错误分类逻辑，帮助各个模块（LlmCaller、ChatService等）
 * 智能判断错误是否应该重试，以及使用什么样的重试策略。
 * 
 * 设计原则：
 * - 保守策略：未知错误默认不重试，避免浪费资源
 * - 智能识别：根据错误消息内容判断错误类型
 * - 可扩展性：易于添加新的错误模式
 */

/**
 * 错误类型分类
 */
export enum ErrorCategory {
  /** 可重试的临时错误（如网络问题、服务端临时故障） */
  RETRYABLE = 'retryable',
  /** 不可重试的永久错误（如格式错误、权限问题、功能不支持） */
  NON_RETRYABLE = 'non_retryable',
  /** 需要更长延迟的速率限制错误 */
  RATE_LIMIT = 'rate_limit'
}

/**
 * 错误分类结果
 */
export interface ErrorClassification {
  /** 错误类别 */
  category: ErrorCategory;
  /** 分类原因（用于日志记录） */
  reason: string;
  /** 建议的重试延迟（毫秒），null表示不应重试 */
  suggestedDelay: number | null;
}

/**
 * 智能错误分类器
 * 
 * @description
 * 根据错误消息内容智能判断错误类型，帮助调用方决定重试策略。
 * 
 * 分类逻辑：
 * 1. 不可重试错误：功能不支持、认证失败、格式错误、资源不存在等
 * 2. 速率限制错误：429错误、quota exceeded等，需要更长延迟
 * 3. 可重试错误：网络错误、服务端临时故障等
 * 4. 未知错误：默认不重试（保守策略）
 */
export class ErrorClassifier {
  /**
   * 分类错误
   * 
   * @param error 错误对象
   * @param context 可选的上下文信息，用于更精确的分类
   * @returns 错误分类结果
   */
  static classify(error: Error, context?: { logPrefix?: string }): ErrorClassification {
    type UnknownRecord = Record<string, unknown>;
    const isRecord = (v: unknown): v is UnknownRecord => !!v && typeof v === 'object' && !Array.isArray(v);

    const baseMsg = (error.message || '').toLowerCase();
    const causeMsg = (() => {
      const cause = (error as unknown as { cause?: unknown }).cause;
      if (typeof cause === 'string') return cause.toLowerCase();
      if (cause instanceof Error) return (cause.message || '').toLowerCase();
      if (isRecord(cause) && typeof cause['message'] === 'string') return String(cause['message']).toLowerCase();
      return '';
    })();
    const causeCode = (() => {
      const cause = (error as unknown as { cause?: unknown }).cause;
      if (isRecord(cause) && typeof cause['code'] === 'string') return String(cause['code']);
      return '';
    })();

    // 用“合并消息”做模式匹配，覆盖 undici 的 Error.message=terminated + cause=SocketError 等情况
    const errorMessage = `${baseMsg} ${causeMsg}`.trim();
    const logPrefix = context?.logPrefix || '[ErrorClassifier]';

    // 供应商/模型组合的特殊错误（如 OpenRouter/Gemini 的严格校验）应由 Policy 层处理，
    // ErrorClassifier 保持“通用、保守”的分类策略，避免无限膨胀。

    if (errorMessage.includes('invalid tool_call.arguments')) {
      console.log(`${logPrefix} 🔄 检测到流式 tool_call 参数损坏，可以重试`);
      return {
        category: ErrorCategory.RETRYABLE,
        reason: '模型输出损坏: invalid tool_call.arguments',
        suggestedDelay: 1000
      };
    }
    
    // ========================================
    // 1. 不可重试的错误（永久性错误）
    // ========================================
    
    // 功能不支持类错误
    const unsupportedPatterns = [
      'no channels with claude tools support',
      'does not support',
      'not supported',
      'tool calling is not available',
      'feature not available',
      'capability not supported',
      'unsupported'
    ];
    
    for (const pattern of unsupportedPatterns) {
      if (errorMessage.includes(pattern)) {
        console.log(`${logPrefix} 🚫 检测到功能不支持错误，不重试`);
        return {
          category: ErrorCategory.NON_RETRYABLE,
          reason: `功能不支持: ${pattern}`,
          suggestedDelay: null
        };
      }
    }
    
    // 云端额度限制（必须在认证/权限错误之前检测，因为也是 403）
    const quotaPatterns = ['已达上限', '免费期已结束'];
    for (const pattern of quotaPatterns) {
      if (errorMessage.includes(pattern)) {
        console.log(`${logPrefix} 🚫 检测到云端额度限制，不重试`);
        return {
          category: ErrorCategory.NON_RETRYABLE,
          reason: `云端额度限制: ${pattern}`,
          suggestedDelay: null
        };
      }
    }

    // 认证/权限错误
    const authPatterns = [
      { pattern: 'unauthorized', code: '401' },
      { pattern: 'forbidden', code: '403' },
      { pattern: 'invalid api key', code: 'auth' },
      { pattern: 'invalid_api_key', code: 'auth' },
      { pattern: 'authentication failed', code: 'auth' },
      { pattern: 'api key not found', code: 'auth' }
    ];
    
    for (const { pattern, code } of authPatterns) {
      if (errorMessage.includes(pattern)) {
        console.log(`${logPrefix} 🚫 检测到认证/权限错误 (${code})，不重试`);
        return {
          category: ErrorCategory.NON_RETRYABLE,
          reason: `认证/权限错误: ${pattern}`,
          suggestedDelay: null
        };
      }
    }
    
    // 请求格式错误
    const formatPatterns = [
      'bad request',
      '400',
      'invalid request',
      'invalid parameter',
      // OpenAI-compat 工具调用入参校验失败（常见于 function.arguments 不是合法 JSON）
      'invalid arguments for function',
      // 上游/网关在请求转换阶段失败（通常是 schema/arguments 不合法，重试无意义）
      'convert_request_failed',
      'validation error',
      'malformed',
      'invalid json',
      'parse error',
      'schema validation failed'
    ];
    
    for (const pattern of formatPatterns) {
      if (errorMessage.includes(pattern)) {
        console.log(`${logPrefix} 🚫 检测到请求格式错误，不重试`);
        return {
          category: ErrorCategory.NON_RETRYABLE,
          reason: `请求格式错误: ${pattern}`,
          suggestedDelay: null
        };
      }
    }
    
    // 资源不存在错误
    const notFoundPatterns = [
      'not found',
      '404',
      'model not found',
      'endpoint not found',
      'resource not found'
    ];
    
    for (const pattern of notFoundPatterns) {
      if (errorMessage.includes(pattern)) {
        console.log(`${logPrefix} 🚫 检测到资源不存在错误，不重试`);
        return {
          category: ErrorCategory.NON_RETRYABLE,
          reason: `资源不存在: ${pattern}`,
          suggestedDelay: null
        };
      }
    }
    
    // ========================================
    // 2. 速率限制错误（需要更长延迟）
    // ========================================
    
    const rateLimitPatterns = [
      'rate limit',
      'too many requests',
      '429',
      'quota exceeded',
      'throttled'
    ];
    
    for (const pattern of rateLimitPatterns) {
      if (errorMessage.includes(pattern)) {
        console.log(`${logPrefix} ⏱️ 检测到速率限制错误，将使用指数退避重试`);
        return {
          category: ErrorCategory.RATE_LIMIT,
          reason: `速率限制: ${pattern}`,
          suggestedDelay: 1000 // 建议从1秒开始，调用方应使用指数退避
        };
      }
    }
    
    // ========================================
    // 3. 可重试的临时错误
    // ========================================
    
    // 网络错误
    const networkPatterns = [
      'network error',
      'timeout',
      'econnrefused',
      'econnreset',
      'etimedout',
      'connection refused',
      'connection reset',
      'socket hang up',
      'fetch failed',
      'network timeout',
      'other side closed',
    ];

    /**
     * undici 在响应流被对端中止时使用固定形状 `TypeError('terminated')`。
     * 不能把 `terminated` 当全文关键词，否则本地进程终态、断言和业务错误都会被误判为网络故障。
     */
    if (error instanceof TypeError && baseMsg.trim() === 'terminated') {
      console.log(`${logPrefix} 🔄 检测到 undici 响应流中止，可以重试`);
      return {
        category: ErrorCategory.RETRYABLE,
        reason: '网络错误: terminated',
        suggestedDelay: 1000,
      };
    }

    for (const pattern of networkPatterns) {
      if (errorMessage.includes(pattern)) {
        console.log(`${logPrefix} 🔄 检测到网络错误，可以重试`);
        return {
          category: ErrorCategory.RETRYABLE,
          reason: `网络错误: ${pattern}`,
          suggestedDelay: 1000 // 建议1秒延迟
        };
      }
    }

    /**
     * undici 错误码兜底：即使 message 没命中，也按 code 做可重试判定
     *
     * 典型：UND_ERR_SOCKET / UND_ERR_CONNECT_TIMEOUT / UND_ERR_HEADERS_TIMEOUT
     */
    if (causeCode.startsWith('UND_ERR_')) {
      console.log(`${logPrefix} 🔄 检测到 undici 错误码(${causeCode})，可以重试`);
      return {
        category: ErrorCategory.RETRYABLE,
        reason: `网络错误(undici): ${causeCode}`,
        suggestedDelay: 1000,
      };
    }
    
    // 服务端临时错误
    const serverErrorPatterns = [
      { pattern: '500', name: 'Internal Server Error' },
      { pattern: '502', name: 'Bad Gateway' },
      { pattern: '503', name: 'Service Unavailable' },
      { pattern: '504', name: 'Gateway Timeout' },
      { pattern: 'internal server error', name: 'Internal Server Error' },
      { pattern: 'bad gateway', name: 'Bad Gateway' },
      { pattern: 'service unavailable', name: 'Service Unavailable' },
      { pattern: 'gateway timeout', name: 'Gateway Timeout' }
    ];
    
    for (const { pattern, name } of serverErrorPatterns) {
      if (errorMessage.includes(pattern)) {
        console.log(`${logPrefix} 🔄 检测到服务端临时错误 (${name})，可以重试`);
        return {
          category: ErrorCategory.RETRYABLE,
          reason: `服务端临时错误: ${name}`,
          suggestedDelay: 2000 // 服务端错误建议2秒延迟
        };
      }
    }
    
    // 空响应错误
    if (errorMessage.includes('空响应') || errorMessage.includes('empty response')) {
      console.log(`${logPrefix} 🔄 检测到空响应错误，可以重试`);
      return {
        category: ErrorCategory.RETRYABLE,
        reason: '空响应错误',
        suggestedDelay: 1000
      };
    }
    
    // ========================================
    // 4. 默认：未知错误谨慎处理，不重试
    // ========================================
    const truncatedMessage = errorMessage.length > 100 
      ? errorMessage.substring(0, 100) + '...' 
      : errorMessage;
    
    console.log(`${logPrefix} ⚠️ 未知错误类型，默认不重试以避免浪费: ${truncatedMessage}`);
    return {
      category: ErrorCategory.NON_RETRYABLE,
      reason: '未知错误类型（保守策略）',
      suggestedDelay: null
    };
  }
  
  /**
   * 简化的分类方法 - 只返回错误类别
   * 
   * @param error 错误对象
   * @returns 错误类别
   */
  static categorize(error: Error): ErrorCategory {
    return this.classify(error).category;
  }
  
  /**
   * 判断错误是否应该重试
   * 
   * @param error 错误对象
   * @returns 是否应该重试
   */
  static shouldRetry(error: Error): boolean {
    const category = this.categorize(error);
    return category === ErrorCategory.RETRYABLE || category === ErrorCategory.RATE_LIMIT;
  }
  
  /**
   * 计算重试延迟（使用指数退避策略）
   * 
   * @param error 错误对象
   * @param attemptNumber 当前尝试次数（从0开始）
   * @param baseDelay 基础延迟（毫秒）
   * @param maxDelay 最大延迟（毫秒）
   * @returns 建议的延迟时间（毫秒）
   */
  static calculateRetryDelay(
    error: Error, 
    attemptNumber: number, 
    baseDelay: number = 1000,
    maxDelay: number = 60000
  ): number {
    const classification = this.classify(error);
    
    if (classification.category === ErrorCategory.NON_RETRYABLE) {
      return 0; // 不应重试
    }
    
    if (classification.category === ErrorCategory.RATE_LIMIT) {
      // 速率限制使用指数退避
      const delay = Math.min(baseDelay * Math.pow(2, attemptNumber), maxDelay);
      return delay;
    }
    
    // 其他可重试错误使用建议的延迟或基础延迟
    return classification.suggestedDelay || baseDelay;
  }

  /**
   * 判断错误是否为"云端额度/限额"类错误
   *
   * 中文说明：
   * - 精确匹配 Linnya Cloud Worker 返回的限额文案；
   * - 用于 LlmCaller 在同一 run 内做静默降级判定（区别于通用分类逻辑）。
   */
  static isCloudQuotaError(error: Error): boolean {
    const msg = (error.message || '').toLowerCase();
    const patterns = [
      '额度上限',
      '已达上限',
      '免费期已结束',
      '该模型暂不可用',
    ];
    return patterns.some(p => msg.includes(p));
  }
}

/**
 * 便捷的导出函数（向后兼容）
 */
export const classifyError = (error: Error) => ErrorClassifier.classify(error);
export const categorizeError = (error: Error) => ErrorClassifier.categorize(error);
export const shouldRetryError = (error: Error) => ErrorClassifier.shouldRetry(error);
