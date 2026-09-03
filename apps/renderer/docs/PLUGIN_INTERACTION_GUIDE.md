 # 指南：插件间通信与状态共享的标准化方案

**目的：**

本文档旨在为项目中的 Tiptap/ProseMirror 插件（特别是 `shared` 层插件与 `features` 层插件之间，或不同 `features` 插件之间）提供一套标准的、解耦的通信与状态共享机制。目标是提高模块化、可维护性、可扩展性，并遵循分层架构的最佳实践。

**核心原则：依赖倒置**

*   **`shared` 层插件绝不能直接导入或依赖 `features` 层插件的具体实现。**
*   **`features` 层插件之间应尽量避免直接相互依赖。**
*   通信和状态共享应通过定义在 `shared` 层（或由 `app` 层统一协调）的“抽象协定”或“公共服务”进行。

**推荐模式：基于 `editor.storage` 的注册表/回调模式**

这是我们当前采纳并成功实践的模式，用于解决例如“`PlaceholderPlugin` (shared) 如何在 `AutoComplete` (feature) 激活时隐藏自身”这类问题。

**模式详解：**

1.  **定义“协定” (Contract) - 通信的“语言”**
    *   **目的**：定义插件间交互的规则和数据结构。
    *   **实现**：
        *   在 `shared` 层（例如 `src/renderer/shared/extensions/plugins/pluginUtils.js` 或 `shared/constants/pluginKeys.js`）定义一个或多个“众所周知的键 (Well-Known Keys)”。
        *   这些键通常使用 `Symbol.for('aDescriptiveName')` 来创建，以保证全局唯一性，避免命名冲突。也可以使用有良好命名的字符串常量。
        *   **示例**：`export const PLACEHOLDER_VISIBILITY_PREDICATES_KEY = Symbol.for('placeholderVisibilityPredicates');`
        *   这个键将用于在 `editor.storage` 对象上创建一个“注册表”（通常是一个数组）。
        *   同时，清晰地文档化与此键关联的回调函数签名（即这些回调函数应该接受什么参数，返回什么类型的值，以及这个返回值的含义）。
            *   **示例**：对于 `PLACEHOLDER_VISIBILITY_PREDICATES_KEY`，注册的回调函数应为 `(pmState: ProseMirrorState, editor?: Editor) => boolean`。返回 `true` 表示“我希望占位符隐藏”。

2.  **“服务提供方”或“状态暴露方” (通常是 `shared` 层插件，或需要被其他插件观察的插件)**
    *   **角色**：拥有某个状态或行为，并允许其他插件影响或查询它。
    *   **实现**：
        *   在其 Tiptap 扩展的 `onCreate` 生命周期钩子中（或其他适当的初始化位置）：
            *   确保 `this.editor.storage[YOUR_WELL_KNOWN_KEY]` 被初始化为一个空数组 `[]`（或其他合适的初始注册表结构，如对象）。
            *   **示例** (`PlaceholderPlugin.js`):
                ```javascript
                // src/renderer/shared/extensions/plugins/PlaceholderPlugin.js
                import { PLACEHOLDER_VISIBILITY_PREDICATES_KEY } from './pluginUtils';

                // ...
                onCreate() {
                  this.editor.storage[PLACEHOLDER_VISIBILITY_PREDICATES_KEY] =
                    this.editor.storage[PLACEHOLDER_VISIBILITY_PREDICATES_KEY] || [];
                }
                // ...
                ```
        *   在其核心逻辑中（例如 `PlaceholderPlugin` 的 `decorations` 方法）：
            *   安全地访问 `this.editor.storage[YOUR_WELL_KNOWN_KEY]` 以获取注册的回调或数据。
            *   遍历回调列表，执行它们，并根据它们的返回值调整自身行为。
            *   **示例** (`PlaceholderPlugin.js` 的 `decorations`):
                ```javascript
                // ...
                const predicates = editor.storage[PLACEHOLDER_VISIBILITY_PREDICATES_KEY];
                if (Array.isArray(predicates)) {
                  for (const predicate of predicates) {
                    if (typeof predicate === 'function') {
                      if (predicate(state, editor)) { // 调用回调
                        return includeChildren; // 或其他逻辑，表示隐藏占位符
                      }
                    }
                  }
                }
                // ... 正常显示占位符的逻辑 ...
                ```

