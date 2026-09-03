import { app } from 'electron';
import { getWebFailureKind, WebFailureError } from '../../../src/tools/web/shared/webFailure';
import type { WebReadLadderResult } from '../../../src/tools/web/webread/definitions/readLadder';
import { readWebPageWithLadder } from '../../../src/tools/web/webread/orchestration/readLadder';
import { LocalHttpProvider } from '../../../src/tools/web/webread/providers/localHttp';
import { LocalRenderProvider } from '../../../src/tools/web/webread/providers/localRender';
import type { WebReadProvider } from '../../../src/tools/web/webread/providers/types';
import { WebPageRenderWorker } from '../../../src/electron-main/web-render/WebPageRenderWorker';
import { WEB_READ_RELIABILITY_CASES } from './read-cases';
import { evaluateReadQuality } from './read-evaluation';

interface RenderCoverageAttempt {
  readonly caseId: string;
  readonly category: string;
  readonly expectedTerminal: boolean;
  readonly contractSuccess: boolean;
  readonly contentCovered: boolean;
  readonly selectedProvider: string;
  readonly renderAttempted: boolean;
  readonly expectsCodeBlock: boolean;
  readonly expectsTable: boolean;
  readonly codeBlockPreserved: boolean;
  readonly tablePreserved: boolean;
  readonly failureKind?: string;
  readonly failureMessage?: string;
  readonly renderFailureKind?: string;
  readonly renderFailureMessage?: string;
  readonly renderedCharCount?: number;
  readonly renderQualityScore?: number;
  readonly renderWarnings?: readonly string[];
  readonly tookMs: number;
}

const noManagedFallback: WebReadProvider = {
  name: 'managed_disabled_for_coverage',
  async read() {
    throw new WebFailureError('provider_error', '本地两层覆盖率基准不启用托管 Reader。');
  },
};

async function evaluateCase(params: {
  readonly worker: WebPageRenderWorker;
  readonly caseDefinition: (typeof WEB_READ_RELIABILITY_CASES)[number];
}): Promise<RenderCoverageAttempt> {
  const startedAt = Date.now();
  let renderCalled = false;
  let renderFailureKind: string | undefined;
  let renderFailureMessage: string | undefined;
  let renderedCharCount: number | undefined;
  let renderQualityScore: number | undefined;
  let renderWarnings: readonly string[] | undefined;
  const localRenderProvider = new LocalRenderProvider({ renderer: params.worker });
  const renderProvider: WebReadProvider = {
    name: localRenderProvider.name,
    async read(readParams) {
      renderCalled = true;
      try {
        const result = await localRenderProvider.read(readParams);
        renderedCharCount = result.charCount;
        renderQualityScore = result.qualityScore;
        renderWarnings = result.warnings;
        return result;
      } catch (error: unknown) {
        renderFailureKind = getWebFailureKind(error);
        renderFailureMessage = error instanceof Error ? error.message : String(error);
        throw error;
      }
    },
  };
  let ladderResult: WebReadLadderResult;
  try {
    ladderResult = await readWebPageWithLadder(
      { url: params.caseDefinition.url, maxChars: 50_000 },
      {
        provider: new LocalHttpProvider(),
        renderProvider,
        managedProvider: noManagedFallback,
      },
    );
  } catch (error: unknown) {
    const failureKind = getWebFailureKind(error);
    const expectedTerminal = params.caseDefinition.expectedFailureKind === failureKind;
    return {
      caseId: params.caseDefinition.id,
      category: params.caseDefinition.category,
      expectedTerminal: params.caseDefinition.expectedFailureKind !== undefined,
      contractSuccess: expectedTerminal,
      contentCovered: false,
      selectedProvider: 'none',
      renderAttempted: renderCalled,
      expectsCodeBlock: params.caseDefinition.expectCodeBlock === true,
      expectsTable: params.caseDefinition.expectTable === true,
      codeBlockPreserved: false,
      tablePreserved: false,
      failureKind,
      ...(error instanceof Error ? { failureMessage: error.message } : {}),
      ...(renderFailureKind ? { renderFailureKind } : {}),
      ...(renderFailureMessage ? { renderFailureMessage } : {}),
      ...(renderedCharCount !== undefined ? { renderedCharCount } : {}),
      ...(renderQualityScore !== undefined ? { renderQualityScore } : {}),
      ...(renderWarnings ? { renderWarnings } : {}),
      tookMs: Date.now() - startedAt,
    };
  }

  const quality = evaluateReadQuality(params.caseDefinition, {
    title: ladderResult.readResult.title,
    content: ladderResult.readResult.content,
  });
  return {
    caseId: params.caseDefinition.id,
    category: params.caseDefinition.category,
    expectedTerminal: params.caseDefinition.expectedFailureKind !== undefined,
    contractSuccess: quality.contentAvailable,
    contentCovered: quality.contentAvailable && params.caseDefinition.expectedFailureKind === undefined,
    selectedProvider: ladderResult.selectedProvider,
    renderAttempted: ladderResult.renderAttempted,
    expectsCodeBlock: params.caseDefinition.expectCodeBlock === true,
    expectsTable: params.caseDefinition.expectTable === true,
    codeBlockPreserved: quality.codeBlockPreserved,
    tablePreserved: quality.tablePreserved,
    ...(renderedCharCount !== undefined ? { renderedCharCount } : {}),
    ...(renderQualityScore !== undefined ? { renderQualityScore } : {}),
    ...(renderWarnings ? { renderWarnings } : {}),
    ...(!quality.contentAvailable && quality.failureKind ? { failureKind: quality.failureKind } : {}),
    tookMs: Date.now() - startedAt,
  };
}

async function run(): Promise<void> {
  const worker = new WebPageRenderWorker({
    partition: `web-render:live-benchmark-${process.pid}`,
  });
  const attempts: RenderCoverageAttempt[] = [];
  try {
    for (const caseDefinition of WEB_READ_RELIABILITY_CASES) {
      const attempt = await evaluateCase({ worker, caseDefinition });
      attempts.push(attempt);
      console.log(JSON.stringify(attempt));
    }
    console.log(`WEB_RENDER_COVERAGE_RESULT=${JSON.stringify(attempts)}`);
  } finally {
    await worker.dispose();
  }
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
