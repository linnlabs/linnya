import { inject } from 'vue';
import {
  RENDERED_ANSWER_TRANSFER_PORT_KEY,
  type RenderedAnswerTransferPort,
} from '../definitions/renderedAnswerTransfer';

export function useRenderedAnswerTransfer(): RenderedAnswerTransferPort {
  const port = inject(RENDERED_ANSWER_TRANSFER_PORT_KEY, null);
  if (!port) {
    throw new Error('[answer-transfer] 当前 Conversation 宿主未提供回答渲染端口');
  }
  return port;
}
