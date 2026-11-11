import type { BlockVersionOriginType } from '../../../../../shared/ipc/blockHistoryGateway';
import type { EditorMessageResolver } from '../../../definitions/editorMessages';

export function readBlockHistoryOriginLabel(
  originType: BlockVersionOriginType,
  message: EditorMessageResolver,
): string {
  switch (originType) {
    case 'ai':
      return message('editor.blockHistory.origin.ai');
    case 'manual':
      return message('editor.blockHistory.origin.manual');
    case 'restore':
      return message('editor.blockHistory.origin.restore');
  }
}
