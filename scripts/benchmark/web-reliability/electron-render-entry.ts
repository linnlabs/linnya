import { app } from 'electron';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  getWebFailureDiagnostics,
  getWebFailureKind,
  WebFailureError,
} from '../../../src/tools/web/shared/webFailure';
import type { WebReadLadderResult } from '../../../src/tools/web/webread/definitions/readLadder';
import { readWebPageWithLadder } from '../../../src/tools/web/webread/orchestration/readLadder';
import { readWebPdfText } from '../../../src/tools/web/webread/orchestration/readWebPdfText';
import { LocalHttpProvider } from '../../../src/tools/web/webread/providers/localHttp';
import { LocalRenderProvider } from '../../../src/tools/web/webread/providers/localRender';
import type { WebReadProvider, WebReadResult } from '../../../src/tools/web/webread/providers/types';
import { WebPageRenderWorker } from '../../../src/electron-main/web-render/WebPageRenderWorker';
import {
  WEB_READ_PHASE0_PROBE_CASES,
  WEB_READ_RELIABILITY_CASES,
  type WebReadExpectedOutcome,
  type WebReadExpectedRoute,
  type WebReadReliabilityCase,
} from './read-cases';
import {
  evaluateReadQuality,
  matchesExpectedFailureKind,
  resolveExpectedOutcome,
} from './read-evaluation';

type BenchmarkSuite = 'baseline' | 'dynamic' | 'all';

interface CliOptions {
  readonly suite: BenchmarkSuite;
  readonly dumpDir?: string;
  readonly measureMemory: boolean;
  readonly rounds: number;
}

interface ProcessMemorySnapshot {
  readonly ts: number;
  readonly byType: Record<string, { readonly count: number; readonly workingSetKb: number; readonly peakWorkingSetKb: number }>;
}

interface RenderCoverageAttempt {
  readonly round: number;
  readonly caseId: string;
  readonly url: string;
  readonly category: string;
  readonly expectedOutcome: WebReadExpectedOutcome;
  readonly expectedRoute: WebReadExpectedRoute;
  readonly routeMatched: boolean;
  readonly expectedTerminal: boolean;
  readonly contractSuccess: boolean;
  readonly contentCovered: boolean;
  readonly selectedProvider: string;
  readonly renderAttempted: boolean;
  readonly extractor?: string;
  readonly escalationReason?: string;
  readonly initialFailureKind?: string;
  readonly failureKind?: string;
  readonly failureCode?: string;
  readonly failureMessage?: string;
  readonly renderFailureKind?: string;
  readonly renderFailureMessage?: string;
  readonly resourcesCount: number;
  readonly warnings: readonly string[];
  readonly charCount: number;
  readonly renderedCharCount?: number;
  readonly renderQualityScore?: number;
  readonly renderWarnings?: readonly string[];
  readonly expectsCodeBlock: boolean;
  readonly expectsTable: boolean;
  readonly codeBlockMarkupPresent: boolean;
  readonly tableMarkupPresent: boolean;
  readonly contentChecks: { checked: number; failed: string[] };
  readonly httpMs: number;
  readonly renderMs: number;
  readonly tookMs: number;
  readonly memoryPeakKb?: Record<string, number>;
}

function parseCliOptions(argv: readonly string[]): CliOptions {
  const readValue = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    return index >= 0 ? argv[index + 1] : undefined;
  };
  const suiteRaw = readValue('--suite') ?? 'baseline';
  const suite: BenchmarkSuite =
    suiteRaw === 'dynamic' || suiteRaw === 'all' ? suiteRaw : 'baseline';
  const roundsParsed = Number(readValue('--rounds'));
  return {
    suite,
    dumpDir: readValue('--dump-dir'),
    measureMemory: argv.includes('--measure-memory'),
    rounds: Number.isInteger(roundsParsed) && roundsParsed > 0 ? roundsParsed : 1,
  };
}

function selectCases(suite: BenchmarkSuite): readonly WebReadReliabilityCase[] {
  if (suite === 'dynamic') return WEB_READ_PHASE0_PROBE_CASES;
  if (suite === 'all') return [...WEB_READ_RELIABILITY_CASES, ...WEB_READ_PHASE0_PROBE_CASES];
  return WEB_READ_RELIABILITY_CASES;
}

