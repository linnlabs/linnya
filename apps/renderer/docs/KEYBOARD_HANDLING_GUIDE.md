# 指南：键盘事件处理与注册表标准化方案

**目的：**

本文档旨在为项目中 Tiptap/ProseMirror 插件提供一套标准的、解耦的键盘事件处理机制。目标是提高模块化、可维护性、可扩展性，并遵循分层架构的最佳实践，特别是解耦 `KeyboardListener.js`。

**核心设计模式：带元数据的单一（或分阶段）键盘处理器注册表**

**1. 注册表结构 (`KeyHandlerEntry`)**

*   不采用多个独立的注册表键（如 `KEYBOARD_PRE_HANDLERS_KEY`, `KEYBOARD_CORE_HANDLERS_KEY` 等）。
*   采用单一注册表实例 (`KeyboardRegistry`)，内部管理一个处理器列表。每个注册的处理器是一个对象，包含：
    *   `keys`: 字符串或字符串数组，描述该处理器响应的按键组合（例如 `'Tab'`, `'Enter'`, `'Mod-S'`, `'Shift-ArrowUp'`）。可以使用类似于 Tiptap `addKeyboardShortcuts` 的格式。
    *   `handler`: `(context: HandlerContext) => boolean`。实际的事件处理逻辑。返回 `true` 表示事件已处理并应停止传播。
    *   `phase` (可选, 默认: `'normal'`): `'pre' | 'normal' | 'post'`。用于粗粒度地划分处理阶段。
        *   `'pre'`: 最高优先级，用于需要抢占原生行为或默认行为的场景（如 Autocomplete 的 Tab，特殊块内的快捷键）。
        *   `'normal'`: 普通优先级，用于大多数自定义的编辑行为或快捷键。
        *   `'post'`: 最低优先级，用于在所有其他处理都未命中时的兜底逻辑（较少使用）。
    *   `priority` (可选, 默认: `0`): 数字。在同一 `phase` 内部，`priority` 越高的处理器越先执行。
    *   `id`: 字符串或 `Symbol` (推荐)。用于在注销时唯一标识处理器。

**2. `KeyboardRegistry` 类/对象**

*   将在 `shared` 层实现 (例如 `src/renderer/shared/keyboard/KeyboardRegistry.js`)。
*   提供方法：
    *   `register(entry: KeyHandlerEntry)`: 将处理器条目添加到注册表中。内部会根据 `phase` 和 `priority` 维护一个有序的结构。
    *   `unregister(id: string | Symbol)`: 根据 ID 移除处理器。
    *   `dispatch(event: KeyboardEvent, context: HandlerContext): boolean`:
        *   核心调度逻辑。
        *   根据传入的 `event` 匹配注册表中所有符合 `keys` 描述的处理器。
        *   按照 `phase` (`pre` -> `normal` -> `post`) 和 `priority` (高 -> 低) 的顺序，依次调用匹配到的 `handler(context)`。
        *   一旦某个 `handler` 返回 `true`，`dispatch` 方法立即返回 `true`。
        *   如果所有匹配的 `handler` 都返回 `false`，则 `dispatch` 方法返回 `false`。

**3. `KeyboardListener.js` 的改造**

*   移除所有对特性模块处理函数的直接导入。
*   在其 `onCreate` (或扩展初始化) 阶段，创建（或获取）`KeyboardRegistry` 实例，并挂载到 `this.editor.storage.keyboardRegistry = registryInstance;`。
*   在其 ProseMirror 插件的 `handleKeyDown` 属性中：
    *   创建 `handlerContext` (保持惰性加载依赖的方式)。
    *   调用 `this.editor.storage.keyboardRegistry.dispatch(event, handlerContext)`。
    *   如果 `dispatch` 返回 `true`，则 `handleKeyDown` 也返回 `true`。

**4. 特性模块及其他键盘处理逻辑的改造**

*   每个需要自定义键盘处理的 Tiptap 扩展，在其 `onCreate` 生命周期钩子中：
    *   访问 `this.editor.storage.keyboardRegistry`。
    *   调用 `register()` 方法注册自己的键盘处理器条目，包括 `keys`, `handler`, `phase`, `priority`, 和一个唯一的 `id`。
    *   `handler` 函数是之前在 `KeyboardListener.js` 中被直接调用的那些函数，但现在从各自模块中注册。
*   在其 `onDestroy` 生命周期钩子中，调用 `unregister(id)` 来移除处理器。

**5. `handlerContext` 的最小化/惰性化**

*   继续使用当前的 `getXxxStore()` / `getPosUtils()` 这种惰性获取方式。

**6. 处理 `Autocomplete` 的 `Tab` 键 (示例)**

*   `AutoComplete` 扩展将注册一个 `KeyHandlerEntry`：
    ```javascript
    // In AutoComplete.js extension's onCreate method
    this.editor.storage.keyboardRegistry.register({
      keys: 'Tab',
      handler: (context) => { 
        // Logic to check if autocomplete is active and accept suggestion
        // Presuming access to Autocomplete state via context.editor or context.view.state
        // For example:
        // const autocompleteState = AutocompletePluginKey.getState(context.state);
        // if (autocompleteState && autocompleteState.activeSuggestion) { 
        //   context.editor.commands.acceptAutocompleteSuggestion(); // Assuming such a command exists
        //   return true; 
        // }
        return false; 
      },
      phase: 'pre',
      priority: 120, // High priority
      id: 'autocomplete-tab-accept'
    });
    ```

**方案优势：**

*   **高度解耦**：`KeyboardListener.js` 职责单一。
*   **清晰的优先级管理**：通过 `phase` 和 `priority`。
*   **可扩展性**：方便添加新的键盘行为。
*   **单一注册点**：避免管理多个注册表的复杂性。
*   **符合业界实践**。

--- 