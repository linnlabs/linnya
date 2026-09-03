# 文档加载服务 (Document Loader Service)

## 架构设计

文档加载服务采用**策略模式 + 工厂模式**，实现了灵活、可扩展的文档加载架构。

### 核心组件

```
DocumentLoaderService (主服务)
    └── DocumentLoaderFactory (工厂)
            ├── MarkdownDocumentLoader (Markdown 加载器)
            ├── CanvasDocumentLoader (画布加载器 - 未来)
            └── DatabaseDocumentLoader (数据库加载器 - 未来)
```

### 设计优势

1. **单一职责**: App.vue 只负责视图切换，文档加载逻辑集中管理
2. **开放封闭**: 添加新文档类型无需修改现有代码
3. **易于测试**: 每个加载器可独立测试
4. **类型安全**: 清晰的接口定义

## 使用方式

### 基础使用

```javascript
import { documentLoaderService } from '@app/services/documentLoaderService';

// Markdown handler 在 document surface ready 之后调用。
await documentLoaderService.loadDocument({
  documentId: '123-456-789',
  editor: editorInstance,
  stores: { fileStore, notificationStore },
  documentType: 'markdown',
  throwIfCancelled: () => {
    // file-manager 会把当前打开动作的取消信号传进来。
  }
});
```

### 当前打开链路

文档加载不再由 `App.vue` watch UI 状态触发。最终链路是：

1. UI 或 domain 通过 `workspaceNavigationPort` 发起打开文档意图。
2. `workspaceNavigation.openDocument` 写入布局状态并等待 `DocumentSurface` ready。
3. ready 后调用 `file-manager.activateFileSession`。
4. markdown handler 通过 `markdownDocumentEditorRuntimePort` 等待平台 Tiptap 实例，再调用 `documentLoaderService.loadDocument`。

这个顺序保证通用 Document Surface 只负责挂载 ready，Markdown runtime 只负责具体富文本实例，document loader 只处理“把数据加载进已存在的 editor 实例”，不感知布局、导航和 Vue 挂载时序。

## 扩展新文档类型

### 步骤 1: 创建加载器类

```javascript
// apps/renderer/app/services/loaders/CanvasDocumentLoader.js

export class CanvasDocumentLoader {
  constructor() {
    this.type = 'canvas';
  }

  /**
   * 加载画布文档
   * @param {Object} params
   * @param {string} params.documentId
   * @param {Object} params.editor - 可能是不同类型的编辑器实例
   * @param {Object} params.stores
   */
  async load({ documentId, editor, stores }) {
    console.log(`[CanvasDocumentLoader] Loading canvas ${documentId}`);
    
    try {
      // 1. 从数据库获取画布数据
      const result = await workspaceGateway['read-canvas']({ documentId });
      if (!result.success) {
        throw new Error(result.error);
      }

      // 2. 初始化画布编辑器
      const canvasData = result.data;
      editor.loadCanvas(canvasData);

      // 3. 更新状态
      stores.fileStore.setFilePath(documentId);
      stores.fileStore.setDirty(false);

      console.log(`[CanvasDocumentLoader] Canvas ${documentId} loaded`);
    } catch (error) {
      console.error(`[CanvasDocumentLoader] Failed:`, error);
      throw error;
    }
  }
}
```

### 步骤 2: 注册加载器

```javascript
// 在应用初始化时（如 main.js 或 App.vue 的 onMounted）
import { documentLoaderService } from '@app/services/documentLoaderService';
import { CanvasDocumentLoader } from '@app/services/loaders/CanvasDocumentLoader';

documentLoaderService.registerLoader('canvas', new CanvasDocumentLoader());
```

### 步骤 3: 使用新加载器

```javascript
// 根据文档元数据动态选择类型
const documentMeta = await getDocumentMetadata(documentId);

await documentLoaderService.loadDocument({
  documentId,
  editor,
  stores: { fileStore, uiStore, notificationStore },
  documentType: documentMeta.type // 'markdown' | 'canvas' | 'database' | ...
});
```

## 加载器接口规范

每个加载器类必须实现以下接口：

```typescript
interface DocumentLoader {
  type: string; // 文档类型标识

  /**
   * 加载文档
   * @param params 加载参数
   * @returns Promise<void>
   * @throws Error 加载失败时抛出错误
   */
  load(params: {
    documentId: string;
    editor: any; // 编辑器实例，类型取决于文档类型
    stores: {
      fileStore: FileStore;
      uiStore: UIStore;
      notificationStore: NotificationStore;
    };
  }): Promise<void>;
}
```

## 🎯 实际应用场景

### 场景 1: Notion 风格的多类型页面

```javascript
// 根据页面类型加载不同编辑器
const pageTypes = {
  'markdown': 'markdown',     // 富文本编辑器
  'canvas': 'canvas',         // 白板编辑器
  'database': 'database',     // 数据库视图
  'gallery': 'gallery',       // 画廊视图
  'timeline': 'timeline'      // 时间线视图
};

// 在数据库中存储文档类型
const doc = await db.documents.findById(documentId);
await documentLoaderService.loadDocument({
  documentId,
  editor: getEditorInstance(doc.type),
  stores,
  documentType: pageTypes[doc.type] || 'markdown'
});
```

### 场景 2: 协同编辑不同格式

```javascript
// 每种格式有自己的加载和同步逻辑
class CollaborativeMarkdownLoader extends MarkdownDocumentLoader {
  async load(params) {
    await super.load(params);
    // 额外的协同编辑初始化
    await this.setupCollaboration(params.documentId, params.editor);
  }

  async setupCollaboration(documentId, editor) {
    // WebSocket 连接、Y.js 初始化等
  }
}
```

## 🔄 未来扩展方向

1. **支持插件系统**: 允许第三方插件注册自定义加载器
2. **加载器中间件**: 在加载前/后执行通用逻辑（如权限检查、日志记录）
3. **懒加载策略**: 根据文档大小选择不同的加载策略
4. **缓存机制**: 避免重复加载相同文档
5. **加载进度追踪**: 大文档加载时显示进度条

## 📂 文件结构建议

```
apps/renderer/app/services/
├── documentLoaderService.js         # 主服务 + 工厂 + Markdown 加载器
├── loaders/                         # 其他加载器目录
│   ├── CanvasDocumentLoader.js
│   ├── DatabaseDocumentLoader.js
│   └── GalleryDocumentLoader.js
└── README_DocumentLoader.md         # 本文档
```

## 💡 最佳实践

1. **错误处理**: 每个加载器应捕获并转换错误为用户友好的消息
2. **日志记录**: 使用统一的日志前缀便于调试
3. **状态管理**: 加载前检查状态，避免重复加载
4. **清理资源**: 在加载新文档前清理旧文档的资源
5. **类型检查**: 使用 JSDoc 或 TypeScript 确保类型安全

## 🐛 调试技巧

```javascript
// 查看已注册的加载器
console.log(documentLoaderService.factory.loaders);

// 测试特定加载器
const loader = documentLoaderService.factory.getLoader('canvas');
console.log(loader.type); // 'canvas'

// 模拟加载
await loader.load({
  documentId: 'test-123',
  editor: mockEditor,
  stores: mockStores
});
```

---

**更新日期**: 2025-11-09  
**维护者**: TingTalk Team