function snapshotAppMetrics(): ProcessMemorySnapshot {
  const byType: Record<string, { count: number; workingSetKb: number; peakWorkingSetKb: number }> = {};
  for (const metric of app.getAppMetrics()) {
    const existing = byType[metric.type] ?? { count: 0, workingSetKb: 0, peakWorkingSetKb: 0 };
    byType[metric.type] = {
      count: existing.count + 1,
      workingSetKb: existing.workingSetKb + metric.memory.workingSetSize,
      peakWorkingSetKb: existing.peakWorkingSetKb + (metric.memory.peakWorkingSetSize ?? 0),
    };
  }
  return { ts: Date.now(), byType };
}

function computePeakKb(samples: readonly ProcessMemorySnapshot[]): Record<string, number> {
  const peaks: Record<string, number> = {};
  for (const sample of samples) {
    for (const [type, stats] of Object.entries(sample.byType)) {
      peaks[type] = Math.max(peaks[type] ?? 0, stats.workingSetKb);
    }
  }
  return peaks;
}

function matchesExpectedRoute(
  expectedRoute: WebReadExpectedRoute,
  selectedProvider: string,
  renderAttempted: boolean,
): boolean {
  if (expectedRoute === 'any') return true;
  if (expectedRoute === 'local_http') return selectedProvider === 'local_http' && !renderAttempted;
  return selectedProvider === 'local_render';
}

async function resolveEvaluatedPayload(
  readResult: WebReadResult,
  requestedUrl: string,
): Promise<{ content: string; extractor: string }> {
  if (readResult.filePayload?.format !== 'pdf') {
    return { content: readResult.content, extractor: readResult.extractor };
  }
  const bytes = readResult.filePayload.bytes;
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const outcome = await readWebPdfText({
    file: {
      path: `web-downloads/${sha256}.pdf`,
      format: 'pdf',
      mimeType: 'application/pdf',
      byteLength: bytes.byteLength,
      sha256,
      requestedUrl,
      finalUrl: readResult.finalUrl,
      acquiredAt: readResult.fetchedAt,
      trust: 'untrusted_external_file',
    },
    bytes,
  });
  if (outcome.status === 'read') {
    return { content: outcome.result.content, extractor: 'pdf_text_layer' };
  }
  return { content: readResult.content, extractor: readResult.extractor };
}

