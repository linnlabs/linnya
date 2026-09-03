import {
  type SubrunBatchArgs,
  type SubrunBatchStructuredResult,
  type SubrunBatchResultItem,
  type SubrunBatchItem,
} from '@app/schemas';
import type {
  SubrunCollectionItem,
  SubrunCollectionItemStatus,
} from '../definitions/subrunCollection';

function resolveOrderedSubrunIds(params: {
  readonly subruns: readonly SubrunBatchItem[];
  readonly resultIds: readonly string[] | undefined;
}): string[] {
  if (params.resultIds) return [...params.resultIds];
  // Host forced-tool 的 decision 已携带完整 subruns；开始时就应画出全部 loading 行。
  return params.subruns.map((subrun) => subrun.subrun_id);
}

function resolveItemStatus(
  parentStatus: SubrunCollectionItemStatus,
  result: SubrunBatchResultItem | undefined,
): SubrunCollectionItemStatus {
  if (!result) return parentStatus;
  return result.status === 'completed' ? 'success' : 'error';
}

export function buildSubrunBatchCollectionItems(params: {
  readonly args: SubrunBatchArgs;
  readonly result?: SubrunBatchStructuredResult;
  readonly parentStatus: SubrunCollectionItemStatus;
}): SubrunCollectionItem[] {
  const subruns = params.args.subruns;
  const results = params.result?.data.results ?? [];
  const subrunsById = new Map(subruns.map((subrun) => [subrun.subrun_id, subrun]));
  const resultsBySubrunId = new Map(results.map((result) => [result.subrun_id, result]));
  if (params.result) {
    if (results.length !== subruns.length) {
      throw new Error(
        `[SUBRUN_BATCH_IDENTITY_CONFLICT] decision=${subruns.length}, result=${results.length}`,
      );
    }
    for (const result of results) {
      const requested = subrunsById.get(result.subrun_id);
      if (!requested || requested.unit_id !== result.unit_id) {
        throw new Error(
          `[SUBRUN_BATCH_IDENTITY_CONFLICT] result references unknown subrun ${result.subrun_id}`,
        );
      }
    }
  }
  const orderedSubrunIds = resolveOrderedSubrunIds({
    subruns,
    resultIds: params.result?.data.subrun_ids,
  });

  return orderedSubrunIds.map((subrunId) => {
    const subrun = subrunsById.get(subrunId);
    const result = resultsBySubrunId.get(subrunId);
    const description = result?.description ?? subrun?.description;
    if (!description) {
      throw new Error(`[SUBRUN_BATCH_IDENTITY_CONFLICT] result references unknown subrun ${subrunId}`);
    }
    const status = resolveItemStatus(params.parentStatus, result);

    return {
      subrunId,
      presentation: {
        status,
        data: {
          description,
          status,
          subrunId,
        },
      },
    };
  });
}
