import { describe, expect, it, vi } from 'vitest';
import type { SandboxExecutionResult } from '@plugin/backend/sandboxRuntime';
import { MathFormulaError } from '@plugin/slides/shared';
import type { PresentationRepositoryPort } from '../../persistence';
import { CodegenDeckBuilder } from '../CodegenDeckBuilder';
import {
  createInProcessPresentationBuildExecution,
  PresentationBuildExecutionError,
  PresentationFormulaBuildExecutionError,
} from '../../features/presentationBuildExecution';

const SOURCE = [
  'const slide = createSlide();',
  'slide.add(createText("Hello"));',
  'compose({ title: "Deck", slides: [slide] });',
].join('\n');

describe('CodegenDeckBuilder structured failure facts', () => {
  it('区分 sandbox source failure 与 transport environment failure', async () => {
    const runtimeBuilder = createBuilder({
      sandboxResult: failedSandboxResult('runtime', 'bad is not defined'),
    });
    await expect(
      runtimeBuilder.buildFromSource({ nodeId: 'deck-1', source: SOURCE })
    ).rejects.toMatchObject({
      failure: {
        code: 'slides.codegen.sandbox',
        phase: 'sandbox',
        retryable: false,
        sourceFixable: true,
      },
    });

    const transportBuilder = createBuilder({
      sandboxResult: failedSandboxResult('transport', 'private runner details'),
    });
    await expect(
      transportBuilder.buildFromSource({ nodeId: 'deck-1', source: SOURCE })
    ).rejects.toMatchObject({
      failure: {
        code: 'slides.environment.sandbox_unavailable',
        phase: 'environment',
        retryable: true,
        sourceFixable: false,
        summary: 'The deck.js sandbox runner transport failed.',
      },
    });
  });

  it('compose contract 与 slide count 都是明确的 source failure', async () => {
    const composeBuilder = createBuilder({ sandboxResult: invalidComposeSandboxResult() });
    await expect(
      composeBuilder.buildFromSource({ nodeId: 'deck-1', source: SOURCE })
    ).rejects.toMatchObject({
      failure: { code: 'slides.codegen.compose_contract', sourceFixable: true },
    });

    const countBuilder = createBuilder();
    await expect(
      countBuilder.buildFromSource({
        nodeId: 'deck-1',
        source: `${SOURCE}\nconst extra = createSlide();`,
      })
    ).rejects.toMatchObject({
      failure: { code: 'slides.codegen.slide_count_mismatch', sourceFixable: true },
    });

    const geometryBuilder = createBuilder({
      sandboxResult: invalidCustomGeometrySandboxResult(),
    });
    await expect(
      geometryBuilder.buildFromSource({ nodeId: 'deck-1', source: SOURCE })
    ).rejects.toMatchObject({
      failure: {
        code: 'slides.codegen.compose_contract',
        phase: 'compose',
        retryable: false,
        sourceFixable: true,
        summary: 'slides[0].elements[0].geometry.commands[2].control2.x 必须位于 viewBox 内。',
      },
    });
  });

  it('PPTX 物化与 revision commit 失败不会伪装成 source 错误', async () => {
    const failureLogger = { error: vi.fn() };
    const materializationBuilder = createBuilder({
      assembleError: new Error('private path'),
      failureLogger,
    });
    await expect(
      materializationBuilder.buildFromSource({ nodeId: 'deck-1', source: SOURCE })
    ).rejects.toMatchObject({
      failure: {
        code: 'slides.materialization.pptx_failed',
        retryable: true,
        sourceFixable: false,
        summary: expect.not.stringContaining('private path'),
        referenceId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      },
    });
    expect(failureLogger.error).toHaveBeenCalledWith(
      '[materialization] PPTX assembly failed',
      expect.objectContaining({
        referenceId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        presentationId: 'deck-1',
        error: expect.objectContaining({ message: 'private path' }),
      })
    );

    const persistenceBuilder = createBuilder({ commitError: new Error('private sqlite path') });
    await expect(
      persistenceBuilder.buildFromSource({ nodeId: 'deck-1', source: SOURCE })
    ).rejects.toMatchObject({
      failure: {
        code: 'slides.persistence.commit_failed',
        retryable: true,
        sourceFixable: false,
        summary: expect.not.stringContaining('private sqlite path'),
      },
    });
  });

  it('物化 admission 的确定性合同失败不会伪装成 runtime unavailable', async () => {
    const builder = createBuilder({
      assembleError: new PresentationBuildExecutionError(
        'contract',
        'Slides materialization deck spec is invalid.',
      ),
    });

    await expect(
      builder.buildFromSource({ nodeId: 'deck-1', source: SOURCE })
    ).rejects.toMatchObject({
      failure: {
        code: 'slides.materialization.contract_invalid',
        phase: 'materialization',
        retryable: false,
        sourceFixable: false,
        summary: 'Slides materialization deck spec is invalid.',
        nextAction: expect.stringContaining('do not retry or rewrite'),
      },
    });
  });

  it('公式领域错误保留稳定 code 与正确的恢复动作', async () => {
    for (const assembleError of [
      new MathFormulaError(
        'slides.formula.inline_formula_too_wide',
        'Inline formula is wider than the available text line.',
      ),
      new PresentationFormulaBuildExecutionError(
        'slides.formula.unsupported_syntax',
        'Formula command is not supported.',
      ),
    ]) {
      const builder = createBuilder({ assembleError });
      await expect(
        builder.buildFromSource({ nodeId: 'deck-1', source: SOURCE })
      ).rejects.toMatchObject({
        failure: {
          code: assembleError instanceof MathFormulaError
            ? 'slides.formula.inline_formula_too_wide'
            : 'slides.formula.unsupported_syntax',
          phase: 'source_contract',
          retryable: false,
          sourceFixable: true,
        },
      });
    }
  });
});

