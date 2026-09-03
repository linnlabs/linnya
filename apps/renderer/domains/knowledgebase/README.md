apps/renderer/domains/knowledgebase/
├── constants/
│   └── index.js
├── index.js
├── stores/
│   ├── knowledgeBase.js          # 重导出 useKnowledgeBaseStore（拆分后的入口）
│   ├── knowledgeGraphProgressStore.js
│   └── knowledgeBase/
│       ├── index.js              # Pinia Store 定义入口
│       ├── computed.js           # 计算属性相关逻辑
│       ├── utils.js              # Store 内部工具函数
│       └── actions/
│           ├── fetchers.js       # 知识库数据获取 actions
│           ├── ipcBridge.js      # IPC 桥接与监听管理
│           ├── statusSync.js     # 状态同步
│           ├── uploadQueue.js    # 上传队列
│           └── polling.js        # 轮询
├── services/
│   ├── knowledgeBaseService.js   # 与后端 / 主进程交互的业务封装
│   └── progressAnimator.js       # 进度动画相关逻辑
└── ui/
    ├── AddToKnowledgeBaseModal.vue
    ├── GlobalUploadModal.vue
    ├── KnowledgeGraphProgressBar.vue
    ├── FileManageTab.vue
    ├── FileUploadTab.vue                 # 上传区与任务列表；强制 OCR 时提示模型页数上限
    ├── ParsingSettingsTab.vue
    ├── KnowledgeBaseSettingsTab.vue   # 知识库设置页（主要负责 UI 拼装）
    ├── useKnowledgeBaseSettings.ts    # 知识库设置页组合函数：基础信息 / 项目关联 / 删除逻辑等
    ├── KnowledgeBaseModal.vue
    ├── CreateKnowledgeBaseModal.vue
    └── page/
        ├── KnowledgeBaseList.vue
        ├── KnowledgeBaseDetail.vue
        └── KnowledgeBaseView.vue

---

## 通信边界说明（IPC vs HTTP）

### Electron 环境（推荐）

**原则：知识库“管理类/元数据类”走 IPC，重数据/长链路走 HTTP。**

- **走 IPC（主进程 + workspace.sqlite）**：
  - 知识库列表（getAll）
  - 创建 / 删除知识库
  - 获取知识库文档列表
  - 更新知识库设置（名称/描述/模型/标签）
  - 项目 ↔ 知识库关联（`project-kb-links:*`）

- **保留 HTTP（TS 后端 API）**：
  - 文档上传（multipart/form-data / busboy）
  - 任务状态查询 / 轮询 / 取消任务
  - 搜索（可能涉及向量检索/重排/大 payload）

### Web / DevServer 环境

由于无 `window.electronAPI`，只能使用 HTTP（`/api/v1/knowledge-base`）。

### 落点（代码定位）

- 渲染进程统一入口：`services/knowledgeBaseService.js`
  - Electron 下会自动优先调用 preload 暴露的 IPC 方法（若存在）
  - Web 下回退到 axios HTTP

---

## PDF 部分成功与继续解析

- 文件管理页会读取文档的 `parseDiagnostics`：
  - 无 partial 诊断：显示“已完成”。
  - `isPartial=true`：显示“部分成功 x/y”。
- partial PDF 行会显示“继续解析”操作，触发 `continueFailedPdfPages(kbId, docId)`。
- Store action 负责调用后端并刷新当前知识库文档列表；组件只负责展示和发起用户动作。
- “继续解析”只对失败页生效，成功页已经入库的内容不应被前端重置或重新上传。

维护约束：

- 文件管理列表必须按当前 `selectedKbId` 过滤，不能依赖 store “当前只装当前 KB 文档”的隐式假设。
- 不为该按钮写 UI snapshot；测试应优先覆盖后端增量提交、回滚，以及前端 action 调用后刷新文档列表的关键交互。
