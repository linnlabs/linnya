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
  return createDocumentCitationWriteScope({ existingSources: [], conversationRefs: [], reservedSources: [], reservedRefs });
}

describe('document citation write scope', () => {
  it('用真实会话别名解析既有来源，但保存时复用文档原别名与整份快照', () => {
    const scope = createDocumentCitationWriteScope({
      existingSources: [webSource, knowledgeSource],
      conversationRefs: ['GhJ678', 'Kmn789'], reservedSources: [], reservedRefs: ['Abc234', 'Def567'],
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
      existingSources: [webSource], conversationRefs: ['GhJ678'], reservedSources: [], reservedRefs: [],
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
      existingSources: [webSource], conversationRefs: [], reservedSources: [], reservedRefs: [],
    })).toThrow(/逐项对齐/);
    expect(() => createDocumentCitationWriteScope({
      existingSources: [webSource], conversationRefs: ['bad'], reservedSources: [], reservedRefs: [],
    })).toThrow(/canonical/);
    expect(() => createDocumentCitationWriteScope({
      existingSources: [webSource, { ...knowledgeSource, ref: webSource.ref }],
      conversationRefs: ['GhJ678', 'Kmn789'], reservedSources: [], reservedRefs: [],
    })).toThrow(/不同来源锚点/);
    expect(() => createDocumentCitationWriteScope({
      existingSources: [webSource, knowledgeSource],
      conversationRefs: ['GhJ678', 'GhJ678'], reservedSources: [], reservedRefs: [],
    })).toThrow(/不同来源锚点/);
    expect(() => createDocumentCitationWriteScope({
      existingSources: [webSource, { ...webSource, ref: 'Def567' }],
      conversationRefs: ['GhJ678', 'GhJ678'], reservedSources: [], reservedRefs: [],
    })).toThrow(/同一来源保存了不同 ref/);
  });
});


describe('baseline 来源被 pending 隐藏后的恢复', () => {
  it('恢复隐藏来源时复用 baseline 原 ref 与完整快照，不从 incoming 补成新版本', () => {
    const scope = createDocumentCitationWriteScope({
      existingSources: [], conversationRefs: [], reservedSources: [webSource],
      reservedRefs: [webSource.ref],
    });
    const incoming: CitationSource = {
      sourceType: 'web', ref: 'GhJ678', url: webSource.url,
      title: 'Later title', snippet: 'Later excerpt', authors: ['Later author'],
    };
    expect(scope.assignDocumentSource(incoming)).toEqual(webSource);
    expect(scope.assignDocumentSource({ ...incoming, ref: 'Kmn789' })).toEqual(webSource);
    expect(scope.resolveExistingAlias('GhJ678')).toBeUndefined();
  });

  it('preview 同 identity 的整份快照与 ref 优先于 baseline，不把基线缺失字段补回', () => {
    const preview: CitationSource = {
      sourceType: 'web', ref: 'Def567', url: webSource.url,
      title: 'Preview title', snippet: 'Preview excerpt',
    };
    const scope = createDocumentCitationWriteScope({
      existingSources: [preview], conversationRefs: ['GhJ678'],
      reservedSources: [webSource], reservedRefs: [webSource.ref, preview.ref],
    });
    expect(scope.assignDocumentSource({ ...webSource, ref: 'GhJ678' })).toEqual(preview);
    expect(scope.resolveExistingAlias('GhJ678')).toEqual({ ...preview, ref: 'GhJ678' });
    expect(scope.assignDocumentSource({ ...knowledgeSource, ref: webSource.ref }).ref)
      .not.toBe(webSource.ref);
  });

  it('preview 已把基线 ref 交给另一来源时优先保留 preview，恢复的旧来源另分配且避让占位', () => {
    const preview = { ...knowledgeSource, ref: webSource.ref };
    const scope = createDocumentCitationWriteScope({
      existingSources: [preview], conversationRefs: ['GhJ678'],
      reservedSources: [webSource], reservedRefs: [webSource.ref, 'Kmn789'],
    });
    expect(scope.assignDocumentSource({ ...knowledgeSource, ref: 'GhJ678' })).toEqual(preview);
    const restored = scope.assignDocumentSource({ ...webSource, ref: 'Kmn789' });
    expect(restored).toEqual({ ...webSource,
      ref: createCitationRefCandidate(createCitationSourceIdentity(webSource), 0),
    });
    expect(restored.ref).not.toBe(preview.ref);
    expect(restored.ref).not.toBe('Kmn789');
  });
});
