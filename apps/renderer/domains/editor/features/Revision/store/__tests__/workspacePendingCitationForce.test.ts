import { describe, expect, it } from 'vitest';
import { pendingListMayAffectCitationDerivation } from '../workspacePendingCitation';
import type { PendingRevisionDTO } from '../../../../../../shared/ipc/workspaceGateway';

function pending(overrides: Partial<PendingRevisionDTO>): PendingRevisionDTO {
  return {
    id: 'p1',
    blockId: 'b1',
    newMarkdown: 'plain text',
    source: 'tool',
    operation: 'update',
    metaJson: null,
    createdAt: 1,
    updatedAt: null,
    ...overrides,
  };
}

describe('pendingListMayAffectCitationDerivation', () => {
  it('普通 pending 不触发 citation 强制派生', () => {
    expect(pendingListMayAffectCitationDerivation([pending({})])).toBe(false);
  });

  it('newMarkdown 包含 citation token 时触发 citation 强制派生', () => {
    expect(pendingListMayAffectCitationDerivation([pending({ newMarkdown: '引用 [@Abc234]' })])).toBe(true);
  });

  it('metaJson 包含 citation_hydration 时触发 citation 强制派生', () => {
    expect(
      pendingListMayAffectCitationDerivation([
        pending({
          metaJson: JSON.stringify({
            operation: 'update',
            citation_hydration: {
              Abc234: {
                title: '标题',
                snippet: '片段',
                docId: 'doc',
                blockId: 'block',
              },
            },
          }),
        }),
      ])
    ).toBe(true);
  });

  it('非法 metaJson 不触发，也不抛错', () => {
    expect(pendingListMayAffectCitationDerivation([pending({ metaJson: '{broken' })])).toBe(false);
  });
});
