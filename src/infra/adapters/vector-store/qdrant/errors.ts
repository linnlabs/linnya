/**
 * @file src/infra/adapters/vector-store/qdrant/errors.ts
 *
 * @brief Qdrant 适配器错误定义与解析工具
 *
 * @description
 * 启动维护 / 删除等关键路径需要区分：
 * - 404：集合确实不存在（业务上可当作“无数据”）
 * - 其它错误：Qdrant 不可达/未就绪/超时等（业务上必须“停止破坏性动作”，避免误删）
 *
 * 注意：这里严格避免 any 与不安全断言，只用类型守卫安全取值。
 */

import { getNumberProp, isRecord } from './guards';

/**
 * Qdrant 请求错误（用于把“不存在”与“不可用”区分开）
 */
export class QdrantRequestError extends Error {
  readonly httpStatus?: number;
  /**
   * 兼容 TS/lib 版本：不依赖 ErrorOptions.cause，直接在子类上显式声明。
   */
  readonly cause?: unknown;

  constructor(
    message: string,
    options?: {
      httpStatus?: number;
      cause?: unknown;
    }
  ) {
    super(message);
    this.name = 'QdrantRequestError';
    this.httpStatus = options?.httpStatus;
    this.cause = options?.cause;
  }
}

export function isQdrantRequestError(err: unknown): err is QdrantRequestError {
  return err instanceof QdrantRequestError;
}

/**
 * 从未知错误对象中尽可能提取 HTTP 状态码。
 *
 * 兼容常见形态：
 * - err.status / err.statusCode
 * - err.response.status / err.response.statusCode
 * - err.cause ...（递归向下）
 */
export function extractHttpStatusCode(err: unknown, depth: number = 0): number | undefined {
  if (depth > 3) return undefined;
  if (!isRecord(err)) return undefined;

  const direct = getNumberProp(err, 'status') ?? getNumberProp(err, 'statusCode');
  if (typeof direct === 'number') return direct;

  const response = err['response'];
  if (isRecord(response)) {
    const nested = getNumberProp(response, 'status') ?? getNumberProp(response, 'statusCode');
    if (typeof nested === 'number') return nested;
  }

  const cause = err['cause'];
  if (cause !== undefined) {
    return extractHttpStatusCode(cause, depth + 1);
  }

  return undefined;
}


