import type { RuntimeEvent } from '@linnlabs/linnkit/contracts';
import {
  admitCitationSources,
  normalizeCitationWebUrl,
  type CitationSource,
  type CitationSourceResolverPort,
  type WebCitationSource,
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

function selectResolvedWebSourcesByUrl(
  urls: readonly string[],
  candidates: readonly CitationSource[],
): readonly WebCitationSource[] {
  const requestedUrls = Array.from(new Set(urls.map(normalizeCitationWebUrl)));
  const byUrl = new Map<string, WebCitationSource>();

  for (const candidate of candidates) {
    if (candidate.sourceType !== 'web') continue;
    const key = normalizeCitationWebUrl(candidate.url);
    const existing = byUrl.get(key);
    if (existing && existing.ref !== candidate.ref) {
      throw new Error(`Web citation URL ${key} 对应了不同的 ref。`);
    }
    if (!existing) byUrl.set(key, candidate);
  }

  const uniqueCandidates = Array.from(byUrl.values());
  if (uniqueCandidates.length > 0) {
    admitCitationSources({
      requestedRefs: uniqueCandidates.map(source => source.ref),
      candidates: uniqueCandidates,
    });
  }

  return requestedUrls.flatMap(url => {
    const source = byUrl.get(url);
    return source ? [source] : [];
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
    async resolveSourcesByUrl(urls) {
      const normalizedUrls = Array.from(new Set(urls.map(normalizeCitationWebUrl)));
      if (normalizedUrls.length === 0) return [];
      const historySources = collectCitationSourcesFromHistory({
        events: dependencies.events,
        requestedUrls: normalizedUrls,
      });
      return selectResolvedWebSourcesByUrl(normalizedUrls, historySources);
    },
  };
}
