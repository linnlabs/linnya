/**
 * 启动时可以单独停掉、不挡启动的能力。
 *
 * 其余步骤（数据库、运行保留集、受管图片目录绑定、插件运行资源、API server）失败仍然挡启动，
 * 由启动失败对话框说明原因。
 */
export type StartupCapability = 'knowledge-base' | 'background-tasks' | 'models';

export interface StartupCapabilityFailure {
  readonly capability: StartupCapability;
  /** 一句说明加原始错误文案，入口原样展示给用户。 */
  readonly message: string;
}

/** 向量库进程的启动结果；没有启动时知识库整组跳过，不回退到默认地址。 */
export type StartupVectorStore =
  | { readonly kind: 'ready'; readonly url: string }
  | { readonly kind: 'unavailable'; readonly message: string };

const MAX_ERROR_DETAIL_LENGTH = 300;

export function describeStartupCapabilityFailure(summary: string, error: unknown): string {
  const raw = (error instanceof Error ? error.message : String(error)).trim();
  if (raw.length === 0) return summary;
  const detail = raw.length > MAX_ERROR_DETAIL_LENGTH
    ? `${raw.slice(0, MAX_ERROR_DETAIL_LENGTH - 1)}…`
    : raw;
  return `${summary}（${detail}）`;
}

export function findStartupCapabilityFailure(
  failures: readonly StartupCapabilityFailure[],
  capability: StartupCapability,
): StartupCapabilityFailure | null {
  return failures.find(failure => failure.capability === capability) ?? null;
}
