import { h, type FunctionalComponent } from 'vue';
import type { ConversationInputContextBarProps } from '@/domains/conversation/features/input-extensions';
import { TableAiComposerContext } from '@/domains/editor/features/table-ai-mode';
import { createTableFillComposerPort } from '../functions/createTableFillComposerPort';
import { resolveCurrentTableFillMessage } from '../functions/resolveCurrentTableFillMessage';

const TableFillConversationInputContext: FunctionalComponent<
  ConversationInputContextBarProps
> = props => h(TableAiComposerContext, {
  composer: createTableFillComposerPort(props.handles.composer),
  closeTitle: resolveCurrentTableFillMessage('tableFill.context.exitMode'),
  onRequestClose: () => {
    void props.handles.deactivate();
  },
});

TableFillConversationInputContext.displayName = 'TableFillConversationInputContext';

export default TableFillConversationInputContext;
