import { Extension } from '@tiptap/core';
import allCoreCommands from './commands'; // 导入命令注册表

export const CoreCommandsExtension = Extension.create({
    name: 'coreCommands',

    // 这个扩展的核心功能：添加命令
    addCommands() {
        return allCoreCommands;
    },

    // 这个扩展通常不需要添加其他 ProseMirror 插件、快捷键等
    // addProseMirrorPlugins() { return []; },
    // addKeyboardShortcuts() { return {}; },
});

export default CoreCommandsExtension; 