import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { WebSearchServiceRequest } from '../../../src/tools/web/websearch/definitions/webSearchService';
import { setWorkspaceRoot, resetWorkspaceRootToDefault } from '../../../src/shared/utils/pathManager';
import { resolveEvidenceFromBundles } from '../../../src/shared/artifacts/evidence/resolveEvidenceFromBundles';
import { WebSearchTool } from '../../../src/tools/web/websearch/WebSearchTool';
import { BaiduQianfanProvider } from '../../../src/tools/web/websearch/providers/baiduQianfan';
import { SerperProvider } from '../../../src/tools/web/websearch/providers/serper';
import type { WebSearchProvider } from '../../../src/tools/web/websearch/providers/types';
import { getWebFailureKind } from '../../../src/tools/web/shared/webFailure';
import { WEB_RELIABILITY_CASES, type WebReliabilityCase } from './cases';
import {
  renderReliabilityReport,
  summarizeLiveSmoke,
  type LiveReliabilityAttemptReport,
} from './report';

interface RunnerOptions {
  provider: 'baidu_qianfan' | 'serper';
  rounds: number;
  roundDelayMs: number;
  minSuccessRate: number;
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readRate(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 1 ? parsed : fallback;
}

function parseOptions(args: string[]): RunnerOptions {
  const readArg = (name: string): string | undefined => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const providerRaw = readArg('--provider') ?? 'baidu_qianfan';
  if (providerRaw !== 'baidu_qianfan' && providerRaw !== 'serper') {
    throw new Error('--provider 只支持 baidu_qianfan 或 serper。');
  }
  return {
    provider: providerRaw,
    rounds: readPositiveInteger(readArg('--rounds'), 1),
    roundDelayMs: readPositiveInteger(readArg('--round-delay-ms'), 60_000),
    minSuccessRate: readRate(readArg('--min-success-rate'), 0.95),
  };
}

function createConfig(provider: RunnerOptions['provider']): WebSearchServiceRequest {
  const isBaidu = provider === 'baidu_qianfan';
  const keyName = isBaidu ? 'BAIDU_SEARCH_API_KEY' : 'SERPER_API_KEY';
  const apiKey = process.env[keyName]?.trim() ?? '';
  if (!apiKey) throw new Error(`缺少 ${keyName}，live benchmark 未执行。`);
  return {
    serviceId: provider,
    baseUrl: isBaidu
      ? (process.env['BAIDU_SEARCH_API_BASE']?.trim() || 'https://qianfan.baidubce.com/v2')
      : (process.env['SERPER_API_BASE']?.trim() || 'https://google.serper.dev'),
    apiKey,
  };
}

function createProvider(options: RunnerOptions): WebSearchProvider {
  const config = createConfig(options.provider);
  return options.provider === 'baidu_qianfan'
    ? new BaiduQianfanProvider(config)
    : new SerperProvider(config);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readCitations(output: string): Array<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(output);
  if (!isRecord(parsed) || !isRecord(parsed['data']) || !isRecord(parsed['data']['citations'])) return [];
  const citations = parsed['data']['citations']['citations'];
  return Array.isArray(citations) ? citations.filter(isRecord) : [];
}

function matchesQuality(caseDefinition: WebReliabilityCase, citations: Array<Record<string, unknown>>): boolean {
  if (citations.length < caseDefinition.minResults) return false;
  const urls = citations.map((citation) => typeof citation['url'] === 'string' ? citation['url'] : '');
  if (urls.some((url) => !/^https?:\/\//i.test(url)) || new Set(urls).size !== urls.length) return false;

  if (caseDefinition.requiredAnyDomain) {
    const hosts = urls.flatMap((url) => {
      try { return [new URL(url).hostname.toLowerCase()]; } catch { return []; }
    });
    if (!caseDefinition.requiredAnyDomain.some((domain) => hosts.some((host) => host === domain || host.endsWith(`.${domain}`)))) {
      return false;
    }
  }
  if (caseDefinition.requiredAnyKeyword) {
    const text = citations.map((citation) => `${citation['docTitle'] ?? ''} ${citation['snippet'] ?? ''}`).join(' ').toLowerCase();
    if (!caseDefinition.requiredAnyKeyword.some((keyword) => text.includes(keyword.toLowerCase()))) return false;
  }
  return true;
}

function readErrorStatus(error: unknown): number | undefined {
  return isRecord(error) && typeof error['status'] === 'number' ? error['status'] : undefined;
}

async function executeAttempt(params: {
  provider: WebSearchProvider;
  providerId: string;
  caseDefinition: WebReliabilityCase;
  round: number;
}): Promise<LiveReliabilityAttemptReport> {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const conversationId = `web_live_${params.round}_${params.caseDefinition.id}`;
  const instanceId = 'benchmark';
  let resultCount = 0;

  try {
    const output = await new WebSearchTool({ provider: params.provider }).run({
      query: params.caseDefinition.query,
      top_k: 10,
      recency_days: params.caseDefinition.recencyDays,
    }, {
      conversationId,
      turnId: `round_${params.round}`,
      research: { instanceId },
    });
    const citations = readCitations(output);
    resultCount = citations.length;
    const refs = citations.flatMap((citation) => typeof citation['ref'] === 'string' ? [citation['ref']] : []);
    const evidence = await resolveEvidenceFromBundles({
      conversationId,
      instanceId,
      refs,
      max_units: 1,
      max_chars: 10,
    });
    const success =
      Date.now() - startedMs <= 30_000 &&
      refs.length === citations.length &&
      evidence.missing_refs.length === 0 &&
      matchesQuality(params.caseDefinition, citations);
    return {
      provider: params.providerId,
      caseId: params.caseDefinition.id,
      round: params.round,
      startedAt,
      eligible: true,
      success,
      ...(success ? {} : { failureKind: 'quality_or_evidence' }),
      resultCount,
      tookMs: Date.now() - startedMs,
    };
  } catch (error: unknown) {
    return {
      provider: params.providerId,
      caseId: params.caseDefinition.id,
      round: params.round,
      startedAt,
      eligible: true,
      success: false,
      failureKind: getWebFailureKind(error),
      ...(readErrorStatus(error) !== undefined ? { httpStatus: readErrorStatus(error) } : {}),
      resultCount,
      tookMs: Date.now() - startedMs,
    };
  }
}

async function main(): Promise<void> {
  if (process.env['WEB_LIVE_TEST'] !== '1') {
    console.error('WEB_LIVE_TEST 未设为 1，live benchmark 未执行。');
    process.exitCode = 2;
    return;
  }

  const options = parseOptions(process.argv.slice(2));
  const provider = createProvider(options);
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya_web_live_'));
  const attempts: LiveReliabilityAttemptReport[] = [];
  setWorkspaceRoot(tempRoot);
  try {
    for (let round = 1; round <= options.rounds; round += 1) {
      for (const caseDefinition of WEB_RELIABILITY_CASES) {
        const attempt = await executeAttempt({ provider, providerId: options.provider, caseDefinition, round });
        attempts.push(attempt);
        console.log(JSON.stringify(attempt));
      }
      if (round < options.rounds) {
        await new Promise<void>((resolve) => setTimeout(resolve, options.roundDelayMs));
      }
    }
  } finally {
    resetWorkspaceRootToDefault();
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }

  const summary = summarizeLiveSmoke(attempts, options.minSuccessRate);
  console.log(renderReliabilityReport(attempts, summary));
  if (!summary.passed) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Web live benchmark 执行失败。');
  process.exitCode = 2;
});
