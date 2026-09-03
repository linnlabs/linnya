import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useSlidesStore } from '../../../store/slidesStore';
import { useSlidesElementAiEditWorkflow } from './useSlidesElementAiEditWorkflow';
import type { PptSourceSlicesOutput } from '../../../types/api';
import type { SlidesElementAiEditSubmitPayload } from '../definitions/elementAiEditTypes';

const readSourceSlicesForAiEditMock = vi.hoisted(() => vi.fn());
const ensureConversationMock = vi.hoisted(() => vi.fn());
const sendMessageMock = vi.hoisted(() => vi.fn());
const reportErrorMock = vi.hoisted(() => vi.fn());

vi.mock('../../../services/slidesApi', () => ({
  slidesApi: {
    readSourceSlicesForAiEdit: readSourceSlicesForAiEditMock,
  },
}));

vi.mock('../../../services/slidesRenderApi', () => ({
  slidesRenderApi: {},
}));

vi.mock('@plugin/renderer/aiInvocationPort', () => ({
  requireRendererAiInvocationPort: () => ({
    ensureConversation: ensureConversationMock,
    sendMessage: sendMessageMock,
    reportError: reportErrorMock,
  }),
}));

const payload: SlidesElementAiEditSubmitPayload = {
  instruction: '把标题改成蓝色',
  slideNumber: 1,
  targets: [
    {
      elementId: 's1-title',
      kind: 'text',
      summary: 'text="Old title"',
      sourceSpan: { startLine: 3, endLine: 5 },
      bounds: { x: 1, y: 1, w: 3, h: 0.5 },
      polygon: [],
      zPath: [1],
    },
  ],
};

function makeSourceSlices(overrides: Partial<PptSourceSlicesOutput> = {}): PptSourceSlicesOutput {
  return {
    presentationId: 'deck-1',
    title: 'Deck',
    versionId: 'version-1',
    sourceOrigin: 'compiled',
    sourceKey: 'compiled:version-1',
    totalLines: 12,
    slices: [
      {
        elementId: 's1-title',
        slideNumber: 1,
        kind: 'text',
        sourceSpan: { startLine: 3, endLine: 5 },
        startLine: 3,
        endLine: 5,
        numLines: 3,
        content: 'createText({\n  content: "Old title",\n});',
      },
    ],
    ...overrides,
  };
}

describe('useSlidesElementAiEditWorkflow', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    ensureConversationMock.mockResolvedValue({ conversationId: 'conversation-1' });

    const slidesStore = useSlidesStore();
    slidesStore.currentDeckId = 'deck-1';
  });

  it('materializes a PPT conversation, reads exact source slices, and sends slides_agent context', async () => {
    readSourceSlicesForAiEditMock.mockResolvedValueOnce(makeSourceSlices());
    sendMessageMock.mockResolvedValueOnce(true);

    const workflow = useSlidesElementAiEditWorkflow();
    const result = await workflow.submitElementAiEdit(payload);

    expect(result).toBe(true);
    expect(ensureConversationMock).toHaveBeenCalledWith({
      agentChoiceId: 'ppt',
    });

    expect(readSourceSlicesForAiEditMock).toHaveBeenCalledWith({
      nodeId: 'deck-1',
      conversationId: 'conversation-1',
      targets: [
        {
          elementId: 's1-title',
          slideNumber: 1,
          kind: 'text',
          sourceSpan: { startLine: 3, endLine: 5 },
        },
      ],
    });

    expect(sendMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: '修改第 1 页选中的 1 个元素：把标题改成蓝色',
        enableTools: true,
        conversationId: 'conversation-1',
        fences: [
          expect.objectContaining({
            kind: 'selected-slides-element',
            content: expect.stringContaining('<<<deck.js exact source'),
          }),
        ],
        userQuote: {
          items: [expect.objectContaining({
            pluginId: 'slides',
            kind: 'slides-source-selection',
            source: expect.objectContaining({
              type: 'slides_source_selection',
              presentation_id: 'deck-1',
              source_file_inode: 'deck-1',
            }),
          })],
        },
      }),
    );
  });

  it('blocks submission when source slices come from a pending draft', async () => {
    readSourceSlicesForAiEditMock.mockResolvedValueOnce(makeSourceSlices({
      sourceOrigin: 'draft',
      draftStatus: {
        baseVersionId: 'version-1',
        baseVersionNumber: 1,
        errorKind: 'syntax_error',
        errorSummary: 'Draft has a syntax error',
        updatedAt: 200,
      },
    }));

    const workflow = useSlidesElementAiEditWorkflow();
    const result = await workflow.submitElementAiEdit(payload);

    expect(result).toBe(false);
    expect(sendMessageMock).not.toHaveBeenCalled();
    expect(reportErrorMock).toHaveBeenCalledWith(
      '当前 deck.js 有未修复草稿。请先让 AI 修复草稿，再继续点选编辑。',
    );
  });
});
