import type { EditorMessageResolver } from '../../../definitions/editorMessages';
import type { ReviewAgent } from '../definitions/reviewAgent';
import type { ReviewProgressState } from '../definitions/reviewProgress';
import { resolveReviewAgentName } from './reviewAgentPresentation';

export interface ReviewProgressPresentation {
  readonly agentName: string;
  readonly text: string;
}

export function readReviewProgressPresentation(
  progress: ReviewProgressState,
  availableAgents: readonly ReviewAgent[],
  editorMessage: EditorMessageResolver,
): ReviewProgressPresentation {
  if (progress.phase === 'preparing') {
    return {
      agentName: '',
      text: editorMessage('editor.review.processing.preparing'),
    };
  }

  if (progress.phase === 'reviewingChunk') {
    const chunkIndex = typeof progress.chunkIndex === 'number' ? progress.chunkIndex : 0;
    const totalChunks = typeof progress.totalChunks === 'number' ? progress.totalChunks : 0;

    return {
      agentName: progress.agentId
        ? resolveReviewAgentName(progress.agentId, availableAgents, editorMessage)
        : '',
      text: editorMessage('editor.review.processing.reviewingChunk', {
        current: chunkIndex + 1,
        total: totalChunks,
      }),
    };
  }

  if (progress.phase === 'completed') {
    return {
      agentName: '',
      text: editorMessage('editor.review.processing.completed'),
    };
  }

  if (progress.phase === 'failed') {
    return {
      agentName: '',
      text: editorMessage('editor.review.processing.failed'),
    };
  }

  return {
    agentName: '',
    text: '',
  };
}
