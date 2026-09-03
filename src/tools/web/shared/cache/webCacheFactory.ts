import path from 'node:path';
import { pathManager } from '../../../../shared/utils/pathManager';
import type { WebReadLadderResult } from '../../webread/definitions/readLadder';
import type { WebEvidenceWriter } from '../ports/webEvidenceWriter';
import type { WebSearchResult } from '../../websearch/providers/types';
import { FileWebCache } from './adapters/fileWebCache';
import { InFlightRequestCoalescer } from './orchestration/InFlightRequestCoalescer';
import type { WebCachePort } from './ports/webCache';

export interface WebCacheRuntime {
  cache: WebCachePort;
  searchRequests: InFlightRequestCoalescer<WebSearchResult[]>;
  documentRequests: InFlightRequestCoalescer<WebReadLadderResult>;
  evidenceWrites: InFlightRequestCoalescer<Awaited<ReturnType<WebEvidenceWriter['save']>>>;
}

const runtimes = new Map<string, WebCacheRuntime>();

export function createWebCacheRuntime(cache: WebCachePort): WebCacheRuntime {
  return {
    cache,
    searchRequests: new InFlightRequestCoalescer<WebSearchResult[]>(),
    documentRequests: new InFlightRequestCoalescer<WebReadLadderResult>(),
    evidenceWrites: new InFlightRequestCoalescer<Awaited<ReturnType<WebEvidenceWriter['save']>>>(),
  };
}

export function getWebCacheRuntime(): WebCacheRuntime {
  const rootDir = path.join(pathManager.getWorkspaceRoot(), 'WebCache', 'v1');
  let runtime = runtimes.get(rootDir);
  if (!runtime) {
    runtime = createWebCacheRuntime(new FileWebCache(rootDir));
    runtimes.set(rootDir, runtime);
  }
  return runtime;
}

