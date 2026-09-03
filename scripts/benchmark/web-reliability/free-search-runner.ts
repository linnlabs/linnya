import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { getWebFailureKind } from '../../../src/tools/web/shared/webFailure';
import { DuckDuckGoProvider } from '../../../src/tools/web/websearch/providers/duckDuckGo';
import { ParallelFreeProvider } from '../../../src/tools/web/websearch/providers/parallelFree';
import type { WebSearchProvider, WebSearchResult } from '../../../src/tools/web/websearch/providers/types';
import { WEB_RELIABILITY_CASES } from './cases';
import {
  renderFreeSearchReport,
  summarizeFreeSearchAttempts,
  type FreeSearchAttempt,
  type FreeSearchProviderId,
} from './free-search-evaluation';

interface RunnerOptions {
  providers: FreeSearchProviderId[];
  limit: number;
  delayMs: number;
  outputPath: string;
}

function readInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseOptions(args: string[]): RunnerOptions {
  const readArg = (name: string): string | undefined => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const providerArg = readArg('--providers') ?? 'parallel_free,duckduckgo';
  const providers = providerArg.split(',').filter((value): value is FreeSearchProviderId =>
    value === 'parallel_free' || value === 'duckduckgo');
  if (providers.length === 0) throw new Error('--providers 至少包含 parallel_free 或 duckduckgo。');
  const limit = Math.min(WEB_RELIABILITY_CASES.length, readInteger(readArg('--limit'), 40));
  if (limit < 1) throw new Error('--limit 必须大于 0。');
  return {
    providers,
    limit,
    delayMs: readInteger(readArg('--delay-ms'), 1_000),
    outputPath: readArg('--output')
      ?? path.resolve(process.cwd(), 'src/tools/web/docs/free-search-benchmark-2026-07-19.md'),
  };
}

function createProvider(id: FreeSearchProviderId): WebSearchProvider {
  return id === 'parallel_free' ? new ParallelFreeProvider() : new DuckDuckGoProvider();
}

function evaluateResults(results: WebSearchResult[]): Pick<FreeSearchAttempt,
  'nonEmpty' | 'resultCount' | 'validUrlCount' | 'duplicateCount'> {
  let validUrlCount = 0;
  const canonicalUrls = new Set<string>();
  for (const result of results) {
    try {
      const url = new URL(result.canonicalUrl);
      if (url.protocol === 'http:' || url.protocol === 'https:') validUrlCount += 1;
    } catch {
      // 非法 URL 作为基准指标记录，不在 runner 内修正 Provider 结果。
    }
    canonicalUrls.add(result.canonicalUrl);
  }
  return {
    nonEmpty: results.length > 0,
    resultCount: results.length,
    validUrlCount,
    duplicateCount: results.length - canonicalUrls.size,
  };
}

async function executeAttempt(
  providerId: FreeSearchProviderId,
  provider: WebSearchProvider,
  caseDefinition: (typeof WEB_RELIABILITY_CASES)[number],
): Promise<FreeSearchAttempt> {
  const startedAt = Date.now();
  try {
    const results = await provider.search({
      query: caseDefinition.query,
      topK: 10,
      recencyDays: caseDefinition.recencyDays,
      language: caseDefinition.language,
    });
    return {
      provider: providerId,
      caseId: caseDefinition.id,
      requestSucceeded: true,
      tookMs: Date.now() - startedAt,
      ...evaluateResults(results),
    };
  } catch (error: unknown) {
    return {
      provider: providerId,
      caseId: caseDefinition.id,
      requestSucceeded: false,
      nonEmpty: false,
      resultCount: 0,
      validUrlCount: 0,
      duplicateCount: 0,
      tookMs: Date.now() - startedAt,
      failureKind: getWebFailureKind(error),
    };
  }
}

async function main(): Promise<void> {
  if (process.env['WEB_LIVE_TEST'] !== '1') {
    throw new Error('WEB_LIVE_TEST 未设为 1，免费搜索 live benchmark 未执行。');
  }
  const options = parseOptions(process.argv.slice(2));
  const providers = new Map(options.providers.map((id) => [id, createProvider(id)]));
  const attempts: FreeSearchAttempt[] = [];
  const cases = WEB_RELIABILITY_CASES.slice(0, options.limit);

  for (const caseDefinition of cases) {
    for (const providerId of options.providers) {
      const provider = providers.get(providerId);
      if (!provider) throw new Error(`未创建 Provider: ${providerId}`);
      const attempt = await executeAttempt(providerId, provider, caseDefinition);
      attempts.push(attempt);
      console.log(JSON.stringify(attempt));
      if (options.delayMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, options.delayMs));
      }
    }
  }

  const summaries = options.providers.map((provider) => summarizeFreeSearchAttempts(provider, attempts));
  const report = renderFreeSearchReport({
    generatedAt: new Date().toISOString(),
    attempts,
    summaries,
  });
  await fsp.mkdir(path.dirname(options.outputPath), { recursive: true });
  await fsp.writeFile(options.outputPath, `${report}\n`, 'utf8');
  console.log(report);
  console.log(`\n报告已写入 ${options.outputPath}`);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : '免费搜索 live benchmark 执行失败。');
  process.exitCode = 2;
});
