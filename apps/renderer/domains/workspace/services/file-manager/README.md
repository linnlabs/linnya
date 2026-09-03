# File Manager 模块

> 统一管理文档的生命周期、保存策略和自动保存的轻量级协调模块。

## 目标

- **统一入口**：集中管理 _当前活动文件_ 的打开、保存、自动保存、关闭前保存等生命周期逻辑
- **可扩展**：通过注册机制，让 Markdown / MindMap / 未来的白板、表格等类型可插拔接入
- **与 fileStore 解耦**：`fileStore` 专注状态（路径、dirty、loading…），具体操作交由 File Manager 调用对应的文档类型 handler 实现
- **可观测性**：便于记录「哪种类型文件在何时触发了保存」，方便排查自动保存问题
- **自动保存统筹**：统一管理自动保存定时器，避免在各视图/组件内重复监听

## 目录结构

```
apps/renderer/domains/workspace/services/file-manager/
├── handlers/
│   ├── markdown.ts
│   ├── mindmap.ts
│   └── sheet.ts
├── orchestrator.ts   # 串行编排器（避免竞态）
├── index.ts          # 模块实现（注册/激活/保存协调，统一走 orchestrator）
├── mindmapAdapterBridge.ts # MindMap 适配器桥接
├── README.md         # 本文档
└── setup.ts          # 模块初始化（注册所有 handlers）
```

## 核心概念

| 名称                    | 说明                                                                                             |
|-------------------------|--------------------------------------------------------------------------------------------------|
| FileSessionDescriptor   | 当前活动文件的描述，包括 `documentId` / `type` / `displayName` / payload（扩展字段）               |
| FileTypeLifecycleHandler| 各文档类型需实现的接口（`open` / `save` / `close`）                                               |
| SaveReason              | 保存触发原因（手动、自动、pre-save hook、视图切换、关闭前…）                                     |
| registerFileTypeHandler | 注册某种文件类型的处理器（markdown、mindmap 等）                                                 |
| activateFileSession     | 低层 runtime 激活入口，只允许 app-level navigation 编排在 DocumentSurface ready 后调用             |
| requestSave             | 对外暴露的保存触发函数，可用于切换视图、预关闭等场景                                             |
| saveDeactivateThen       | 编排 API：保存(view-switch) → 关闭会话 → 执行 action（用于离开文档 runtime，防止并发插队）        |
| markActiveFileDirty     | 统一设置 dirty 状态（比如 mindmap 视图在节点变动时调用）                                         |

## 竞态问题与编排策略（重要）

File Manager 需要同时面对多个“并发入口”：

- UI 打开文档：`activateFileSession(...)`
- 自动保存定时器：`requestSave('auto')`
- app-level navigation：离开 workspace、切到旁路场景、切换文档时触发保存/关闭
- 关闭窗口 / before-unload：显式请求保存

如果这些入口不做统一串行化，会出现典型竞态：

- open 尚未完成就触发 auto-save（保存落到错误 session 或出现 `NO_ENGINE`）
- 保存与 close 交错（close 先销毁引擎，save 再执行导致失败）
- 多次视图切换导致并发保存/关闭

因此模块内部引入了 `orchestrator.ts`，把所有会改变 `activeSession / filePath / 保存状态` 的操作统一收口到**单队列串行编排**。

## 生命周期

1. **注册阶段**  
   ```ts
   registerFileTypeHandler({
     type: 'markdown',
     async open(session) { ... },
     async save(ctx) { ... return true },
   });
   ```

2. **打开文件**  

   业务层和 UI 层不要直接调用 `activateFileSession`。打开文档必须先走
   `apps/renderer/shared/ports/workspaceNavigationPort.ts` 或
   `apps/renderer/app/layout/orchestration/workspaceNavigation.ts`，由 app/layout 负责：

   - 取消旧打开 intent；
   - 保存并 deactivate 旧 session；
   - 挂载对应 `DocumentSurface`；
   - 等待 `documentSurfaceRuntimePort` ready；
   - 最后调用 `activateFileSession`。

   `activateFileSession` 是 file-manager 的低层 runtime API，不是跨 domain 导航 API：

   ```ts
   await activateFileSession({
     type: 'mindmap',
     documentId: node.id,
     displayName: node.name,
     payload: { projectId },
   });
   // 内部会（串行执行）：
   // - 保存并关闭旧会话（如有）
   // - 设置 activeSession
   // - 调用 handler.open()
   // - 更新 fileStore.setFilePath（对 sheet 可能延迟到 open 后）
   ```

3. **保存/自动保存**  
   - Module 内部会调用 `fileStore.registerPreSaveHook`（只注册一次）
   - Hook 触发时，根据 `activeSession.type` 找到对应 handler 执行 `save()`
   - 视图切换 / before-unload 场景需要触发保存时，调用 `requestSave('view-switch' | 'before-unload')`
   - 自动保存由模块内部的统一定时器（基于 `fileStore.autoSaveInterval`）触发

4. **标记脏状态**  
   - 在文档类型内（如 MindMap Engine）发生用户修改时，调用 `markActiveFileDirty(true)`
   - 自动保存成功后，模块会统一 `markActiveFileDirty(false)`

5. **离开文档 runtime**

当你需要离开 workspace、进入知识库/项目设置、关闭文档或切换文档时，必须走 `workspaceNavigation`。它会在 DocumentSurface 仍然挂载时先执行保存和 deactivate，再切换 scene 或卸载文档 runtime：

```ts
import { getWorkspaceNavigationPort } from '@/shared/ports/workspaceNavigationPort';

await getWorkspaceNavigationPort().openKnowledgeBase();
```

## 自动保存策略

- File Manager 在初始化时会：
  - 读取 `fileStore.autoSaveInterval` 并启动唯一的自动保存定时器
  - 当有活动会话且文件 dirty 时，定时器调用 `requestSave('auto')`
  - 当用户修改 `autoSaveInterval` 时自动重启定时器
- 其他组件（AppLayout、EditorContext、Sidebar 等）只需在需要保存的场景调用 `requestSave(reason)`，不再手动序列化或直接访问 handler

## 多类型接入示例

```ts
// markdown handler
registerFileTypeHandler({
  type: 'markdown',
  async open({ documentId }) {
    const { data } = await workspaceGateway['read-document']({ documentId });
    loadDocumentIntoEditor(data.content);
  },
  async save() {
    const editor = getEditorInstance();
    const content = editor.getJSON();
    const serialized = serializeDocumentContent(content);
    await workspaceGateway['save-document']({ documentId: fileStore.currentFilePath!, content: serialized });
    return true;
  },
});

// mindmap handler（示意）
registerFileTypeHandler({
  type: 'mindmap',
  async open({ documentId }) {
    const { data } = await mindMapGateway['read']({ documentId });
    mountMindMapEngine(data.content, data.metadata);
  },
  async save({ reason }) {
    const payload = exportMindMapState();
    await mindMapGateway['update']({
      documentId: fileStore.currentFilePath!,
      content: payload.content,
      metadata: payload.metadata,
    });
    return true;
  },
});
```

通过该模块，任何新文档类型仅需：
1. 实现 `FileTypeLifecycleHandler`
2. 在初始化时注册 handler
3. 打开文件时调用 `activateFileSession`

即可自动获得统一的保存/自动保存/关闭前保存能力。

