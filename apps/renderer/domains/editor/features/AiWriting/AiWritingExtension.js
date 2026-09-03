import { Extension } from '@tiptap/core';
import { handleSpaceForAI, handleCtrlJ } from './keyboard/AiInteraction';
import { PositionUtils } from '../../extensions/position/PositionUtils';
import { useUIStore } from '../../../../shared/stores/ui';

// Define unique IDs for the handlers to allow unregistering
const HANDLE_SPACE_AI_ID = Symbol.for('aiWritingSpaceHandler');
const HANDLE_CTRL_J_ID = Symbol.for('aiWritingCtrlJHandler');

export const AiWritingExtension = Extension.create({
  name: 'aiWritingExtension',

  onCreate() {
    if (!this.editor.storage.keyboardRegistry) {
      console.error('[AiWritingExtension] KeyboardRegistry not found on editor.storage. Cannot register AI keyboard handlers.');
      return;
    }

    // Register Space Handler for AI Prompt
    this.editor.storage.keyboardRegistry.register({
      keys: 'Space',
      handler: (context) => {

        const posUtils = new PositionUtils(context.editor);
        const uiStore = useUIStore(); 

        return handleSpaceForAI({
          view: context.view,
          event: context.event,
          $cursor: context.state.selection.$cursor,
          getPosUtils: () => posUtils, 
          getUIStore: () => uiStore,   
          debugLog: (...args) => { if (/* some_dev_flag */ false) console.debug('[AiSpaceHandler]', ...args); }, // Conditional logging
        });
      },
      phase: 'pre',
      priority: 100,
      id: HANDLE_SPACE_AI_ID,
    });

    // Register Ctrl/Cmd + J Handler for AI Prompt
    this.editor.storage.keyboardRegistry.register({
      keys: 'Mod-j',
      handler: (context) => {
        const posUtils = new PositionUtils(context.editor);
        const uiStore = useUIStore();
        
        return handleCtrlJ({
          view: context.view,
          event: context.event,
          $cursor: context.state.selection.$cursor,
          getPosUtils: () => posUtils,
          getUIStore: () => uiStore,
          debugLog: (...args) => { if (/* some_dev_flag */ false) console.debug('[AiCtrlJHandler]', ...args); }, // Conditional logging
        });
      },
      phase: 'normal',
      priority: 0,
      id: HANDLE_CTRL_J_ID,
    });

  },

  onDestroy() {
    if (this.editor.storage.keyboardRegistry) {
      this.editor.storage.keyboardRegistry.unregister(HANDLE_SPACE_AI_ID);
      this.editor.storage.keyboardRegistry.unregister(HANDLE_CTRL_J_ID);
    }
  },
});

export default AiWritingExtension; 