3.  **“服务消费方”或“状态影响方” (通常是 `features` 层插件，或希望与其他插件交互的插件)**
    *   **角色**：希望影响另一个插件的行为，或根据其自身状态通知其他插件。
    *   **实现**：
        *   在其 Tiptap 扩展的 `addStorage` 方法中，为可能需要保存的回调函数引用预留位置（如果需要在 `onDestroy` 中精确移除）。
            *   **示例** (`AutoComplete.js`):
                ```javascript
                // src/renderer/features/AutoComplete/AutoComplete.js
                addStorage() {
                  return {
                    // ... other storage items
                    placeholderPredicateRef: null,
                  };
                }
                ```
        *   在其 `onCreate` 生命周期钩子中：
            *   导入定义在 `shared` 层的 `YOUR_WELL_KNOWN_KEY`。
            *   （可选，但推荐）再次确保 `this.editor.storage[YOUR_WELL_KNOWN_KEY]` 存在且为数组。
            *   定义一个符合“协定”中回调函数签名的函数。这个函数封装了该插件自身的内部逻辑。
                *   **示例** (`AutoComplete.js`):
                    ```javascript
                    const shouldHidePlaceholderForAutocomplete = (pmState) => {
                      if (!AutocompletePluginKey) return false;
                      try {
                        const autocompletePluginState = AutocompletePluginKey.getState(pmState);
                        return !!(autocompletePluginState && autocompletePluginState.find().length > 0);
                      } catch (error) { return false; }
                    };
                    ```
            *   将这个回调函数 `push` 到 `this.editor.storage[YOUR_WELL_KNOWN_KEY]` 数组中。
            *   将对此回调函数的引用保存到 `this.storage` (或 `this` 的一个属性) 以便后续移除。
                *   **示例** (`AutoComplete.js`):
                    ```javascript
                    this.editor.storage[PLACEHOLDER_VISIBILITY_PREDICATES_KEY].push(shouldHidePlaceholderForAutocomplete);
                    this.storage.placeholderPredicateRef = shouldHidePlaceholderForAutocomplete;
                    ```
        *   在其 `onDestroy` 生命周期钩子中（**非常重要，用于防止内存泄漏和陈旧的引用**）：
            *   获取保存的回调函数引用。
            *   从 `this.editor.storage[YOUR_WELL_KNOWN_KEY]` 数组中通过比较引用来过滤掉（移除）该回调函数。
            *   清空保存的引用。
                *   **示例** (`AutoComplete.js`):
                    ```javascript
                    const predicateRef = this.storage.placeholderPredicateRef;
                    if (predicateRef && this.editor.storage[PLACEHOLDER_VISIBILITY_PREDICATES_KEY]) {
                      this.editor.storage[PLACEHOLDER_VISIBILITY_PREDICATES_KEY] =
                        this.editor.storage[PLACEHOLDER_VISIBILITY_PREDICATES_KEY].filter(
                          p => p !== predicateRef
                        );
                    }
                    this.storage.placeholderPredicateRef = null;
                    ```

**为什么这个模式“优秀”但感觉“复杂”？**

*   **优秀之处（长期收益）**：
    *   **解耦 (Decoupling)**：`PlaceholderPlugin` 不需要知道 `AutoComplete` 的存在，反之亦然（除了 `AutoComplete` 需要知道那个共享的 `KEY`）。它们通过一个中立的“注册表”间接交互。
    *   **可扩展性 (Scalability)**：如果未来有 `CommentBubblePlugin` 或 `ImageResizingHandlesPlugin` 也想隐藏占位符，它们只需按照相同模式注册自己的回调即可，`PlaceholderPlugin` 无需任何改动。
    *   **可维护性 (Maintainability)**：每个插件的逻辑都保持在自己的模块内部。如果 `AutoComplete` 判断自己是否激活的逻辑变了，只需要修改它自己的回调函数，不会影响 `PlaceholderPlugin`。
    *   **单一职责 (Single Responsibility)**：`PlaceholderPlugin` 只负责显示占位符和提供一个“被影响”的机制。`AutoComplete` 只负责自动补全和声明“我激活时会影响占位符”。

