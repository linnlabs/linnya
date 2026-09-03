import { describe, expect, it } from 'vitest';

import {
  createLinnyaChildRunContextInjections,
  createLinnyaFenceInjections,
} from '../createLinnyaFenceInjections';
import type { AgentInvokeRequest } from '../contracts';

describe('createLinnyaFenceInjections', () => {
  it('converts project metadata into a project-context fence', () => {
    const request: AgentInvokeRequest = {
      query: 'hello',
      promptKey: 'default',
      project_metadata: {
        name: 'Project A',
        description: 'A document project',
      },
    };

    expect(createLinnyaFenceInjections(request)).toEqual([
      {
        kind: 'project-context',
        content: 'project name: Project A\nproject description: A document project',
      },
    ]);
  });

  it('把项目文件清单纳入 project-context', () => {
    const request: AgentInvokeRequest = {
      query: 'inspect project',
      promptKey: 'default',
      document_list: '1. [document] Strategy.md (id=doc-1)',
    };

    expect(createLinnyaFenceInjections(request)).toEqual([{
      kind: 'project-context',
      content: [
        'project files:',
        '1. [document] Strategy.md (id=doc-1)',
      ].join('\n'),
    }]);
  });

  it('converts document title, document fragment, and injected context into document fences', () => {
    const request: AgentInvokeRequest = {
      query: 'hello',
      promptKey: 'default',
      document_title: 'Doc A',
      document_fragment: 'Paragraph 1',
      injected_context: 'Extra context',
    };

    expect(createLinnyaFenceInjections(request)).toEqual([
      {
        kind: 'document-context',
        content: 'document title: Doc A\ndocument fragment:\nParagraph 1',
      },
      {
        kind: 'additional-context',
        content: 'Extra context',
      },
    ]);
  });

  it('merges cursor context into one document-context fence', () => {
    const request: AgentInvokeRequest = {
      query: 'hello',
      promptKey: 'default',
      context_before: 'Before',
      context_after: 'After',
    };

    expect(createLinnyaFenceInjections(request)).toEqual([
      {
        kind: 'document-context',
        content: 'Before\nAfter',
      },
    ]);
  });

  it('merges page context and document title into one document-context fence without duplicate title', () => {
    const request: AgentInvokeRequest = {
      query: 'hello',
      promptKey: 'default',
      context_before: [
        '[page_context]',
        'kind=slides',
        'document_id=deck-1',
        'document_type=presentation',
        'document_title=AI图片展示.slides',
      ].join('\n'),
      document_title: 'AI图片展示.slides',
    };

    expect(createLinnyaFenceInjections(request)).toEqual([
      {
        kind: 'document-context',
        content: [
          '[page_context]',
          'kind=slides',
          'document_id=deck-1',
          'document_type=presentation',
          'document_title=AI图片展示.slides',
        ].join('\n'),
      },
    ]);
  });

  it('converts user quote into a user-quote fence without rewriting query', () => {
    const request: AgentInvokeRequest = {
      query: 'current query',
      promptKey: 'default',
      user_quote: {
        items: [
          {
            quote_id: 'reference-11111111111111111111111111111111',
            plugin_id: 'platform',
            kind: 'text-selection',
            text: 'Quoted text',
            source: {
              doc_id: 'doc-1',
              block_id: 'block-1',
              start: 2,
              end: 9,
            },
          },
          {
            quote_id: 'reference-22222222222222222222222222222222',
            plugin_id: 'platform',
            kind: 'workspace-document',
            text: 'Second quote',
            source: { doc_id: 'doc-2' },
          },
        ],
      },
    };

    expect(createLinnyaFenceInjections(request)).toEqual([
      {
        kind: 'user-quote',
        content: 'Quoted text\n\nSecond quote',
        attrs: {
          source_doc: 'doc-1',
          block_id: 'block-1',
          start: 2,
          end: 9,
        },
      },
    ]);
  });

  it('preserves a workspace VFS inode instruction in the user-quote fence', () => {
    const referenceText = [
      'Workspace document reference: "Roadmap" (inode="workspace:doc-1").',
      'Use read_file with this inode and view="document" to read the latest content before answering.',
    ].join(' ');
    const request: AgentInvokeRequest = {
      query: '总结这份文档',
      promptKey: 'default',
      user_quote: {
        items: [{
          quote_id: 'reference-11111111111111111111111111111111',
          plugin_id: 'platform',
          kind: 'workspace-document',
          text: referenceText,
        }],
      },
    };

    expect(createLinnyaFenceInjections(request)).toEqual([
      {
        kind: 'user-quote',
        content: referenceText,
        attrs: {},
      },
    ]);
  });

  it('忽略空 items 或全部为空文本的 user quote', () => {
    expect(createLinnyaFenceInjections({
      query: 'hello',
      promptKey: 'default',
      user_quote: { items: [] },
    })).toEqual([]);

    expect(createLinnyaFenceInjections({
      query: 'hello',
      promptKey: 'default',
      user_quote: {
        items: [{
          quote_id: 'reference-11111111111111111111111111111111',
          plugin_id: 'platform',
          kind: 'text-selection',
          text: '   ',
        }],
      },
    })).toEqual([]);
  });

  it('appends existing fences after converted product fields', () => {
    const request: AgentInvokeRequest = {
      query: 'hello',
      promptKey: 'default',
      document_fragment: 'Paragraph 1',
      fences: [{ kind: 'memory-context', content: 'memory' }],
    };

    expect(createLinnyaFenceInjections(request)).toEqual([
      {
        kind: 'document-context',
        content: 'document fragment:\nParagraph 1',
      },
      { kind: 'memory-context', content: 'memory' },
    ]);
  });

  it('preserves selected slides element fences from the caller', () => {
    const request: AgentInvokeRequest = {
      query: '把选中元素改成圆角矩形',
      promptKey: 'default',
      fences: [{
        kind: 'selected-slides-element',
        content: 'source_file_inode: deck-1',
      }],
    };

    expect(createLinnyaFenceInjections(request)).toEqual([
      {
        kind: 'selected-slides-element',
        content: 'source_file_inode: deck-1',
      },
    ]);
  });

  it('child-run 只继承项目与当前视图，不继承选区和泛化旧上下文', () => {
    const request: AgentInvokeRequest = {
      query: 'delegate',
      promptKey: 'default',
      project_metadata: { name: 'Project A' },
      document_fragment: 'Current document fragment',
      injected_context: 'Legacy additional context',
      user_quote: {
        items: [{
          quote_id: 'reference-11111111111111111111111111111111',
          plugin_id: 'platform',
          kind: 'text-selection',
          text: 'Selected text',
        }],
      },
    };

    expect(createLinnyaChildRunContextInjections(request)).toEqual([
      { kind: 'project-context', content: 'project name: Project A' },
      {
        kind: 'document-context',
        content: 'document fragment:\nCurrent document fragment',
      },
    ]);
  });
});
