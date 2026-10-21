import { describe, expect, it } from 'vitest';
import type { CitationSource } from '../../definitions/citationSource';
import { createDocumentCitationWriteScope } from '../createDocumentCitationWriteScope';
import { createCitationSourceIdentity } from '../../../../shared/functions/citationSourceAnchor';
import {
  createCitationRefCandidate,
  MAX_CITATION_REF_COLLISION_ATTEMPTS,
} from '../../../reference/functions/createCitationRefCandidate';

const webSource: CitationSource = {
  sourceType: 'web', ref: 'Abc234', url: 'https://example.com/article',
  title: 'Original article', snippet: 'Original excerpt', authors: ['Alice', 'Bob'],
  containerTitle: 'Original Journal', publishedAt: '2026-01-02',
};
const knowledgeSource: CitationSource = {
  sourceType: 'knowledge_base', ref: 'Def567', docId: 'document-1', blockId: 'block-1',
  kbId: 'knowledge-1', title: 'Original knowledge', snippet: 'Original block',
};

function emptyScope(reservedRefs: readonly string[] = []) {
  return createDocumentCitationWriteScope({ existingSources: [], conversationRefs: [], reservedRefs });
}

describe('document citation write scope', () => {
  it('用真实会话别名解析既有来源，但保存时复用文档原别名与整份快照', () => {
    const scope = createDocumentCitationWriteScope({
      existingSources: [webSource, knowledgeSource],
      conversationRefs: ['GhJ678', 'Kmn789'], reservedRefs: ['Abc234', 'Def567'],
    });
    expect(scope.resolveExistingAlias('GhJ678')).toEqual({ ...webSource, ref: 'GhJ678' });
    expect(scope.resolveExistingAlias('Kmn789')).toEqual({ ...knowledgeSource, ref: 'Kmn789' });
    expect(scope.resolveExistingAlias('Abc234')).toBeUndefined();
    expect(scope.assignDocumentSource({
      sourceType: 'web', ref: 'GhJ678', url: webSource.url, title: 'Later title',
      snippet: 'Later excerpt', authors: ['Later author'],
    })).toEqual(webSource);
    expect(scope.assignDocumentSource({ ...knowledgeSource, ref: 'Kmn789', kbId: 'later-kb' }))
      .toEqual(knowledgeSource);
    expect(webSource.ref).toBe('Abc234');
  });

  it('新增来源可沿用空闲 incoming ref，同源再次出现保留第一次分配的完整快照', () => {
    const scope = emptyScope();
    expect(scope.assignDocumentSource(webSource)).toEqual(webSource);
    expect(scope.assignDocumentSource({
      ...webSource, ref: 'GhJ678', title: 'Later title', snippet: 'Later excerpt',
    })).toEqual(webSource);
    expect(scope.resolveExistingAlias(webSource.ref)).toBeUndefined();
    // 局部作用域不泄露到下一次操作。
    expect(emptyScope().assignDocumentSource({ ...webSource, ref: 'GhJ678' }).ref).toBe('GhJ678');
  });

  it('避让基线、pending 与本次占位，碰撞只使用 Citation 的确定性候选规则', () => {
    const identity = createCitationSourceIdentity(webSource);
    const firstCandidate = createCitationRefCandidate(identity, 0);
    const scope = emptyScope([webSource.ref, firstCandidate]);
    const assigned = scope.assignDocumentSource(webSource);
    expect(assigned).toEqual({ ...webSource, ref: createCitationRefCandidate(identity, 1) });
    const second = scope.assignDocumentSource({ ...knowledgeSource, ref: assigned.ref });
    expect(second.ref).toBe(createCitationRefCandidate(createCitationSourceIdentity(knowledgeSource), 0));
    expect(second.ref).not.toBe(assigned.ref);
    expect(scope.assignDocumentSource({ ...webSource, ref: 'GhJ678' })).toEqual(assigned);
  });

  it('既有文档 ref 即使未列入 reserved 也不能被另一个来源占用', () => {
    const scope = createDocumentCitationWriteScope({
      existingSources: [webSource], conversationRefs: ['GhJ678'], reservedRefs: [],
    });
    const assigned = scope.assignDocumentSource({ ...knowledgeSource, ref: webSource.ref });
    expect(assigned.ref).not.toBe(webSource.ref);
    expect(scope.assignDocumentSource({ ...webSource, ref: 'GhJ678' })).toEqual(webSource);
  });

  it('候选全部占用时明确失败，不覆盖已有来源或放宽 ref 规则', () => {
    const identity = createCitationSourceIdentity(webSource);
    const candidates = Array.from({ length: MAX_CITATION_REF_COLLISION_ATTEMPTS },
      (_, attempt) => createCitationRefCandidate(identity, attempt));
    const scope = emptyScope([webSource.ref, ...candidates]);
    expect(() => scope.assignDocumentSource(webSource)).toThrow(/无法为文档分配唯一/);
  });

  it('拒绝不对齐、非法别名，以及同 ref 不同来源的输入', () => {
    expect(() => createDocumentCitationWriteScope({
      existingSources: [webSource], conversationRefs: [], reservedRefs: [],
    })).toThrow(/逐项对齐/);
    expect(() => createDocumentCitationWriteScope({
      existingSources: [webSource], conversationRefs: ['bad'], reservedRefs: [],
    })).toThrow(/canonical/);
    expect(() => createDocumentCitationWriteScope({
      existingSources: [webSource, { ...knowledgeSource, ref: webSource.ref }],
      conversationRefs: ['GhJ678', 'Kmn789'], reservedRefs: [],
    })).toThrow(/不同来源锚点/);
    expect(() => createDocumentCitationWriteScope({
      existingSources: [webSource, knowledgeSource],
      conversationRefs: ['GhJ678', 'GhJ678'], reservedRefs: [],
    })).toThrow(/不同来源锚点/);
    expect(() => createDocumentCitationWriteScope({
      existingSources: [webSource, { ...webSource, ref: 'Def567' }],
      conversationRefs: ['GhJ678', 'GhJ678'], reservedRefs: [],
    })).toThrow(/同一来源保存了不同 ref/);
  });
});