async function evaluateCase(params: {
  readonly round: number;
  readonly worker: WebPageRenderWorker;
  readonly caseDefinition: WebReadReliabilityCase;
  readonly measureMemory: boolean;
  readonly dumpDir?: string;
}): Promise<RenderCoverageAttempt> {
  const startedAt = Date.now();
  const expectedOutcome = resolveExpectedOutcome(params.caseDefinition);
  const expectedRoute = params.caseDefinition.expectedRoute ?? 'any';

  let renderCalled = false;
  let renderFailureKind: string | undefined;
  let renderFailureMessage: string | undefined;
  let renderedCharCount: number | undefined;
  let renderQualityScore: number | undefined;
  let renderWarnings: readonly string[] | undefined;
  let httpMs = 0;
  let renderMs = 0;
  let httpCapture: Partial<WebReadResult> | undefined;
  let renderCapture: Partial<WebReadResult> | undefined;

  const baseHttpProvider = new LocalHttpProvider();
  const httpProvider: WebReadProvider = {
    name: baseHttpProvider.name,
    async read(readParams) {
      const t0 = Date.now();
      try {
        const result = await baseHttpProvider.read(readParams);
        httpCapture = {
          finalUrl: result.finalUrl,
          status: result.status,
          extractor: result.extractor,
          charCount: result.charCount,
          rawLength: result.rawLength,
          qualityScore: result.qualityScore,
          warnings: result.warnings,
          resources: result.resources,
          content: result.content.slice(0, 4_000),
        };
        return result;
      } finally {
        httpMs += Date.now() - t0;
      }
    },
  };

  const localRenderProvider = new LocalRenderProvider({ renderer: params.worker });
  const renderProvider: WebReadProvider = {
    name: localRenderProvider.name,
    async read(readParams) {
      renderCalled = true;
      const t0 = Date.now();
      try {
        const result = await localRenderProvider.read(readParams);
        renderedCharCount = result.charCount;
        renderQualityScore = result.qualityScore;
        renderWarnings = result.warnings;
        renderCapture = {
          finalUrl: result.finalUrl,
          status: result.status,
          extractor: result.extractor,
          charCount: result.charCount,
          rawLength: result.rawLength,
          qualityScore: result.qualityScore,
          warnings: result.warnings,
          resources: result.resources,
          content: result.content.slice(0, 4_000),
        };
        return result;
      } catch (error: unknown) {
        renderFailureKind = getWebFailureKind(error);
        renderFailureMessage = error instanceof Error ? error.message : String(error);
        throw error;
      } finally {
        renderMs += Date.now() - t0;
      }
    },
  };

  const memorySamples: ProcessMemorySnapshot[] = [];
  let sampleTimer: ReturnType<typeof setInterval> | undefined;
  if (params.measureMemory) {
    memorySamples.push(snapshotAppMetrics());
    sampleTimer = setInterval(() => {
      memorySamples.push(snapshotAppMetrics());
    }, 200);
  }

  let ladderResult: WebReadLadderResult;
  try {
    ladderResult = await readWebPageWithLadder(
      { url: params.caseDefinition.url, maxChars: 50_000 },
      {
        provider: httpProvider,
        renderProvider,
        // 与生产默认一致：不注入假托管 Reader，避免扭曲访问墙分类。
        managedProvider: null,
      },
    );
  } catch (error: unknown) {
    if (sampleTimer) clearInterval(sampleTimer);
    if (params.measureMemory) memorySamples.push(snapshotAppMetrics());
    const failureKind = getWebFailureKind(error);
    const failureCode = error instanceof WebFailureError ? error.code : failureKind;
    const diagnostics = getWebFailureDiagnostics(error);
    const expectedBlocked = expectedOutcome === 'blocked';
    const contractSuccess = expectedBlocked && matchesExpectedFailureKind(
      params.caseDefinition.expectedFailureKind,
      failureKind,
      failureCode,
    );
    const attempt: RenderCoverageAttempt = {
      round: params.round,
      caseId: params.caseDefinition.id,
      url: params.caseDefinition.url,
      category: params.caseDefinition.category,
      expectedOutcome,
      expectedRoute,
      routeMatched: expectedRoute === 'any' || (expectedRoute === 'local_render' ? renderCalled : !renderCalled),
      expectedTerminal: expectedBlocked,
      contractSuccess,
      contentCovered: false,
      selectedProvider: 'none',
      renderAttempted: renderCalled,
      ...(diagnostics.escalationReason ? { escalationReason: diagnostics.escalationReason } : {}),
      ...(diagnostics.initialFailureKind ? { initialFailureKind: diagnostics.initialFailureKind } : {}),
      failureKind,
      failureCode,
      ...(error instanceof Error ? { failureMessage: error.message } : {}),
      ...(renderFailureKind ? { renderFailureKind } : {}),
      ...(renderFailureMessage ? { renderFailureMessage } : {}),
      resourcesCount: error instanceof WebFailureError ? (error.details?.resources?.length ?? 0) : 0,
      warnings: [],
      charCount: 0,
      ...(renderedCharCount !== undefined ? { renderedCharCount } : {}),
      ...(renderQualityScore !== undefined ? { renderQualityScore } : {}),
      ...(renderWarnings ? { renderWarnings } : {}),
      expectsCodeBlock: params.caseDefinition.expectCodeBlock === true,
      expectsTable: params.caseDefinition.expectTable === true,
      codeBlockMarkupPresent: false,
      tableMarkupPresent: false,
      contentChecks: { checked: 0, failed: [] },
      httpMs,
      renderMs,
      tookMs: Date.now() - startedAt,
      ...(params.measureMemory ? { memoryPeakKb: computePeakKb(memorySamples) } : {}),
    };
    if (params.dumpDir) {
      await writeFile(
        path.join(params.dumpDir, 'cases', `r${params.round}-${params.caseDefinition.id}.json`),
        JSON.stringify({ attempt, diagnostics, httpCapture, renderCapture }, null, 2),
        'utf8',
      );
    }
    return attempt;
  }

  if (sampleTimer) clearInterval(sampleTimer);
  if (params.measureMemory) memorySamples.push(snapshotAppMetrics());

  const evaluated = await resolveEvaluatedPayload(ladderResult.readResult, params.caseDefinition.url);
  const resourcesCount = ladderResult.readResult.resources?.length ?? 0;
  const quality = evaluateReadQuality(params.caseDefinition, {
    title: ladderResult.readResult.title,
    content: evaluated.content,
    resourcesCount,
    warnings: ladderResult.readResult.warnings,
  });
  const routeMatched = matchesExpectedRoute(
    expectedRoute,
    ladderResult.selectedProvider,
    ladderResult.renderAttempted,
  );
  const attempt: RenderCoverageAttempt = {
    round: params.round,
    caseId: params.caseDefinition.id,
    url: params.caseDefinition.url,
    category: params.caseDefinition.category,
    expectedOutcome,
    expectedRoute,
    routeMatched,
    expectedTerminal: expectedOutcome === 'blocked',
    contractSuccess: quality.success,
    contentCovered: expectedOutcome === 'content' && quality.contentAvailable,
    selectedProvider: ladderResult.selectedProvider,
    renderAttempted: ladderResult.renderAttempted,
    extractor: evaluated.extractor,
    ...(ladderResult.escalationReason ? { escalationReason: ladderResult.escalationReason } : {}),
    ...(ladderResult.initialFailureKind ? { initialFailureKind: ladderResult.initialFailureKind } : {}),
    resourcesCount,
    warnings: ladderResult.readResult.warnings,
    charCount: quality.charCount,
    ...(renderedCharCount !== undefined ? { renderedCharCount } : {}),
    ...(renderQualityScore !== undefined ? { renderQualityScore } : {}),
    ...(renderWarnings ? { renderWarnings } : {}),
    expectsCodeBlock: params.caseDefinition.expectCodeBlock === true,
    expectsTable: params.caseDefinition.expectTable === true,
    codeBlockMarkupPresent: quality.codeBlockMarkupPresent,
    tableMarkupPresent: quality.tableMarkupPresent,
    contentChecks: quality.contentChecks,
    ...(quality.failureKind ? { failureKind: quality.failureKind } : {}),
    httpMs,
    renderMs,
    tookMs: Date.now() - startedAt,
    ...(params.measureMemory ? { memoryPeakKb: computePeakKb(memorySamples) } : {}),
  };
  if (params.dumpDir) {
    await writeFile(
      path.join(params.dumpDir, 'cases', `r${params.round}-${params.caseDefinition.id}.json`),
      JSON.stringify({ attempt, httpCapture, renderCapture }, null, 2),
      'utf8',
    );
  }
  return attempt;
}