function createBuilder(
  options: {
    readonly sandboxResult?: SandboxExecutionResult;
    readonly assembleError?: Error;
    readonly commitError?: Error;
    readonly failureLogger?: { error: ReturnType<typeof vi.fn> };
  } = {}
): CodegenDeckBuilder {
  const presentationRepo: Pick<
    PresentationRepositoryPort,
    'createPresentation' | 'commitPresentation' | 'getPresentation'
  > = {
    createPresentation: vi.fn(async () => ({ revisionId: 'revision-1', revision: 1 })),
    commitPresentation: vi.fn(async () => {
      if (options.commitError) throw options.commitError;
      return { revisionId: 'revision-2', revision: 2 };
    }),
    getPresentation: vi.fn(async () => ({
      nodeId: 'deck-1',
      currentRevisionId: 'revision-1',
      currentRevision: 1,
      deckSource: SOURCE,
      sourceHash: 'source-hash-1',
      deckSpec: { title: 'Deck', slides: [] },
      pptxBuffer: Buffer.from('pptx-1'),
      title: 'Deck',
      slideCount: 0,
      createdAt: 1,
      updatedAt: 1,
    })),
  };
  return new CodegenDeckBuilder({
    presentationRepo,
    engine: {
      assembleDeck: vi.fn(async () => {
        if (options.assembleError) throw options.assembleError;
        return Buffer.from('pptx-2');
      }),
    },
    sandbox: {
      execute: vi.fn(async () => options.sandboxResult ?? successfulSandboxResult()),
    },
    buildExecution: createInProcessPresentationBuildExecution(),
    ...(options.failureLogger ? { failureLogger: options.failureLogger } : {}),
  });
}

function successfulSandboxResult(): SandboxExecutionResult {
  return sandboxResult({
    success: true,
    value: {
      mode: 'create',
      composeCallCount: 1,
      composeInput: {
        title: 'Deck',
        slides: [{ _type: 'Slide', children: [{ _type: 'Text', content: 'Hello' }] }],
      },
      layoutTrace: {
        version: 1,
        truncated: false,
        roots: [],
        nodes: [],
      },
    },
  });
}

function invalidComposeSandboxResult(): SandboxExecutionResult {
  return sandboxResult({
    success: true,
    value: {
      mode: 'create',
      composeCallCount: 1,
      composeInput: { title: 'Deck', slides: [] },
      layoutTrace: {
        version: 1,
        truncated: false,
        roots: [],
        nodes: [],
      },
    },
  });
}

function invalidCustomGeometrySandboxResult(): SandboxExecutionResult {
  return sandboxResult({
    success: true,
    value: {
      mode: 'create',
      composeCallCount: 1,
      composeInput: {
        title: 'Deck',
        slides: [{
          _type: 'Slide',
          children: [{
            _type: 'Shape',
            width: 2,
            height: 2,
            geometry: {
              type: 'path',
              viewBox: { width: 100, height: 100 },
              commands: [
                { type: 'moveTo', x: 50, y: 50 },
                { type: 'lineTo', x: 50, y: 0 },
                { type: 'cubicTo', x1: 96, y1: 0, x2: 112, y2: 53, x: 82, y: 83 },
                { type: 'close' },
              ],
            },
          }],
        }],
      },
      layoutTrace: {
        version: 1,
        truncated: false,
        roots: [],
        nodes: [],
      },
    },
  });
}

function failedSandboxResult(
  type: 'runtime' | 'transport',
  message: string
): SandboxExecutionResult {
  return sandboxResult({ success: false, error: { type, message } });
}

function sandboxResult(
  result: Pick<SandboxExecutionResult, 'success'> &
    Partial<Pick<SandboxExecutionResult, 'value' | 'error'>>
): SandboxExecutionResult {
  return {
    ...result,
    logs: [],
    usage: {
      elapsedMs: 1,
      logLines: 0,
      logBytes: 0,
      resultBytes: 0,
      capabilityCallCount: 1,
      capabilityCallsByName: { 'host.compose': 1 },
      deniedActions: [],
    },
    telemetry: {
      runId: 'run-1',
      profileId: 'ppt_compose',
      policyVersion: 'v1',
      limits: {
        timeoutMs: 10_000,
        maxLogLines: 200,
        maxLogLineLength: 2_000,
        maxResultBytes: 256 * 1024,
        maxSourceBytes: 128 * 1024,
        maxCapabilityPayloadBytes: 256 * 1024,
        maxHeapMb: 128,
        idleTimeoutMs: 12_000,
      },
      diagnostics: {
        runnerKind: 'test',
        startConfirmed: true,
        heartbeatCount: 0,
        protocolEvents: [],
        stderrBytes: 0,
        idleTimeoutTriggered: false,
        cleanupStatus: 'succeeded',
      },
    },
    artifacts: [],
  };
}
