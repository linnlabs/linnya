# Slides Backend Coordinator

`backend/coordinator` 是 Slides 后端用例编排层，负责把 engine、persistence、workspace、template、codegen 和图片来源解析器装配成 `PptCoordinator`，并向 tools、IPC、document hook 提供稳定业务入口。正式文稿只允许 source-first 创建和编辑。

coordinator 负责流程顺序、外部 port 协作和持久化时机，不负责具体 PPTX 编译、OOXML 解析、layout solver、lint 规则或 renderer 映射。

## 文档树

```text
coordinator/
├── README.md                         # 本说明
├── index.ts                          # backend-coordinator 对外导出入口
├── PptCoordinator.ts                 # 用例门面：codegen、query、restore、screenshot、export 等
├── createPptCoordinator.ts           # 生产装配工厂：engine、repo、workspace、template、image resolver
├── types.ts                          # coordinator port 与用例结果类型
├── sharedPptCoordinator.ts           # 插件 runtime effect 管理的共享 coordinator
├── presentationCodegenRuntime.ts     # deck.js source 构建、读写和生成协作
├── presentationQueryRuntime.ts       # inspect、export、preview、render-model、source slices
└── ../features/presentationImageOwnership/ # 源图片身份 -> presentation-owned asset
```

## 架构与数据流

生产装配：

```text
createPptCoordinator(db)
  -> repositories
  -> workspace port
  -> image source resolver
  -> feature-owned presentation build execution port
  -> engine compiler / reader / template / patch compiler
  -> PptCoordinator
```

创建与编辑：

```text
write_file / edit_file
  -> PresentationCodegenRuntime
  -> build Worker typecheck + Profiled Code Sandbox deck.js execution + build
  -> current document + source revision 原子提交
  -> workspace projection
```

查询：

```text
PptCoordinator.inspect / export / getPreview / getRenderModel
  -> presentationQueryRuntime
  -> repository / draft repository
  -> engine parser / query service
```

结构检查与诊断：

```text
PptCoordinator.inspectPresentation
  -> presentationQueryRuntime.getRenderModelSnapshot
  -> features/presentationInspection
  -> 既有 quality / geometry feedback
```

截图：

```text
PptCoordinator.renderScreenshots
  -> presentationQueryRuntime.getRenderModelSnapshot
  -> features/presentationScreenshot
  -> hidden worker + staged PNG/JPEG batch output
```

产品导出：

```text
PptCoordinator.exportPresentation
  -> features/presentationExport
  -> native PPTX / verified page PNG / transparent chart PNG
  -> Host PDF runtime 或 ZIP/PPTX 封装
  -> Host 一次性 target 原子发布
```

revision 恢复：

```text
PptCoordinator.history.restore（versionId + expectedCurrentVersionId）
  -> presentationSourceHistory（版本主题、只读资产与并发校验）
  -> 历史源码重建与 hash 校验
  -> codegen 重新编译
  -> 以 origin=restore 提交新 revision
```

## 边界与依赖

- coordinator 可以依赖 backend engine core、persistence repository、workspace port、template manager、codegen service 和工具 feedback builder。
- production shared coordinator 必须注入共享 `presentationBuildExecution`；直接测试和 standalone CLI 才可使用 in-process adapter。coordinator 不拥有 Worker 队列或协议。
- coordinator 不直接 import renderer，也不暴露 renderer-only 类型。
- screenshot 只能消费 query runtime 返回的同一 current revision snapshot，不能分两次查询 render model 和 revision 元数据。
- inspection 的 artifact version ID 同样只能来自该 snapshot，不能用数字 revision 代替；工具和 CLI 共用这一编排。
- coordinator 不写具体 layout、OOXML、lint、source parser 规则；这些规则归 engine、codegen、tools 对应模块。
- repository 和 workspace 操作必须通过 `types.ts` 中的 port 或生产工厂注入，不在 runtime 内直接创建 host service。
- 图片物化由 `presentationImageOwnership` 通过 Host document-image-asset facade 完成。coordinator 不读 asset ledger，也不把原始路径当成 live link。
- 公开工具面只使用 source-based `read_file / edit_file / write_file`。禁止恢复绕过 deck.js 的 patch、relayout 或 repair 持久化入口。

## 开发规范

- 新用例先判断属于 query、codegen 或 source revision history；不要继续堆到 `PptCoordinator.ts` 主类里。
- 新外部依赖先抽 port 放 `types.ts`，由 `createPptCoordinator.ts` 注入。
- 新持久化行为必须说明 current revision 提交、draft 处理和 workspace projection，避免三者状态不同步。
- 新 inspect feedback 数据先由 engine/query runtime 提供事实，再让 tools/inspectFeedback 渲染。
- 直接 PPTX 文档导入当前没有 IPC 入口；接入时应在 coordinator 边界明确如何生成可编辑源码、如何提交 revision，以及 render-model 与 Konva 保真验收。不得重新引入文稿级双 PPTX 来源。

## 测试入口

- coordinator 集成：`packages/plugins/slides/src/backend/__tests__/ppt-coordinator.test.ts`
- 工厂：`packages/plugins/slides/src/backend/__tests__/create-ppt-coordinator.integration.test.ts`
- shared coordinator：`packages/plugins/slides/src/backend/coordinator/sharedPptCoordinator.test.ts`
- image ownership：`packages/plugins/slides/src/backend/features/presentationImageOwnership/**/*.test.ts`
- IPC 调用 coordinator：`packages/plugins/slides/src/backend/ipc/*.test.ts`