async function run(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const cases = selectCases(options.suite);
  if (options.dumpDir) {
    await mkdir(path.join(options.dumpDir, 'cases'), { recursive: true });
  }
  const idleBaseline = options.measureMemory ? snapshotAppMetrics() : undefined;
  const worker = new WebPageRenderWorker({
    partition: `web-render:live-benchmark-${process.pid}`,
  });
  const attempts: RenderCoverageAttempt[] = [];
  try {
    for (let round = 1; round <= options.rounds; round += 1) {
      for (const caseDefinition of cases) {
        const attempt = await evaluateCase({
          round,
          worker,
          caseDefinition,
          measureMemory: options.measureMemory,
          dumpDir: options.dumpDir,
        });
        attempts.push(attempt);
        console.log(JSON.stringify(attempt));
      }
    }
  } finally {
    await worker.dispose();
  }
  let postDisposeMemory: ProcessMemorySnapshot | undefined;
  if (options.measureMemory) {
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    postDisposeMemory = snapshotAppMetrics();
  }
  if (options.dumpDir) {
    await writeFile(
      path.join(options.dumpDir, 'summary.json'),
      JSON.stringify({
        suite: options.suite,
        rounds: options.rounds,
        idleBaseline,
        postDisposeMemory,
        attempts,
      }, null, 2),
      'utf8',
    );
  }
  console.log(`WEB_RENDER_COVERAGE_RESULT=${JSON.stringify(attempts)}`);
}

app.commandLine.appendSwitch('disable-gpu');
app.on('window-all-closed', () => undefined);
app.whenReady()
  .then(run)
  .then(() => app.quit())
  .catch((error: unknown) => {
    console.error('WEB_RENDER_COVERAGE_ERROR', error);
    app.exit(1);
  });
