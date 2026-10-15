/** 正式 Provider 保留逐模型归属事务；批量结果必须明确已完成的部分。 */
export interface ModelSourceRemovalResult {
  readonly removedModelIds: readonly string[];
  readonly failure: { readonly modelId: string; readonly error: unknown } | null;
  readonly synchronizationFailed: boolean;
}
