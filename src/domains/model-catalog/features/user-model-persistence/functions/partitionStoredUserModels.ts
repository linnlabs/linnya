import { errorToString } from '@linnya/foundation';

import type { ModelConfig } from '../../../definitions/modelCatalog';
import type { UnadmittedUserModelEntry } from '../definitions/userModelsFile';
import { readStoredModelReferences } from './readStoredModelReferences';

export interface StoredUserModelPartition {
  readonly admitted: readonly ModelConfig[];
  /** 每条附带原始错误，只供调用方记带调用栈的日志；错误对象不进入目录的长期状态。 */
  readonly unadmitted: readonly {
    readonly entry: UnadmittedUserModelEntry;
    readonly error: unknown;
  }[];
}

/**
 * 逐条准入 `user_models.json` 里的模型：一条失败只停用这一条，其余照常进入目录。
 * 准入本身（字段校验、route 与连接匹配）由调用方传入；失败条目不解释也不修复，
 * 原样交回，由调用方在之后的每次写盘里带回去。
 */
export function partitionStoredUserModels(
  entries: readonly unknown[],
  admit: (entry: unknown) => ModelConfig
): StoredUserModelPartition {
  const admitted: ModelConfig[] = [];
  const unadmitted: { entry: UnadmittedUserModelEntry; error: unknown }[] = [];
  for (const raw of entries) {
    try {
      admitted.push(admit(raw));
    } catch (error: unknown) {
      const entry = { raw, ...readStoredModelReferences(raw), reason: errorToString(error) };
      unadmitted.push({ entry, error });
    }
  }
  return { admitted, unadmitted };
}
