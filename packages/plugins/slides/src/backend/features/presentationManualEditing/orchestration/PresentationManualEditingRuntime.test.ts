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
    slideKey: 'overview',
    spec: {
      type: 'freeform',
      elements: [{
        type: 'text',
        editKey: 'headline',
        content: 'Original',
        position: { x: 0, y: 0, w: 2, h: 1 },
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
    op: 'set_text_content',
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
    pptxBuffer: Buffer.from('pptx'),
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
  const runtime = new PresentationManualEditingRuntime({
    presentationRepo: {
      getPresentation: vi.fn(async () => options.document === undefined ? makeDocument() : options.document),
      getManualEditReceipt: vi.fn(async () => options.receipt ?? null),
    },
    draftRepo: { has: vi.fn(() => options.hasDraft ?? false) },
    builder: { buildFromSource },
  });
  return { runtime, buildFromSource };
}

describe('PresentationManualEditingRuntime', () => {
  it('改写源码并携带基线、draft guard 与幂等回执完成提交', async () => {
    const { runtime, buildFromSource } = makeRuntime();

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
