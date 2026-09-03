import { generateEditorBlockId, generateEditorRootBlockId } from '../../../../../shared/utils/idUtils';
import type { MarkdownDocJson } from '../../normalization';

export function createDefaultMarkdownDocument(): MarkdownDocJson {
  return {
    type: 'doc',
    content: [
      {
        type: 'rootBlock',
        attrs: { id: generateEditorRootBlockId() },
        content: [
          {
            type: 'baseBlock',
            attrs: {
              id: generateEditorBlockId(),
              blockType: 'base',
            },
            content: [],
          },
        ],
      },
    ],
  };
}
