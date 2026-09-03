import { describe, expect, it } from 'vitest';
import { admitCitationSources } from '../admitCitationSources';

describe('admitCitationSources', () => {
  it('按正文首次出现顺序接纳 Knowledge 与 Web 来源', () => {
    const admitted = admitCitationSources({
      requestedRefs: ['Abc234', 'Def567'],
      candidates: [{
        sourceType: 'web',
        ref: 'Def567',
        url: 'https://example.com/article',
        title: 'Web title',
        snippet: 'Web snapshot',
      }, {
        sourceType: 'knowledge_base',
        ref: 'Abc234',
        docId: 'doc-1',
        blockId: 'block-1',
        kbId: 'kb-1',
        title: 'Knowledge title',
        snippet: 'Knowledge snapshot',
      }],
    });

    expect(Object.keys(admitted)).toEqual(['Abc234', 'Def567']);
    expect(admitted['Abc234']).toMatchObject({
      sourceType: 'knowledge_base',
      docId: 'doc-1',
      blockId: 'block-1',
    });
    expect(admitted['Def567']).toMatchObject({
      sourceType: 'web',
      url: 'https://example.com/article',
    });
  });

  it('同一锚点重复时保留 resolver 的第一条快照', () => {
    const admitted = admitCitationSources({
      requestedRefs: ['Abc234'],
      candidates: [{
        sourceType: 'web',
        ref: 'Abc234',
        url: 'https://example.com/article',
        title: 'Latest title',
        snippet: 'Latest snapshot',
      }, {
        sourceType: 'web',
        ref: 'Abc234',
        url: 'https://example.com/article',
        title: 'Older title',
        snippet: 'Older snapshot',
      }],
    });

    expect(admitted['Abc234']?.title).toBe('Latest title');
  });

  it('拒绝同一 ref 指向不同来源锚点', () => {
    expect(() => admitCitationSources({
      requestedRefs: ['Abc234'],
      candidates: [{
        sourceType: 'knowledge_base',
        ref: 'Abc234',
        docId: 'doc-1',
        blockId: 'block-1',
        title: 'Title',
        snippet: 'Snapshot',
      }, {
        sourceType: 'knowledge_base',
        ref: 'Abc234',
        docId: 'doc-2',
        blockId: 'block-2',
        title: 'Other title',
        snippet: 'Other snapshot',
      }],
    })).toThrow('对应了不同来源锚点');
  });

  it('拒绝未命中的 ref 和非 HTTP(S) Web 来源', () => {
    expect(() => admitCitationSources({
      requestedRefs: ['Abc234'],
      candidates: [],
    })).toThrow('无法验证引用');

    expect(() => admitCitationSources({
      requestedRefs: ['Abc234'],
      candidates: [{
        sourceType: 'web',
        ref: 'Abc234',
        url: 'file:///tmp/source.html',
        title: 'Title',
        snippet: 'Snapshot',
      }],
    })).toThrow('只允许 HTTP(S)');
  });

  it('拒绝 resolver 返回未请求来源', () => {
    expect(() => admitCitationSources({
      requestedRefs: ['Abc234'],
      candidates: [{
        sourceType: 'web',
        ref: 'Def567',
        url: 'https://example.com',
        title: 'Title',
        snippet: 'Snapshot',
      }],
    })).toThrow('返回了未请求的 ref');
  });
});
