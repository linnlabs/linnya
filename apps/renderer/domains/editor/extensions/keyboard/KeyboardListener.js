import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from 'prosemirror-state';
import { useUIStore } from '../../../../shared/stores/ui';
import { PositionUtils } from '../position/PositionUtils';

import { KeyboardRegistry } from './KeyboardRegistry'; // Import KeyboardRegistry

// 定义调试标志和日志函数 (保留条件日志的选项)
const DEBUG = false;
const debugLog = (...args) => {
  if (DEBUG) {
    console.log('[KeyboardListener]', ...args);
  }
};

// let handleDeleteCommand; // Temporarily comment out

export const KeyboardListener = Extension.create({
  name: 'keyboardListener',

  onCreate() {
    if (!this.editor.storage.keyboardRegistry) {
      this.editor.storage.keyboardRegistry = new KeyboardRegistry();
    } else {
    }
  },

  addProseMirrorPlugins() {
    const extension = this; 


    return [
      new Plugin({
        key: new PluginKey('unifiedKeyboardHandler'), 
        props: {
          handleKeyDown(view, event) {
            const { state, dispatch } = view;
            const { selection, doc } = state;
            const { $cursor, empty } = selection;
            const editor = extension.editor; 

            let posUtils = null; 
            const getPosUtils = () => {
                if (!posUtils) {
                    posUtils = new PositionUtils(editor);
                }
                return posUtils;
            };
            
            let uiStore = null;
            const getUIStore = () => {
                if (!uiStore) {
                    uiStore = useUIStore();
                }
                return uiStore;
            }

            // 这里似乎依赖了annotationstore，未来考虑解耦
            const getAnnotationStore = () => {
                return editor.annotationStore; 
            }

            const handlerContext = {
              view, event, state, dispatch, selection, doc, $cursor, empty, editor,
              getPosUtils, getUIStore, getAnnotationStore, 
              debugLog: (...args) => { if (DEBUG) console.log('[KeyboardListenerContext]', ...args); } // 从这里传递条件日志
            };

            // New core logic: Dispatch to the KeyboardRegistry
            if (editor.storage.keyboardRegistry && 
                typeof editor.storage.keyboardRegistry.dispatch === 'function' && 
                editor.storage.keyboardRegistry.dispatch(event, handlerContext)) {
              return true;
            }

            return false; // No registered handler processed the event
          }
        }
      })
    ];
  },
});

export default KeyboardListener; 