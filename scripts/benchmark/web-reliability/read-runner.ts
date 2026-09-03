import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { WebReadServiceRequest } from '../../../src/tools/web/webread/definitions/webReadService';
import { setWorkspaceRoot, resetWorkspaceRootToDefault } from '../../../src/shared/utils/pathManager';
import { resolveEvidenceFromBundles } from '../../../src/shared/artifacts/evidence/resolveEvidenceFromBundles';
import { createWebCacheRuntime } from '../../../src/tools/web/shared/cache/webCacheFactory';
import { MemoryWebCache } from '../../../src/tools/web/shared/cache/adapters/memoryWebCache';
import { getWebFailureKind } from '../../../src/tools/web/shared/webFailure';
import { runReadWebPage } from '../../../src/tools/web/webread/orchestration/readWebPage';
import { MetasoReaderProvider } from '../../../src/tools/web/webread/providers/metaso';
import { JinaReaderProvider } from '../../../src/tools/web/webread/providers/jina';
import type { WebReadProvider } from '../../../src/tools/web/webread/providers/types';
import { WEB_READ_RELIABILITY_CASES, type WebReadReliabilityCase } from './read-cases';
import { evaluateReadQuality } from './read-evaluation';

type ManagedRoute = 'metaso' | 'jina_direct' | 'jina_browser';

interface RunnerOptions {
  routes: ManagedRoute[];
  rounds: number;
  minSuccessRate: number;
}

interface ReadAttemptReport {
  managedRoute: ManagedRoute;
  selectedProvider: string;
  caseId: string;
  language: 'zh' | 'en';
  category: WebReadReliabilityCase['category'];
  round: number;
  success: boolean;
  expectedTerminal: boolean;
  failureKind?: string;
  escalated: boolean;
  escalationReason?: string;
  tookMs: number;
  charCount: number;
  hasTitle: boolean;
  codeBlockPreserved: boolean;
  tablePreserved: boolean;
  evidenceResolved: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readPositiveInteger(args: string[], name: string, fallback: number): number {
  const index = args.indexOf(name);
  const parsed = Number(index >= 0 ? args[index + 1] : undefined);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readRate(args: string[], name: string, fallback: number): number {
  const index = args.indexOf(name);
  const parsed = Number(index >= 0 ? args[index + 1] : undefined);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 1 ? parsed : fallback;
}

function parseOptions(args: string[]): RunnerOptions {
  const managedIndex = args.indexOf('--managed');
  const managed = managedIndex >= 0 ? args[managedIndex + 1] : 'metaso';
  const routes: ManagedRoute[] = managed === 'all'
    ? ['metaso', 'jina_direct', 'jina_browser']
    : managed === 'metaso' || managed === 'jina_direct' || managed === 'jina_browser'
      ? [managed]
      : [];
  if (routes.length === 0) {
    throw new Error('--managed 只支持 metaso、jina_direct、jina_browser 或 all。');
  }
  return {
    routes,
    rounds: readPositiveInteger(args, '--rounds', 1),
    minSuccessRate: readRate(args, '--min-success-rate', 0.95),
  };
}

function createConfig(params: {
  serviceId: WebReadServiceRequest['serviceId'];
  apiBase: string;
  apiKey: string;
}): WebReadServiceRequest {
  return {
    serviceId: params.serviceId,
    baseUrl: params.apiBase,
    apiKey: params.apiKey,
  };
}

function requireKey(name: 'METASO_READER_API_KEY' | 'JINA_API_KEY'): string {
  const value = process.env[name]?.trim() ?? '';
  if (!value) throw new Error(`缺少 ${name}，无法运行所选托管升级路线。`);
  return value;
}

function createManagedProvider(route: ManagedRoute): WebReadProvider {
  if (route === 'metaso') {
    return new MetasoReaderProvider(createConfig({
      serviceId: 'metaso_reader',
      apiBase: process.env['METASO_READER_API_BASE']?.trim() || 'https://metaso.cn/api/v1',
      apiKey: requireKey('METASO_READER_API_KEY'),
    }));
  }
  return new JinaReaderProvider(createConfig({
    serviceId: 'jina_reader',
    apiBase: process.env['JINA_API_BASE']?.trim() || 'https://r.jina.ai',
    apiKey: requireKey('JINA_API_KEY'),
  }), { engine: route === 'jina_browser' ? 'browser' : 'direct' });
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`读取结果缺少字符串字段 ${key}`);
  }
  return value;
}

