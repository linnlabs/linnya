import { describe, expect, it, vi } from 'vitest';
import type { DeckSpec, SlidesManualEditCommand } from '@plugin/slides/shared';
import type { PresentationDocumentRecord } from '../../../persistence/index.js';
import {
  PresentationDraftConflictError,
  PresentationManualEditCommandConflictError,
} from '../../../persistence/index.js';
import {
  PresentationBuildFailureError,
  createPresentationBuildFailure,
} from '../../presentationBuildFailure/index.js';
import { createManualEditPayloadDigest } from '../functions/createManualEditPayloadDigest.js';
import { PresentationManualEditingRuntime } from './PresentationManualEditingRuntime.js';

const SOURCE = `const slide = createSlide({ slideKey: "overview" });
slide.add(createText({ editKey: "headline", content: "Original" }));
compose({ title: "Demo", slides: [slide] });
`;

const DECK_SPEC: DeckSpec = {
  title: 'Demo',
  layout: '16x9',
  slides: [{
    slideNumber: 1,
    spec: {
      type: 'freeform',
      elements: [{
        type: 'text',
        content: 'Original',
        position: { x: 0, y: 0, w: 2, h: 1 },
        _authoringRef: { slideKey: 'overview', editKey: 'headline', targetKind: 'text' },
      }],
    },
  }],
};

const COMMAND: SlidesManualEditCommand = {
  commandId: 'command-1',
  documentId: 'deck-1',
  expectedBase: {
    revisionId: 'revision-1',
    revision: 1,
    sourceHash: 'a'.repeat(64),
  },
  operation: {
    op: 'set_text_content', targetKind: 'text',
    target: { slideKey: 'overview', editKey: 'headline' },
    content: 'Updated',
  },
};

function makeDocument(): PresentationDocumentRecord {
  return {
    nodeId: 'deck-1',
    currentRevisionId: 'revision-1',
    currentRevision: 1,
    deckSource: SOURCE,
    sourceHash: 'a'.repeat(64),
    deckSpec: DECK_SPEC,
    pptxArtifact: { state: 'ready', revisionId: 'revision-1', buffer: Buffer.from('pptx') },
    title: 'Demo',
    slideCount: 1,
    layout: '16x9',
    createdAt: 1,
    updatedAt: 1,
  };
}

function makeRuntime(options: {
  readonly document?: PresentationDocumentRecord | null;
  readonly receipt?: {
    readonly commandId: string;
    readonly nodeId: string;
    readonly payloadDigest: string;
    readonly revisionId: string;
    readonly revision: number;
    readonly createdAt: number;
  } | null;
  readonly hasDraft?: boolean;
  readonly buildError?: Error;
} = {}) {
  const traceRecord = vi.fn();
  const buildFromSource = vi.fn(async () => {
    if (options.buildError) throw options.buildError;
    return {
      versionId: 'revision-2',
      versionNumber: 2,
      deckSpec: DECK_SPEC,
      pptxBuffer: Buffer.from('pptx-2'),
      diagnostics: [],
      parseWarnings: [],
    };
  });
  const buildFromProjectedDeckSpec = vi.fn(async () => {
    if (options.buildError) throw options.buildError;
    return {
      versionId: 'revision-2',
      versionNumber: 2,
      deckSpec: DECK_SPEC,
      pptxBuffer: Buffer.from('pptx-2'),
    };
  });
  const runtime = new PresentationManualEditingRuntime({
    presentationRepo: {
      getPresentation: vi.fn(async () => options.document === undefined ? makeDocument() : options.document),
      getManualEditReceipt: vi.fn(async () => options.receipt ?? null),
    },
    draftRepo: { has: vi.fn(() => options.hasDraft ?? false) },
    builder: {
      commitManualEditFromSource: buildFromSource,
      commitManualEditFromProjectedDeckSpec: buildFromProjectedDeckSpec,
    },
    trace: { record: traceRecord },
  });
  return { runtime, buildFromSource, buildFromProjectedDeckSpec, traceRecord };
}

