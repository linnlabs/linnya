import { Extension } from '@tiptap/core';

// 导入所有共享快捷键处理函数
// 注意：handleSaveShortcut 已移至 AppLayout.vue 作为全局快捷键处理
// import { handleSaveShortcut } from './handlers/FileKeys';
import { handleEnter, handleBackspace, handleDeleteOnEmptyBlock } from './handlers/BlockEditing';
import { handleTab, handleShiftTab } from './handlers/Indentation';
import { handleMoveBlockUp, handleMoveBlockDown } from './handlers/BlockMove';
import { handleBlockArrowUp, handleBlockArrowDown, handleBlockArrowLeft, handleBlockArrowRight } from './handlers/BlockNavigation';

// 使用具有描述性前缀的ID，便于管理和调试
const ID_PREFIX = {
  FILE: 'file',
  BLOCK_EDITING: 'block-editing',
  INDENTATION: 'indentation',
  BLOCK_MOVE: 'block-move',
  BLOCK_NAVIGATION: 'block-navigation',
};

/**
 * CoreShortcutExtension
 * 
 * 一个聚合性的扩展，处理所有共享快捷键，包括：
 * - 文件操作（如保存）
 * - 块编辑（Enter, Backspace, Delete）
 * - 缩进（Tab, Shift+Tab）
 * - 块移动（Alt+ArrowUp, Alt+ArrowDown）
 */
export const CoreShortcutExtension = Extension.create({
  name: 'coreShortcutExtension',

  onCreate() {
    const editor = this.editor;
    
    // 确保注册表存在
    if (!editor.storage.keyboardRegistry) {
      console.warn('[CoreShortcutExtension] KeyboardRegistry not found on editor storage. Core shortcuts not registered.');
      return;
    }

    // ========== 文件操作快捷键 ==========
    // 注意：保存快捷键 (Ctrl+S/Cmd+S) 已在 AppLayout.vue 中作为全局快捷键处理
    // 这样可以确保在 editor-shell 的任意位置按下都能保存，而不仅限于编辑器获得焦点时
    // editor.storage.keyboardRegistry.register({
    //   keys: 'Mod-s',
    //   handler: handleSaveShortcut,
    //   phase: 'normal',
    //   priority: 100,
    //   id: `${ID_PREFIX.FILE}-save`,
    // });

    // ========== 块编辑快捷键 ==========
    editor.storage.keyboardRegistry.register({
      keys: 'Enter',
      handler: handleEnter,
      phase: 'normal',
      priority: 100, // 给予较高优先级，但在autocomplete等pre处理器之后
      id: `${ID_PREFIX.BLOCK_EDITING}-enter`,
    });

    editor.storage.keyboardRegistry.register({
      keys: 'Backspace',
      handler: handleBackspace,
      phase: 'normal',
      priority: 100,
      id: `${ID_PREFIX.BLOCK_EDITING}-backspace`,
    });

    editor.storage.keyboardRegistry.register({
      keys: 'Delete',
      handler: handleDeleteOnEmptyBlock,
      phase: 'normal',
      priority: 100,
      id: `${ID_PREFIX.BLOCK_EDITING}-delete-on-empty`,
    });

    // ========== 缩进快捷键 ==========
    editor.storage.keyboardRegistry.register({
      keys: 'Tab',
      handler: handleTab,
      phase: 'normal',
      // 给缩进较低的优先级，让自动补全等功能可以先处理Tab键
      priority: 90, 
      id: `${ID_PREFIX.INDENTATION}-tab`,
    });

    editor.storage.keyboardRegistry.register({
      keys: 'Shift-Tab',
      handler: handleShiftTab,
      phase: 'normal',
      priority: 90,
      id: `${ID_PREFIX.INDENTATION}-shift-tab`,
    });

    // ========== 块移动快捷键 ==========
    editor.storage.keyboardRegistry.register({
      keys: 'Alt-ArrowUp',
      handler: handleMoveBlockUp,
      phase: 'normal',
      priority: 100,
      id: `${ID_PREFIX.BLOCK_MOVE}-up`,
    });

    editor.storage.keyboardRegistry.register({
      keys: 'Alt-ArrowDown',
      handler: handleMoveBlockDown,
      phase: 'normal',
      priority: 100,
      id: `${ID_PREFIX.BLOCK_MOVE}-down`,
    });

    // ========== 块导航快捷键 ==========
    editor.storage.keyboardRegistry.register({
      keys: 'ArrowUp',
      handler: handleBlockArrowUp,
      phase: 'normal',
      priority: 95, // 优先级略低于表格内部导航(100)
      id: `${ID_PREFIX.BLOCK_NAVIGATION}-up`,
    });

    editor.storage.keyboardRegistry.register({
      keys: 'ArrowDown',
      handler: handleBlockArrowDown,
      phase: 'normal',
      priority: 95,
      id: `${ID_PREFIX.BLOCK_NAVIGATION}-down`,
    });

    editor.storage.keyboardRegistry.register({
      keys: 'ArrowLeft',
      handler: handleBlockArrowLeft,
      phase: 'normal',
      priority: 95,
      id: `${ID_PREFIX.BLOCK_NAVIGATION}-left`,
    });

    editor.storage.keyboardRegistry.register({
      keys: 'ArrowRight',
      handler: handleBlockArrowRight,
      phase: 'normal',
      priority: 95,
      id: `${ID_PREFIX.BLOCK_NAVIGATION}-right`,
    });

    console.log('[CoreShortcutExtension] All core keyboard handlers registered.');
  },

  onDestroy() {
    const editor = this.editor;
    
    if (!editor.storage.keyboardRegistry) return;

    // 注销所有处理器
    // 文件操作（保存快捷键已在 AppLayout.vue 中全局处理，无需注销）
    // editor.storage.keyboardRegistry.unregister(`${ID_PREFIX.FILE}-save`);
    
    // 块编辑
    editor.storage.keyboardRegistry.unregister(`${ID_PREFIX.BLOCK_EDITING}-enter`);
    editor.storage.keyboardRegistry.unregister(`${ID_PREFIX.BLOCK_EDITING}-backspace`);
    editor.storage.keyboardRegistry.unregister(`${ID_PREFIX.BLOCK_EDITING}-delete-on-empty`);
    
    // 缩进
    editor.storage.keyboardRegistry.unregister(`${ID_PREFIX.INDENTATION}-tab`);
    editor.storage.keyboardRegistry.unregister(`${ID_PREFIX.INDENTATION}-shift-tab`);
    
    // 块移动
    editor.storage.keyboardRegistry.unregister(`${ID_PREFIX.BLOCK_MOVE}-up`);
    editor.storage.keyboardRegistry.unregister(`${ID_PREFIX.BLOCK_MOVE}-down`);

    // 块导航
    editor.storage.keyboardRegistry.unregister(`${ID_PREFIX.BLOCK_NAVIGATION}-up`);
    editor.storage.keyboardRegistry.unregister(`${ID_PREFIX.BLOCK_NAVIGATION}-down`);
    editor.storage.keyboardRegistry.unregister(`${ID_PREFIX.BLOCK_NAVIGATION}-left`);
    editor.storage.keyboardRegistry.unregister(`${ID_PREFIX.BLOCK_NAVIGATION}-right`);
    
    console.log('[CoreShortcutExtension] All core keyboard handlers unregistered.');
  },
});

export default CoreShortcutExtension; 