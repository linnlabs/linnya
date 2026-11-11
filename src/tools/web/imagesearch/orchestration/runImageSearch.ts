import { Logger } from '@shared/logger';
import {
  IMAGE_SEARCH_DEFAULT_RESULTS,
  IMAGE_SEARCH_SOURCES,
  ImageSearchResultSchema,
  type ImageSearchArgs,
  type ImageSearchCandidate,
  type ImageSearchSource,
  type ImageSearchSourceStatus,
} from '@app/schemas';
import type { ToolContext } from '../../../types';
import { searchCommonsImages } from '../../../../infra/adapters/image-search/commonsImageSearchAdapter';
import { OPENVERSE_MAX_PAGE_SIZE, searchOpenverseImages } from '../../../../infra/adapters/image-search/openverseImageSearchAdapter';
import { getWebFailureKind, WebFailureError } from '../../shared/webFailure';
import { getImageSourceRegistry, type ImageSourceRegistry } from '../../shared/images/imageSourceRegistry';
import { commonsCandidate, openverseCandidate, type ImageCandidateDraft } from '../functions/toImageCandidates';
import { buildImageSearchObservation } from '../functions/buildImageSearchObservation';

const logger = new Logger('ImageSearch');

export interface ImageSearchDependencies {
  searchCommons?: typeof searchCommonsImages;
  searchOpenverse?: typeof searchOpenverseImages;
  imageSources?: ImageSourceRegistry;
}

/** 两个来源轮流取，避免一个来源占满名额；同一原图只留一次。 */
function interleave(lists: readonly (readonly ImageCandidateDraft[])[], limit: number): ImageCandidateDraft[] {
  const merged: ImageCandidateDraft[] = [];
  const seen = new Set<string>();
  for (let index = 0; merged.length < limit && lists.some(list => index < list.length); index += 1) {
    for (const list of lists) {
      const candidate = list[index];
      if (!candidate || seen.has(candidate.image_url)) continue;
      seen.add(candidate.image_url);
      merged.push(candidate);
      if (merged.length >= limit) break;
    }
  }
  return merged;
}

export async function runImageSearch(
  args: ImageSearchArgs,
  context: Pick<ToolContext, 'abortSignal'>,
  dependencies: ImageSearchDependencies = {},
): Promise<string> {
  const limit = args.max_results ?? IMAGE_SEARCH_DEFAULT_RESULTS;
  const commercialOnly = args.commercial_only ?? false;
  const sources: readonly ImageSearchSource[] = args.source ? [args.source] : IMAGE_SEARCH_SOURCES;
  const startedAt = Date.now();
  const signal = context.abortSignal;

  const keep = (draft: ImageCandidateDraft | undefined): draft is ImageCandidateDraft =>
    draft !== undefined && (!commercialOnly || draft.license.commercial_use);
  const outcomes = await Promise.all(sources.map(async (source): Promise<{
    source: ImageSearchSource; candidates: ImageCandidateDraft[]; error?: unknown;
  }> => {
    try {
      if (source === 'wikimedia_commons') {
        // 多取一些：部分文件不是可下载位图，或许可不符合筛选。
        const { items } = await (dependencies.searchCommons ?? searchCommonsImages)({
          query: args.query, limit: Math.min(50, limit * 2), ...(signal ? { signal } : {}),
        });
        return { source, candidates: items.map(commonsCandidate).filter(keep) };
      }
      const { items } = await (dependencies.searchOpenverse ?? searchOpenverseImages)({
        query: args.query,
        pageSize: OPENVERSE_MAX_PAGE_SIZE,
        commercialOnly,
        // Commons 同时查询时由它直接提供，Openverse 里的 Wikimedia 镜像不再重复。
        ...(sources.includes('wikimedia_commons') ? { excludeSources: ['wikimedia'] } : {}),
        ...(signal ? { signal } : {}),
      });
      return { source, candidates: items.map(openverseCandidate).filter(keep) };
    } catch (error) {
      signal?.throwIfAborted();
      return { source, candidates: [], error };
    }
  }));

  if (outcomes.every(outcome => outcome.error !== undefined)) {
    const first = outcomes[0]!.error;
    logger.error('[runImageSearch] 全部来源失败', {
      operation: 'image_search', outcome: 'error', failureKind: getWebFailureKind(first), tookMs: Date.now() - startedAt,
    });
    throw new WebFailureError(
      getWebFailureKind(first),
      `[IMAGE_SEARCH_FAILED] 图片搜索的来源都没有返回结果：${outcomes
        .map(outcome => `${outcome.source}=${getWebFailureKind(outcome.error)}`).join(', ')}。可以稍后再试，或用 web_search 找原件所在网站后用 web_read 读取页面图片。`,
      { cause: first },
    );
  }

  const candidates: ImageSearchCandidate[] = interleave(outcomes.map(outcome => outcome.candidates), limit)
    .map((draft, index) => ({ id: `c${index + 1}`, ...draft }));
  const statuses: ImageSearchSourceStatus[] = outcomes.map(outcome => ({
    source: outcome.source,
    status: outcome.error === undefined ? 'ok' : 'failed',
    result_count: candidates.filter(candidate => candidate.source === outcome.source).length,
    ...(outcome.error !== undefined ? { error_kind: getWebFailureKind(outcome.error) } : {}),
  }));

  const registry = dependencies.imageSources ?? getImageSourceRegistry();
  for (const candidate of candidates) {
    const record = {
      foundVia: 'image_search' as const,
      pageUrl: candidate.page_url,
      provider: candidate.provider,
      title: candidate.title,
      ...(candidate.creator ? { creator: candidate.creator } : {}),
      license: candidate.license,
      attribution: candidate.attribution,
    };
    registry.remember(candidate.download_url, record);
    registry.remember(candidate.image_url, record);
  }

  logger.info('[runImageSearch] 完成', {
    operation: 'image_search',
    outcome: 'success',
    sources: statuses.map(status => `${status.source}:${status.status}:${status.result_count}`).join(','),
    resultCount: candidates.length,
    tookMs: Date.now() - startedAt,
  });

  return JSON.stringify(ImageSearchResultSchema.parse({
    data: { query: args.query, commercial_only: commercialOnly, candidates, sources: statuses },
    observation: buildImageSearchObservation({ query: args.query, commercialOnly, candidates, sources: statuses }),
  }));
}
