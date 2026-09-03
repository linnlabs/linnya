import { describe, expect, it } from 'vitest';
import { buildBaseAgentInvokeRequest } from '../build-base-agent-invoke-request';
import type { RuntimeResourceRef } from 'linnkit/contracts';

describe('flow/history-builder.buildBaseAgentInvokeRequest', () => {
  it('从 host flow 输入构建最小 AgentInvokeRequest 形状', () => {
    const attachment: RuntimeResourceRef = {
      id: 'attachment-1',
      kind: 'image',
      resourceId: 'asset-1',
      mediaType: 'image/png',
      byteLength: 1024,
      width: 640,
      height: 480,
      sha256: 'a'.repeat(64),
    };
    const result = buildBaseAgentInvokeRequest({
      lastUserContent: 'question',
      currentUserEventId: 'user-event-1',
      currentUserAttachments: [attachment],
      promptKey: 'default',
      resolvedModelId: 'model_x',
      imageGenerationModelId: 'img_model',
      knowledgeBaseId: 'kb_1',
      maxSteps: 800,
      enableTools: true,
      availableTools: ['knowledge_search'],
      conversationHistory: [],
      contextBefore: 'before',
      contextAfter: 'after',
      documentFragment: 'fragment',
      fences: [{ kind: 'selected-slides-element', content: 'exact source' }],
      currentParagraph: 'paragraph',
      documentTitle: 'Doc',
      documentList: 'Doc A',
      projectMetadata: { id: 'proj_1' },
      documentMetadata: { id: 'doc_1' },
      userQuote: {
        items: [{
          quote_id: 'reference-11111111111111111111111111111111',
          plugin_id: 'platform',
          kind: 'text-selection',
          text: 'quote',
        }],
      },
    });

    expect(result).toMatchObject({
      query: 'question',
      currentUserEventId: 'user-event-1',
      currentUserAttachments: [attachment],
      promptKey: 'default',
      model_id: 'model_x',
      imageGenerationModelId: 'img_model',
      knowledgeBaseId: 'kb_1',
      enableTools: true,
      availableTools: ['knowledge_search'],
      context_before: 'before',
      context_after: 'after',
      document_fragment: 'fragment',
      fences: [{ kind: 'selected-slides-element', content: 'exact source' }],
      current_paragraph: 'paragraph',
      document_title: 'Doc',
      document_list: 'Doc A',
      project_metadata: { id: 'proj_1' },
      document_metadata: { id: 'doc_1' },
      user_quote: {
        items: [{
          quote_id: 'reference-11111111111111111111111111111111',
          plugin_id: 'platform',
          kind: 'text-selection',
          text: 'quote',
        }],
      },
    });
  });
});
