import { isObjectLike } from '@linnya/foundation';
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

import { getNumberProp } from './guards';

/** Host 的受管启动失败跨 artifact 通过稳定错误名称识别，不能依赖不同 bundle 的类身份。 */
export function isQdrantRuntimeUnavailableError(error: unknown): boolean {
  return error instanceof KnowledgeVectorStartupError ||
    (error instanceof Error && error.name === 'QdrantRuntimeUnavailableError');
}

/**
 * 向量服务启动失败的类别，决定给用户的恢复办法：
 * - runtime-missing：Host 判定本机没有可用的 Qdrant 运行时组件（缺失、损坏或复核失败），停启无法恢复，只能重新安装补齐；
 * - data-directory-too-long：Windows 上数据目录太长，Host 没有启动 Qdrant，只能换短目录后重启；
 * - startup-failed：其他启动故障，停启或重启可能恢复。
 */
export type KnowledgeVectorStartupFailureKind = 'runtime-missing' | 'data-directory-too-long' | 'startup-failed';

/** 只认 Host 错误名称与原因字段，不依赖不同 bundle 的类身份；未知原因按一般启动故障处理。 */
export function readKnowledgeVectorStartupFailureKind(error: unknown): KnowledgeVectorStartupFailureKind {
  if (!(error instanceof Error) || error.name !== 'QdrantRuntimeUnavailableError') return 'startup-failed';
  const reason: unknown = Reflect.get(error, 'reason');
  return reason === 'runtime-missing' || reason === 'data-directory-too-long' ? reason : 'startup-failed';
}

const KNOWLEDGE_VECTOR_STARTUP_MESSAGES: Readonly<Record<KnowledgeVectorStartupFailureKind, string>> = {
  'runtime-missing': '知识库所需的 Qdrant 运行时缺失或已损坏：请在插件商店卸载知识库（保留资料）后重新安装，以补齐运行时。',
  'data-directory-too-long': '知识库数据目录的路径太长，Windows 上的向量库无法在其中建立索引：请把环境变量 LINNYA_WORKSPACE_DIR 指向更短的目录，或换用名字更短的 Windows 用户目录，然后重启 Linnya。',
  'startup-failed': '知识库向量服务未能启动：请在插件商店停用并重新启用知识库；若仍失败，请重启 Linnya。',
};

/**
 * 给 Agent 工具的英文说明：模型据此判断重试无效，并把恢复办法转告用户。
 * 与上面的中文说明、界面文案按同一个 kind 对应，恢复办法必须一致。
 */
const KNOWLEDGE_VECTOR_STARTUP_TOOL_MESSAGES: Readonly<Record<KnowledgeVectorStartupFailureKind, string>> = {
  'runtime-missing': 'Knowledge search is unavailable: the Qdrant runtime that Knowledge Base needs is missing or damaged. Retrying will not help. Tell the user to uninstall Knowledge Base in the plugin store (keeping data) and install it again.',
  'data-directory-too-long': 'Knowledge search is unavailable: the Knowledge Base data folder path is too long for the vector store on Windows. Retrying will not help. Tell the user to point the LINNYA_WORKSPACE_DIR environment variable to a shorter folder (or use a Windows user folder with a shorter name), then restart Linnya.',
  'startup-failed': 'Knowledge search is unavailable: the knowledge vector service failed to start. Retrying will not help. Tell the user to disable and re-enable Knowledge Base in the plugin store; if it still fails, restart Linnya.',
};

export class KnowledgeVectorStartupError extends Error {
  readonly kind: KnowledgeVectorStartupFailureKind;
  /** 面向 Agent 工具的英文说明；用户界面不用它，而是按 kind 取本地化文案。 */
  readonly toolMessage: string;

  constructor(cause: unknown) {
    const kind = readKnowledgeVectorStartupFailureKind(cause);
    // CLI 与摄入失败记录直接展示这段中文说明，界面另按 kind 取本地化文案，工具另用 toolMessage。
    super(KNOWLEDGE_VECTOR_STARTUP_MESSAGES[kind], { cause });
    this.name = 'KnowledgeVectorStartupError';
    this.kind = kind;
    this.toolMessage = KNOWLEDGE_VECTOR_STARTUP_TOOL_MESSAGES[kind];
  }
}

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
  if (!isObjectLike(err)) return undefined;

  const direct = getNumberProp(err, 'status') ?? getNumberProp(err, 'statusCode');
  if (typeof direct === 'number') return direct;

  const response = err['response'];
  if (isObjectLike(response)) {
    const nested = getNumberProp(response, 'status') ?? getNumberProp(response, 'statusCode');
    if (typeof nested === 'number') return nested;
  }

  const cause = err['cause'];
  if (cause !== undefined) {
    return extractHttpStatusCode(cause, depth + 1);
  }

  return undefined;
}
