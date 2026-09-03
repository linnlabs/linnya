import { describe, expect, it } from 'vitest';

import {
  admitCitationsFromConversationToolOutput,
  createConversationCitationWorkspace,
  isConversationCitationDependencyClosure,
  projectConversationCitationDependencies,
  projectConversationCitationRegistration,
} from '../../../conversation-presentation';

function webCitation(ref: string, url: string) {
  return {
    sourceType: 'web' as const,
    ref,
    index: 1,
    url,
    docTitle: `title-${ref}`,
    snippet: `snippet-${ref}`,
  };
}

describe('Conversation citation presentation', () => {
  it('按当前 scope 优先，并把唯一跨 scope 来源裁剪成消息依赖闭包', () => {
    let workspace = createConversationCitationWorkspace();
    workspace = projectConversationCitationRegistration(
      workspace,
      'turn-a',
      [webCitation('Ab3Def', 'https://example.com/a')],
    );
    workspace = projectConversationCitationRegistration(
      workspace,
      'turn-b',
      [webCitation('Gh4Jkm', 'https://example.com/b')],
    );

    expect(projectConversationCitationDependencies(
      workspace,
      'turn-answer',
      ['Gh4Jkm', 'Ab3Def', 'Np5Qrs'],
    )).toEqual({
      citations: [
        expect.objectContaining({ ref: 'Gh4Jkm', url: 'https://example.com/b' }),
        expect.objectContaining({ ref: 'Ab3Def', url: 'https://example.com/a' }),
      ],
      unresolved_refs: ['Np5Qrs'],
    });
  });

  it('跨 scope 的同 ref 冲突不会被全局 fallback 随机解析', () => {
    let workspace = createConversationCitationWorkspace();
    workspace = projectConversationCitationRegistration(
      workspace,
      'turn-a',
      [webCitation('Ab3Def', 'https://example.com/a')],
    );
    workspace = projectConversationCitationRegistration(
      workspace,
      'turn-b',
      [webCitation('Ab3Def', 'https://example.com/b')],
    );

    expect(projectConversationCitationDependencies(
      workspace,
      'turn-answer',
      ['Ab3Def'],
    )).toEqual({ citations: [], unresolved_refs: ['Ab3Def'] });
    expect(projectConversationCitationDependencies(
      workspace,
      'turn-b',
      ['Ab3Def'],
    ).citations[0]).toMatchObject({ url: 'https://example.com/b' });
  });

  it('同一来源重复接纳时保留首次快照，避免既有消息展示事实漂移', () => {
    let workspace = createConversationCitationWorkspace();
    workspace = projectConversationCitationRegistration(
      workspace,
      'turn-a',
      [webCitation('Ab3Def', 'https://example.com/a')],
    );
    workspace = projectConversationCitationRegistration(
      workspace,
      'turn-a',
      [{
        ...webCitation('Ab3Def', 'https://example.com/a'),
        docTitle: 'later title',
        snippet: 'later snippet',
      }],
    );

    expect(projectConversationCitationDependencies(
      workspace,
      'turn-a',
      ['Ab3Def'],
    ).citations[0]).toMatchObject({
      docTitle: 'title-Ab3Def',
      snippet: 'snippet-Ab3Def',
    });
  });

  it('producer 缺少严格来源字段时在 admission 边界失败', () => {
    expect(() => admitCitationsFromConversationToolOutput({
      toolName: 'web_search',
      status: 'success',
      result: {
        data: {
          query: 'query',
          resultCount: 1,
          citations: {
            query: 'query',
            searchMode: 'web',
            citations: [{
              ref: 'Ab3Def',
              index: 1,
              docTitle: 'missing sourceType and URL',
              snippet: 'snippet',
            }],
          },
          evidence_store: { bundle_id: 'bundle' },
          cacheStatus: 'miss',
        },
        observation: 'observation',
      },
    })).toThrow(/CitationAdmission/);
  });

  it('resource_read 的非 citation 结果不进入 workspace，但伪造 citation shape 会失败', () => {
    expect(admitCitationsFromConversationToolOutput({
      toolName: 'resource_read',
      status: 'success',
      result: { data: 'plain resource content', observation: 'read complete' },
    })).toBeNull();

    expect(() => admitCitationsFromConversationToolOutput({
      toolName: 'resource_read',
      status: 'success',
      result: {
        data: {
          citations: { query: 'query', searchMode: 'web', citations: [] },
        },
        observation: 'malformed citation-bearing result',
      },
    })).toThrow(/Unsupported citation-bearing resource_read source/);
  });

  it('dependency closure 拒绝正文未使用的额外来源', () => {
    expect(isConversationCitationDependencyClosure(
      ['Ab3Def'],
      {
        citations: [
          webCitation('Ab3Def', 'https://example.com/a'),
          webCitation('Gh4Jkm', 'https://example.com/extra'),
        ],
        unresolved_refs: [],
      },
    )).toBe(false);
  });
});
