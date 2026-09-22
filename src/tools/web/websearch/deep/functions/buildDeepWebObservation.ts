import type { DeepWebMaterials } from '@app/schemas';
import { buildWebSearchObservation } from '../../functions/buildWebSearchObservation';
import {
  createBoundaryToken,
  wrapUntrustedWebContent,
} from '../../../shared/observation/untrustedWebContent';

export function buildDeepWebObservation(query: string, materials: DeepWebMaterials): string {
  const text = buildWebSearchObservation({
    query,
    results: materials.sources.map(s => ({
      ref: s.citation.ref,
      index: s.citation.index,
      url: s.citation.url,
      title: s.citation.docTitle,
      snippet: `Acquisition: ${s.capture_kind}; truncated=${s.truncated}; flags=${s.warnings.join(',')}\n${s.citation.snippet}\nModel assessment of relevance: ${s.purpose}`,
    })),
  });
  const notes = [
    `资料包总结（模型判断，未核验）：${materials.summary}`,
    materials.conflicts.length > 0
      ? `冲突线索（模型判断）：${materials.conflicts.join('；')}`
      : '冲突线索：未记录。',
    materials.gaps.length > 0
      ? `未解决缺口：${materials.gaps.join('；')}`
      : '未解决缺口：未记录。',
    materials.failures.length > 0
      ? `取得失败：${materials.failures
          .map(failure => `${failure.tool}/${failure.call_id}: ${failure.error}`)
          .join('；')}`
      : '取得失败：未记录。',
    materials.notes_truncated ? '组装说明曾被长度上限裁剪。' : '',
  ]
    .filter(Boolean)
    .join('\n');
  return (
    `Deep web search: selected materials, NOT a verified answer. Search calls: ${materials.search_count}; read attempts: ${materials.read_attempt_count}.\n${text}\n` +
    wrapUntrustedWebContent({ token: createBoundaryToken(notes), body: notes }).join('\n')
  );
}
