import type { SubrunTraceSummary } from '@app/schemas';

/**
 * single child 的 result 与运行中 summary 是同一业务身份的两个阶段事实。
 *
 * 参考 `docs/conversation-platform/10-subruns.md`：展示层不得按对象顺序猜 child；两个
 * owner 同时存在时必须一致。该函数只在 presentation admission 边界调用，冲突不会进入 Vue。
 */
export function resolveSingleSubrunIdentity(input: {
  readonly resultSubrunId?: string;
  readonly summary?: SubrunTraceSummary;
}): string | undefined {
  const summaryIds = input.summary?.subrun_ids ?? [];
  if (summaryIds.length > 1) {
    throw new Error(
      `[SUBRUN_SINGLE_IDENTITY_CARDINALITY] single subrun received ${summaryIds.length} summary ids`,
    );
  }

  const summarySubrunId = summaryIds[0];
  if (
    input.resultSubrunId !== undefined
    && summarySubrunId !== undefined
    && input.resultSubrunId !== summarySubrunId
  ) {
    throw new Error(
      `[SUBRUN_SINGLE_IDENTITY_CONFLICT] result=${input.resultSubrunId}, summary=${summarySubrunId}`,
    );
  }
  return input.resultSubrunId ?? summarySubrunId;
}