async function readEvidenceFromToolOutput(params: {
  output: string;
  conversationId: string;
  instanceId: string;
}): Promise<{
  title: string;
  content: string;
  selectedProvider: string;
  escalated: boolean;
  escalationReason?: string;
}> {
  const parsed: unknown = JSON.parse(params.output);
  if (!isRecord(parsed) || !isRecord(parsed['data'])) throw new Error('读取工具结果缺少 data');
  const data = parsed['data'];
  if (!isRecord(data['citations']) || !Array.isArray(data['citations']['citations'])) {
    throw new Error('读取工具结果缺少 citations');
  }
  const firstCitation = data['citations']['citations'].find(isRecord);
  if (!firstCitation) throw new Error('读取工具结果没有可回放 citation');
  const ref = readString(firstCitation, 'ref');
  const evidence = await resolveEvidenceFromBundles({
    conversationId: params.conversationId,
    instanceId: params.instanceId,
    refs: [ref],
    max_units: 50_000,
    max_chars: 50_000,
  });
  const resolved = evidence.resolved[ref];
  if (!resolved || evidence.missing_refs.length > 0) throw new Error('读取结果对应的 Evidence 不可回放');
  const escalationReason = typeof data['escalationReason'] === 'string' ? data['escalationReason'] : undefined;
  return {
    title: readString(data, 'title'),
    content: resolved.text,
    selectedProvider: readString(data, 'provider'),
    escalated: data['escalated'] === true,
    ...(escalationReason ? { escalationReason } : {}),
  };
}

async function runRoute(params: {
  route: ManagedRoute;
  managedProvider: WebReadProvider;
  caseDefinition: WebReadReliabilityCase;
  round: number;
}): Promise<ReadAttemptReport> {
  const startedAt = Date.now();
  const conversationId = `web_read_live_${params.route}_${params.round}_${params.caseDefinition.id}`;
  const instanceId = 'benchmark';
  try {
    const output = await runReadWebPage(
      { url: params.caseDefinition.url, maxChars: 50_000 },
      {
        conversationId,
        turnId: `round_${params.round}`,
        research: { instanceId },
      },
      {
        // 普通 Node runner 没有 Electron 渲染 port；本脚本只比较 HTTP → 托管路线。
        renderProvider: null,
        managedProvider: params.managedProvider,
        cacheRuntime: createWebCacheRuntime(new MemoryWebCache()),
      },
    );
    if (params.caseDefinition.expectedFailureKind) {
      return {
        managedRoute: params.route,
        selectedProvider: 'unexpected_success',
        caseId: params.caseDefinition.id,
        language: params.caseDefinition.language,
        category: params.caseDefinition.category,
        round: params.round,
        success: false,
        expectedTerminal: true,
        failureKind: 'expected_terminal_not_returned',
        escalated: false,
        tookMs: Date.now() - startedAt,
        charCount: 0,
        hasTitle: false,
        codeBlockPreserved: false,
        tablePreserved: false,
        evidenceResolved: false,
      };
    }

    const readResult = await readEvidenceFromToolOutput({ output, conversationId, instanceId });
    const quality = evaluateReadQuality(params.caseDefinition, readResult);
    return {
      managedRoute: params.route,
      selectedProvider: readResult.selectedProvider,
      caseId: params.caseDefinition.id,
      language: params.caseDefinition.language,
      category: params.caseDefinition.category,
      round: params.round,
      success: quality.success,
      expectedTerminal: false,
      ...(quality.failureKind ? { failureKind: quality.failureKind } : {}),
      escalated: readResult.escalated,
      ...(readResult.escalationReason ? { escalationReason: readResult.escalationReason } : {}),
      tookMs: Date.now() - startedAt,
      charCount: quality.charCount,
      hasTitle: quality.hasTitle,
      codeBlockPreserved: quality.codeBlockPreserved,
      tablePreserved: quality.tablePreserved,
      evidenceResolved: true,
    };
  } catch (error: unknown) {
    const failureKind = getWebFailureKind(error);
    const expectedTerminal = params.caseDefinition.expectedFailureKind === failureKind;
    return {
      managedRoute: params.route,
      selectedProvider: expectedTerminal ? 'local_http' : 'none',
      caseId: params.caseDefinition.id,
      language: params.caseDefinition.language,
      category: params.caseDefinition.category,
      round: params.round,
      success: expectedTerminal,
      expectedTerminal,
      failureKind,
      escalated: false,
      tookMs: Date.now() - startedAt,
      charCount: 0,
      hasTitle: false,
      codeBlockPreserved: false,
      tablePreserved: false,
      evidenceResolved: false,
    };
  }
}

