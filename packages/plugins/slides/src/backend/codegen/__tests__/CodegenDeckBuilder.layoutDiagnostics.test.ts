import { describe, expect, it, vi } from 'vitest';

import type { SandboxExecutionResult } from '@plugin/backend/sandboxRuntime';
import { PresentationStaleBaseError, type PresentationRepositoryPort } from '../../persistence';
import { CodegenDeckBuilder } from '../CodegenDeckBuilder';
import { createInProcessPresentationBuildExecution } from '../../features/presentationBuildExecution';

describe('CodegenDeckBuilder layout diagnostics', () => {
  it('把未挂载元素的源码行号放入 build result', async () => {
    const source = [
      'const slide = createSlide();',
      'const mounted = createText("Mounted"); slide.add(mounted);',
      'const orphan = createText("Orphan");',
      'compose({ title: "Deck", slides: [slide] });',
    ].join('\n');
    const commitPresentation = vi.fn(async () => ({ revisionId: 'revision-2', revision: 2 }));
    const execute = vi.fn(async (): Promise<SandboxExecutionResult> => sandboxResult());
    const presentationRepo: Pick<
      PresentationRepositoryPort,
      'createPresentation' | 'commitPresentation' | 'getPresentation'
    > = {
      createPresentation: vi.fn(async () => ({ revisionId: 'revision-1', revision: 1 })),
      commitPresentation,
      getPresentation: vi.fn(async () => ({
        nodeId: 'deck-1',
        currentRevisionId: 'revision-1',
        currentRevision: 1,
        deckSource: source,
        sourceHash: 'source-hash-1',
        deckSpec: {
          title: 'Deck',
          layout: '16x9',
          theme: {
            colors: { accent1: '#123456' },
            fonts: { major: 'Georgia', minor: 'Verdana' },
          },
          slides: [],
        },
        pptxBuffer: Buffer.from('pptx-1'),
        title: 'Deck',
        slideCount: 0,
        layout: '16x9',
        createdAt: 1,
        updatedAt: 1,
      })),
    };
    const builder = new CodegenDeckBuilder({
      presentationRepo,
      engine: {
        assembleDeck: vi.fn(async () => Buffer.from('pptx')),
      },
      sandbox: {
        execute,
      },
      buildExecution: createInProcessPresentationBuildExecution(),
    });

    const result = await builder.buildFromSource({ nodeId: 'deck-1', source });

    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        phase: 'structure',
        code: 'LAYOUT_UNATTACHED_RENDERABLE_NODE',
        slideNumber: 1,
        sourceSpan: { startLine: 3, endLine: 3 },
      }),
    ]);
    expect(result.parseWarnings).toEqual([]);
    expect(commitPresentation).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        inputs: {
          DECK_DESIGN: {
            palette: { accent1: '#123456' },
            fonts: { major: 'Georgia', minor: 'Verdana' },
          },
        },
      })
    );
  });

  it('调用方基于旧 revision 编辑时，在 sandbox 编译前直接拒绝', async () => {
    const execute = vi.fn(async (): Promise<SandboxExecutionResult> => sandboxResult());
    const builder = new CodegenDeckBuilder({
      presentationRepo: {
        createPresentation: vi.fn(async () => ({ revisionId: 'revision-1', revision: 1 })),
        commitPresentation: vi.fn(async () => ({ revisionId: 'revision-3', revision: 3 })),
        getPresentation: vi.fn(async () => ({
          nodeId: 'deck-1',
          currentRevisionId: 'revision-2',
          currentRevision: 2,
          deckSource: 'current source',
          sourceHash: 'source-hash-2',
          deckSpec: { title: 'Current', slides: [] },
          pptxBuffer: Buffer.from('pptx-2'),
          title: 'Current',
          slideCount: 0,
          createdAt: 1,
          updatedAt: 2,
        })),
      },
      engine: { assembleDeck: vi.fn(async () => Buffer.from('pptx')) },
      sandbox: { execute },
      buildExecution: createInProcessPresentationBuildExecution(),
    });

    await expect(
      builder.buildFromSource({
        nodeId: 'deck-1',
        source: 'edit derived from revision 1',
        expectedBase: {
          revisionId: 'revision-1',
          revision: 1,
          sourceHash: 'source-hash-1',
        },
      })
    ).rejects.toBeInstanceOf(PresentationStaleBaseError);
    expect(execute).not.toHaveBeenCalled();
  });
});

function sandboxResult(): SandboxExecutionResult {
  return {
    success: true,
    value: {
      mode: 'create',
      composeCallCount: 1,
      composeInput: {
        title: 'Deck',
        slides: [
          {
            _type: 'Slide',
            children: [{ _type: 'Text', content: 'Mounted' }],
          },
        ],
      },
      layoutTrace: {
        version: 1,
        truncated: false,
        roots: [1],
        nodes: [
          node(1, 'Slide', 1, [2]),
          node(2, 'Text', 2, [], false, true),
          node(3, 'Text', 3, [], false, true),
        ],
      },
    },
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

function node(
  id: number,
  type: string,
  line: number,
  children: number[] = [],
  configured = false,
  content = false
) {
  return { id, type, startLine: line, endLine: line, children, configured, content };
}