*   **初感觉“复杂”之处（理解成本）**：
    *   **间接性 (Indirection)**：不像直接调用函数或访问属性那么直观，它引入了一个“注册表”作为中间层。你需要理解数据是如何流动的：一个插件注册信息，另一个插件读取并使用这些信息。
    *   **生命周期管理 (Lifecycle Management)**：需要在正确的生命周期钩子（`onCreate`, `onDestroy`）中进行注册和注销，以避免内存泄漏或错误的行为。这是许多插件化或事件驱动系统中常见的关注点。
    *   **回调函数 (Callbacks)**：你需要传递函数作为参数，并在另一个地方执行它们。习惯了命令式编程直接调用的话，回调有时会增加一层心智负担。
    *   **`editor.storage` 作为共享媒介**：需要理解 Tiptap 的 `editor.storage` 是一个可以在不同扩展和插件间共享数据的对象，但这本身不是一个结构化的、类型安全的状态管理器（像 Pinia 或 Redux），所以需要小心使用，并通过明确的“键”和“协定”来规范。

**类比解释：**

想象一个公告板 (`editor.storage[KEY]`)：

1.  `PlaceholderPlugin` (公告板管理员) 说：“任何想在我显示内容（占位符）时让我暂停一下的部门，请在公告板上贴一张便条（注册回调），告诉我你需要暂停。”
2.  `AutoComplete` 部门贴了一张便条：“如果我的自动提示正在显示，请暂停显示占位符。”
3.  `CommentBubble` 部门也贴了一张便条：“如果我的评论气泡正在显示，请暂停显示占位符。”
4.  当 `PlaceholderPlugin` 准备显示内容时，它会去看公告板上的所有便条。只要有一张便条说“暂停”，它就不显示。它不需要知道是谁贴的便条，也不需要知道那个部门内部是怎么决定要贴便条的。

**何时使用此模式？**

*   当一个 `shared` 层插件需要被一个或多个 `features` 层插件影响其行为或查询其状态时。
*   当不同 `features` 层插件之间需要松散耦合的交互时（例如，一个特性发出一个通用事件，另一个特性响应该事件）。
*   当你希望避免在通用组件中硬编码对特定特性组件的引用时。

**替代方案及其权衡（简述，供参考）：**

*   **事件总线 (Event Bus)**：
    *   类似于注册表，但关注的是“事件通知”而非“状态查询”或“行为修改请求”。
    *   `features` 插件发出事件 (`editor.emit('autocomplete:active')`)，`shared` 插件监听事件 (`editor.on('autocomplete:active', ...)`)。
    *   优点：对于一次性通知或状态变化不频繁的场景很有效。
    *   缺点：如果 `shared` 插件需要在每次渲染（如 `decorations`）时都知道状态，事件模式可能需要 `shared` 插件自己维护一个内部状态来响事件，增加了复杂性。
*   **依赖注入 (Dependency Injection) / 配置选项**：
    *   `shared` 插件通过 `configure` 选项接收一个函数，这个函数由 `app` 层在组装编辑器时提供，该函数知道如何从 `features` 插件获取状态。
    *   优点：控制反转，`shared` 层非常干净。
    *   缺点：配置逻辑集中在 `app` 层，对于许多插件间的交互，可能会使 `app` 层变得复杂。

**结论：**

“基于 `editor.storage` 的注册表/回调模式”是一个在解耦、扩展性和实现复杂度之间取得了良好平衡的方案。虽然初学时可能感觉步骤稍多，但它为构建一个健robust、可维护的插件化系统奠定了坚实的基础。

---
