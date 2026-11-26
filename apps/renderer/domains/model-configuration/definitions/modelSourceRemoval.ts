/** 一次删除的目标：已准入模型与启动时停用的条目走不同的前端清理，调用方按快照来源分开传。 */
export interface ModelSourceRemovalTargets {
  /** 运行目录里的模型：删除后同步移出前端 catalog 并清理用途绑定。 */
  readonly modelConfigIds: readonly string[];
  /** 启动时停用的条目：从未进入前端 catalog，只删后端并移出选择器快照。 */
  readonly unadmittedModelConfigIds: readonly string[];
}

/** 正式 Provider 保留逐模型归属事务；批量结果必须明确已完成的部分。 */
export interface ModelSourceRemovalResult {
  readonly removedModelIds: readonly string[];
  readonly failure: { readonly modelId: string; readonly error: unknown } | null;
  readonly synchronizationFailed: boolean;
}
