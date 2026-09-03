import type {
  SubrunBatchData,
  SubrunBatchResultItem,
  SubrunBatchStructuredResult,
  SubrunBatchItem,
} from '@app/schemas';
import type { SubrunBatchChildResult } from '../definitions/subrunBatchAggregation';

const DESCRIPTION_OBSERVATION_LIMIT = 80;
const RESULT_OBSERVATION_LIMIT = 800;

export function buildSubrunBatchResult(params: {
  readonly subruns: readonly SubrunBatchItem[];
  readonly childResults: readonly SubrunBatchChildResult[];
}): SubrunBatchStructuredResult {
  if (params.subruns.length === 0) {
    throw new Error('subrun_batch: subruns must not be empty');
  }
  if (params.subruns.length !== params.childResults.length) {
    throw new Error('subrun_batch: child result count does not match subrun count');
  }

  const resultsBySubrunId = new Map<string, SubrunBatchChildResult>();
  for (const childResult of params.childResults) {
    if (resultsBySubrunId.has(childResult.subrunId)) {
      throw new Error(`subrun_batch: duplicate child result for subrun ${childResult.subrunId}`);
    }
    resultsBySubrunId.set(childResult.subrunId, childResult);
  }

  const results = params.subruns.map((subrun): SubrunBatchResultItem => {
    const childResult = resultsBySubrunId.get(subrun.subrun_id);
    if (!childResult) {
      throw new Error(`subrun_batch: missing child result for subrun ${subrun.subrun_id}`);
    }
    const status = childResult.cancelled
      ? 'cancelled'
      : childResult.success
        ? 'completed'
        : 'failed';
    return {
      unit_id: subrun.unit_id,
      subrun_id: subrun.subrun_id,
      description: subrun.description,
      status,
      final_answer: childResult.finalAnswer,
      ...(childResult.error ? { error: childResult.error } : {}),
    };
  });

  const succeeded = results.filter((result) => result.status === 'completed').length;
  const failed = results.filter((result) => result.status === 'failed').length;
  const cancelled = results.filter((result) => result.status === 'cancelled').length;
  const status: SubrunBatchData['status'] = succeeded === results.length
    ? 'completed'
    : cancelled === results.length
      ? 'cancelled'
      : succeeded === 0 && failed > 0
        ? 'failed'
        : 'partial';
  const data: SubrunBatchData = {
    status,
    total: results.length,
    succeeded,
    failed,
    cancelled,
    subrun_ids: results.map((result) => result.subrun_id),
    results,
  };

  const summary = cancelled > 0
    ? `批量子任务完成：${succeeded}/${results.length} 成功，${failed} 失败，${cancelled} 取消。`
    : `批量子任务完成：${succeeded}/${results.length} 成功，${failed} 失败。`;
  const observationLines = [
    summary,
    ...results.map((result) => {
      const description = clipForObservation(result.description, DESCRIPTION_OBSERVATION_LIMIT);
      const detail = result.status === 'completed'
        ? clipForObservation(result.final_answer, RESULT_OBSERVATION_LIMIT)
        : clipForObservation(result.error ?? result.final_answer, RESULT_OBSERVATION_LIMIT);
      return `${description} | ${result.status} | ${detail}`;
    }),
  ];

  return {
    data,
    observation: observationLines.join('\n'),
  };
}

function clipForObservation(value: string, limit: number): string {
  const normalized = value.trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit - 3)}...`;
}
