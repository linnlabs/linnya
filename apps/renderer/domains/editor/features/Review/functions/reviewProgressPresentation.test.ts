import { describe, expect, it } from 'vitest';
import type { EditorMessageResolver } from '../../../definitions/editorMessages';
import type { ReviewAgent } from '../definitions/reviewAgent';
import { readReviewProgressPresentation } from './reviewProgressPresentation';

const testMessage: EditorMessageResolver = (key, params) => {
  const messages = {
    'editor.common.unknownError': 'Unknown error',
    'editor.review.agent.logicCheck.name': 'Logic check',
    'editor.review.agent.structure.name': 'Structure review',
    'editor.review.agent.polish.name': 'Text polish',
    'editor.review.processing.preparing': 'Preparing...',
    'editor.review.processing.reviewingChunk': `Reviewing ${params?.current}/${params?.total}`,
    'editor.review.processing.completed': 'Complete',
    'editor.review.processing.failed': 'Failed. Try again.',
  } satisfies Partial<Record<Parameters<EditorMessageResolver>[0], string>>;

  return messages[key] ?? key;
};

const agents: ReviewAgent[] = [
  { id: 'logicCheck', knowledge: '', isCustom: false },
];

describe('reviewProgressPresentation', () => {
  it('展示准备状态', () => {
    expect(readReviewProgressPresentation({ phase: 'preparing' }, agents, testMessage)).toEqual({
      agentName: '',
      text: 'Preparing...',
    });
  });

  it('展示当前角色和分段进度', () => {
    expect(readReviewProgressPresentation({
      phase: 'reviewingChunk',
      agentId: 'logicCheck',
      chunkIndex: 1,
      totalChunks: 3,
    }, agents, testMessage)).toEqual({
      agentName: 'Logic check',
      text: 'Reviewing 2/3',
    });
  });

  it('展示失败状态时不拼接底层异常详情', () => {
    expect(readReviewProgressPresentation({ phase: 'failed' }, agents, testMessage)).toEqual({
      agentName: '',
      text: 'Failed. Try again.',
    });
  });
});
