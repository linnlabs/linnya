import type { DeepWebMaterials } from '@app/schemas';
import { buildWebSearchObservation } from '../../functions/buildWebSearchObservation';
import {
  createBoundaryToken,
  wrapUntrustedWebContent,
} from '../../../shared/observation/untrustedWebContent';

type Source = DeepWebMaterials['sources'][number];

/** 摘录是怎么来的：按子 Agent 的原话定位，还是没定位到而退回开头。 */
function describeExcerpts(source: Source): string {
  if (!source.excerpts) return 'Excerpt: start of the source (up to 800 characters).';
  const unmatched = source.unmatched_anchors ?? [];
  const missed = unmatched.length
    ? ` The child's quoted phrase${unmatched.length > 1 ? 's' : ''} ${unmatched.map(anchor => JSON.stringify(anchor)).join(', ')} ${unmatched.length > 1 ? 'were' : 'was'} not found in the text it read; treat the relevance note with care.`
    : '';
  // 全部按定位截取时不逐源重复说明（页头已说明），只在有异常时写一行。
  if (source.excerpts.some(excerpt => excerpt.located === 'anchor')) return missed.trim();
  if (source.excerpts.length === 0) return `Excerpt: none (no text was read).${missed}`;
  return `Excerpt: start of the text read, not located at the relevant passage.${missed}`;
}

export function buildDeepWebObservation(query: string, materials: DeepWebMaterials): string {
  const text = buildWebSearchObservation({
    query,
    results: materials.sources.map(s => ({
      ref: s.citation.ref,
      index: s.citation.index,
      url: s.citation.url,
      title: s.citation.docTitle,
      snippet: [
        `Acquisition: ${s.capture_kind}; flags=${s.warnings.join(',')}`,
        ...(s.acquired_range ? [`Read by the child: ${s.acquired_range}`] : [`source_read_truncated=${s.truncated}`]),
        describeExcerpts(s),
        s.citation.snippet,
        `Model assessment of relevance: ${s.purpose}`,
      ].filter(Boolean).join('\n'),
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
    `Deep web search: selected materials, NOT a verified answer. Each source carries up to two original excerpts that the tool cut from the text the child actually read, at phrases the child quoted and checked against that text; they are not the full body. A source note says so when its excerpt is only the start of the text or a quoted phrase was not found. 'Read by the child' states which parts of the source were read. file_download means an original file was acquired, not parsed. Use web_read (offset/find/pages) on selected URLs to check decisive evidence and qualifications before drawing conclusions. Search calls: ${materials.search_count}; read attempts: ${materials.read_attempt_count}.\n${text}\n` +
    wrapUntrustedWebContent({ token: createBoundaryToken(notes), body: notes }).join('\n')
  );
}
