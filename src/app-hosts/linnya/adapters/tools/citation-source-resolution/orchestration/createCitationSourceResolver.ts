import type { RuntimeEvent } from 'linnkit/contracts';
import {
  admitCitationSources,
  type CitationSource,
  type CitationSourceResolverPort,
} from 'src/domains/citation';
import type { ResolveEvidenceResult } from 'src/domains/evidence';
import { collectCitationSourcesFromHistory } from '../functions/collectCitationSourcesFromHistory';

export interface CitationSourceResolverDependencies {
  readonly events: readonly RuntimeEvent[];
  readonly resolveEvidence: (refs: readonly string[]) => Promise<ResolveEvidenceResult>;
}

function projectEvidenceSource(
  item: ResolveEvidenceResult['resolved'][string]
): CitationSource {
  if (item.source_type === 'knowledge_base') {
    if (!item.doc_id || !item.block_id) {
      throw new Error(`Evidence citation ${item.ref} 缺少 Knowledge 来源锚点。`);
    }
    return {
      sourceType: item.source_type,
      ref: item.ref,
      docId: item.doc_id,
      blockId: item.block_id,
      title: item.title,
      snippet: item.snippet || item.text,
    };
  }
  if (!item.url) {
    throw new Error(`Evidence citation ${item.ref} 缺少 Web canonical URL。`);
  }
  return {
    sourceType: item.source_type,
    ref: item.ref,
    url: item.url,
    title: item.title,
    snippet: item.snippet || item.text,
    ...(item.site_name ? { containerTitle: item.site_name } : {}),
    ...(item.published_at ? { publishedAt: item.published_at } : {}),
  };
}

function selectResolvedSources(
  refs: readonly string[],
  admitted: Readonly<Record<string, CitationSource>>,
): readonly CitationSource[] {
  return refs.map(ref => {
    const source = admitted[ref];
    if (!source) {
      throw new Error(`Citation source resolver 内部缺少已接纳来源 ${ref}。`);
    }
    return source;
  });
}

export function createCitationSourceResolver(
  dependencies: CitationSourceResolverDependencies
): CitationSourceResolverPort {
  return {
    async resolveSources(refs) {
      const historySources = collectCitationSourcesFromHistory({
        events: dependencies.events,
        requestedRefs: refs,
      });
      const resolvedFromHistory = new Set(historySources.map(source => source.ref));
      const missingRefs = refs.filter(ref => !resolvedFromHistory.has(ref));
      if (missingRefs.length === 0) {
        const admitted = admitCitationSources({ requestedRefs: refs, candidates: historySources });
        return selectResolvedSources(refs, admitted);
      }

      const evidence = await dependencies.resolveEvidence(missingRefs);
      const conflictRefs = evidence.conflicts
        .map(conflict => conflict.ref)
        .filter(ref => missingRefs.includes(ref));
      if (conflictRefs.length > 0) {
        throw new Error(
          `EvidenceStore 中存在冲突引用：${conflictRefs.map(ref => `[@${ref}]`).join(', ')}。`
        );
      }
      const incompleteRefs = evidence.incomplete_refs
        .map(issue => issue.ref)
        .filter(ref => missingRefs.includes(ref));
      if (incompleteRefs.length > 0) {
        throw new Error(
          `EvidenceStore 中存在不完整引用：${incompleteRefs.map(ref => `[@${ref}]`).join(', ')}。`
        );
      }

      const evidenceSources = missingRefs.flatMap(ref => {
        const item = evidence.resolved[ref];
        return item ? [projectEvidenceSource(item)] : [];
      });
      const admitted = admitCitationSources({
        requestedRefs: refs,
        candidates: [...historySources, ...evidenceSources],
      });
      return selectResolvedSources(refs, admitted);
    },
  };
}