function percentile(values: number[], value: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * value) - 1)];
}

function renderReport(attempts: ReadAttemptReport[], minSuccessRate: number): string {
  const lines = ['# Web Read Production-Ladder Compatibility Report', ''];
  for (const route of [...new Set(attempts.map((attempt) => attempt.managedRoute))]) {
    const routeAttempts = attempts.filter((attempt) => attempt.managedRoute === route);
    const successes = routeAttempts.filter((attempt) => attempt.success).length;
    const escalations = routeAttempts.filter((attempt) => attempt.escalated).length;
    const contentAttempts = routeAttempts.filter((attempt) => !attempt.expectedTerminal);
    const evidenceResolved = contentAttempts.filter((attempt) => attempt.evidenceResolved).length;
    const latencies = routeAttempts.map((attempt) => attempt.tookMs);
    const observedRate = routeAttempts.length > 0 ? successes / routeAttempts.length : 0;
    lines.push(`## local_http -> ${route}`);
    lines.push('');
    lines.push(`- contract success: ${successes}/${routeAttempts.length} (${(observedRate * 100).toFixed(2)}%)`);
    lines.push(`- compatibility threshold: ${(minSuccessRate * 100).toFixed(2)}% (${observedRate >= minSuccessRate ? 'PASS' : 'FAIL'})`);
    lines.push('- statistical SLO: not claimed; this is a real-site compatibility sample');
    lines.push(`- managed escalations: ${escalations}/${routeAttempts.length}`);
    lines.push(`- Evidence replay: ${evidenceResolved}/${contentAttempts.length} content responses`);
    lines.push(`- latency p50/p95: ${percentile(latencies, 0.5)}ms / ${percentile(latencies, 0.95)}ms`);
    for (const category of [...new Set(routeAttempts.map((attempt) => attempt.category))].sort()) {
      const categoryAttempts = routeAttempts.filter((attempt) => attempt.category === category);
      const categorySuccesses = categoryAttempts.filter((attempt) => attempt.success).length;
      lines.push(`- ${category}: ${categorySuccesses}/${categoryAttempts.length}`);
    }
    lines.push('');
  }
  lines.push('PDF 用例验证当前 unsupported_mime 稳定终态；成功不代表已解析 PDF。');
  return lines.join('\n');
}

async function main(): Promise<void> {
  if (process.env['WEB_LIVE_TEST'] !== '1') {
    console.error('WEB_LIVE_TEST 未设为 1，生产读取阶梯评估未执行。');
    process.exitCode = 2;
    return;
  }
  const options = parseOptions(process.argv.slice(2));
  const providers = new Map<ManagedRoute, WebReadProvider>(
    options.routes.map((route) => [route, createManagedProvider(route)]),
  );
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'linnya_web_read_live_'));
  const attempts: ReadAttemptReport[] = [];
  setWorkspaceRoot(tempRoot);
  try {
    for (let round = 1; round <= options.rounds; round += 1) {
      for (const caseDefinition of WEB_READ_RELIABILITY_CASES) {
        for (const route of options.routes) {
          const managedProvider = providers.get(route);
          if (!managedProvider) throw new Error(`未创建托管 Provider: ${route}`);
          const attempt = await runRoute({ route, managedProvider, caseDefinition, round });
          attempts.push(attempt);
          console.log(JSON.stringify(attempt));
        }
      }
    }
  } finally {
    resetWorkspaceRootToDefault();
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }

  console.log(renderReport(attempts, options.minSuccessRate));
  const routePassed = options.routes.every((route) => {
    const routeAttempts = attempts.filter((attempt) => attempt.managedRoute === route);
    const observedRate = routeAttempts.filter((attempt) => attempt.success).length / routeAttempts.length;
    return observedRate >= options.minSuccessRate;
  });
  if (!routePassed) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Web 生产读取阶梯评估失败。');
  process.exitCode = 2;
});