describe('PresentationManualEditingRuntime', () => {
  it('改写源码并携带基线、draft guard 与幂等回执完成提交', async () => {
    const { runtime, buildFromSource, traceRecord } = makeRuntime();

    await expect(runtime.submit(COMMAND)).resolves.toEqual({
      status: 'committed',
      commandId: 'command-1',
      documentId: 'deck-1',
      revisionId: 'revision-2',
      revision: 2,
    });
    expect(buildFromSource).toHaveBeenCalledWith(expect.objectContaining({
      nodeId: 'deck-1',
      expectedBase: COMMAND.expectedBase,
      expectedDraftState: 'absent',
      manualEditReceipt: {
        commandId: 'command-1',
        payloadDigest: createManualEditPayloadDigest(COMMAND),
      },
      origin: 'edit',
    }));
    expect(buildFromSource.mock.calls[0][0].source).toContain('content": "Updated"');
    expect(traceRecord.mock.calls.map(([event]) => event.stage)).toEqual([
      'request_received',
      'snapshot_validated',
      'source_rewritten',
      'semantic_build_started',
      'revision_committed',
    ]);
  });

  it('对唯一顶层对象的增量位移跳过 sandbox 与整稿布局', async () => {
    const { runtime, buildFromSource, buildFromProjectedDeckSpec } = makeRuntime();
    const command: SlidesManualEditCommand = {
      ...COMMAND,
      operation: {
        op: 'translate_by',
        target: { slideKey: 'overview', editKey: 'headline' },
        targetKind: 'text',
        delta: { dx: 0.25, dy: -0.1 },
      },
    };

    await expect(runtime.submit(command)).resolves.toMatchObject({
      status: 'committed',
      revisionId: 'revision-2',
      revision: 2,
    });
    expect(buildFromSource).not.toHaveBeenCalled();
    expect(buildFromProjectedDeckSpec).toHaveBeenCalledWith(expect.objectContaining({
      nodeId: 'deck-1',
      source: expect.stringContaining('"dx": 0.25'),
      deckSpec: expect.objectContaining({
        slides: [expect.objectContaining({
          spec: expect.objectContaining({
            elements: [expect.objectContaining({
              position: { x: 0.25, y: -0.1, w: 2, h: 1 },
            })],
          }),
        })],
      }),
    }));
  });

  it('样式和结构操作保持完整编译路径', async () => {
    const operations: readonly SlidesManualEditCommand['operation'][] = [
      {
        op: 'set_text_style',
        target: { slideKey: 'overview', editKey: 'headline' },
        fontSizePt: 30,
        color: '#2563EB',
      },
      {
        op: 'delete_target',
        target: { slideKey: 'overview', editKey: 'card' },
        targetKind: 'frame',
      },
    ];

    for (const operation of operations) {
      const { runtime, buildFromSource, buildFromProjectedDeckSpec, traceRecord } = makeRuntime();
      await expect(runtime.submit({ ...COMMAND, operation })).resolves.toMatchObject({
        status: 'committed',
        revision: 2,
      });
      expect(buildFromSource).toHaveBeenCalledOnce();
      expect(buildFromProjectedDeckSpec).not.toHaveBeenCalled();
      expect(traceRecord).toHaveBeenCalledWith(expect.objectContaining({
        stage: 'semantic_build_started',
        path: 'full_compile',
      }));
    }
  });

  it('同一 command 与 payload 重试时返回原 revision，且不重复构建', async () => {
    const { runtime, buildFromSource } = makeRuntime({
      receipt: {
        commandId: 'command-1',
        nodeId: 'deck-1',
        payloadDigest: createManualEditPayloadDigest(COMMAND),
        revisionId: 'revision-2',
        revision: 2,
        createdAt: 2,
      },
    });

    await expect(runtime.submit(COMMAND)).resolves.toMatchObject({
      status: 'committed',
      revisionId: 'revision-2',
      revision: 2,
    });
    expect(buildFromSource).not.toHaveBeenCalled();
  });

  it.each([
    ['command_reused', { receipt: {
      commandId: 'command-1', nodeId: 'deck-1', payloadDigest: 'different',
      revisionId: 'revision-2', revision: 2, createdAt: 2,
    } }],
    ['stale_base', { document: { ...makeDocument(), currentRevision: 2 } }],
    ['draft_present', { hasDraft: true }],
  ] as const)('把 %s 返回为显式冲突结果', async (reason, options) => {
    const { runtime, buildFromSource } = makeRuntime(options);
    await expect(runtime.submit(COMMAND)).resolves.toMatchObject({ status: 'conflict', reason });
    expect(buildFromSource).not.toHaveBeenCalled();
  });

  it('把可预期的完整构建失败映射为稳定业务结果', async () => {
    const failure = createPresentationBuildFailure({
      code: 'slides.codegen.typecheck',
      summary: '文本修改导致源码类型检查失败。',
      referenceId: 'failure-1',
    });
    const { runtime } = makeRuntime({ buildError: new PresentationBuildFailureError(failure) });

    await expect(runtime.submit(COMMAND)).resolves.toEqual({
      status: 'build_failed',
      commandId: 'command-1',
      documentId: 'deck-1',
      code: 'slides.codegen.typecheck',
      message: '文本修改导致源码类型检查失败。',
      retryable: false,
      referenceId: 'failure-1',
    });
  });

  it.each([
    ['draft_present', new PresentationDraftConflictError('deck-1')],
    ['command_reused', new PresentationManualEditCommandConflictError('command-1')],
  ] as const)('把 commit 时才发现的 %s 保持为显式冲突', async (reason, buildError) => {
    const { runtime } = makeRuntime({ buildError });
    await expect(runtime.submit(COMMAND)).resolves.toMatchObject({
      status: 'conflict',
      reason,
    });
  });
});
