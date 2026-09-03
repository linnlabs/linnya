# Slides Backend Sandbox

`backend/sandbox` 是 Slides deck.js 执行与类型检查的插件侧适配层，负责定义
`ppt_compose` sandbox profile、注入 deck.js DSL、做 source
span 插桩、提供 chart/layout primitive 源码，以及为 codegen
source 构建虚拟 TypeScript 编译环境。

本目录不执行具体 runner，也不持久化 presentation。通用 sandbox
runner 由 host 平台提供，Slides 只提供 profile、输入准备、结果收口和类型检查所需资源。

## 文档树

```text
sandbox/
├── README.md                         # 本说明
├── index.ts                          # backend-sandbox 对外导出入口
├── pptComposeProfile.ts              # ppt_compose profile、policy、prepare/finalize
├── pptComposeProfile.ambient.d.ts    # sandbox 中暴露给 deck.js 的 ambient 类型
├── layoutTrace/                      # source span 插桩与有界布局树追踪
├── layoutPrimitives.ts               # createSlide/createFrame/createText 等 DSL source
├── chartPresets.ts                   # sandbox 可用图表 preset
├── sandboxJson.ts                    # sandbox JSON 类型守卫与字节计量
└── codegenTypecheck/
    ├── index.ts                      # typecheck 能力导出入口
    ├── ambientLoader.ts              # ambient d.ts 与 lib.*.d.ts 加载
    ├── compilerHost.ts               # virtual TypeScript compiler host
    ├── diagnosticFormatter.ts        # TS diagnostic -> AI 可读错误
    ├── libFileCache.ts               # TypeScript lib 文件缓存
    └── typecheckCodegenSource.ts     # deck.js source 类型检查入口
```

## 架构与数据流

执行准备：

```text
CodegenDeckBuilder
  -> pptComposeProfile.buildPolicy()
  -> pptComposeProfile.prepareExecution()
  -> 注入 layout primitives、source span/layout trace helper、globals、capability bindings
  -> host sandbox runner
```

执行收口：

```text
runnerResult
  -> pptComposeProfile.finalizeExecution()
  -> compose() payload 与有界 layout trace 校验（trace 的 configured/content 字段始终为 boolean）
  -> PptComposeSandboxValue
  -> CodegenDeckBuilder 编译 DeckSpec
```

类型检查：

```text
deck.js source
  -> typecheckCodegenSource()
  -> capabilities/typescriptRuntime（首次调用才加载）
  -> ambientLoader + virtual compiler host
  -> artifact 内 lib.es2020.d.ts 精确传递闭包
  -> formatted diagnostics
```

## 边界与依赖

- sandbox 可以依赖 `@plugin/backend/sandboxRuntime` 的类型和执行协议。
- sandbox 可以依赖 shared compose DSL 类型，用于校验 `compose()` payload。
- sandbox 不访问 DB、workspace、repository、IPC 或 renderer。
- `pptComposeProfile` 只接受 `codegen-source` profile
  mode；deck 修改应通过 source-based write/edit 工作流完成。
- 资源限制集中在 `pptComposeProfile.ts`，不要在 codegen
  service 中重复写 sandbox 限制。
- TypeScript compiler 的定位与懒加载集中在
  `backend/capabilities/typescriptRuntime/`；lib/ambient 编译环境集中在
  `codegenTypecheck/`，不要让业务服务直接加载 compiler 或手写 compiler host。

## 开发规范

- 新 sandbox 全局 API：先扩 `pptComposeProfile.ambient.d.ts` 和
  `layoutPrimitives.ts`，再补 typecheck 与执行测试。
- 新 capability：先在 `ALLOWED_CAPABILITIES`、policy、prepare
  bindings 中声明，再由 finalize 明确读取结果。
- 新 source span 或写后结构诊断行为：集中修改
  `layoutTrace/`，并补插桩、trace 读取和误报边界测试。
- 新 TypeScript 诊断文案放
  `codegenTypecheck/diagnosticFormatter.ts`；布局结构诊断放 codegen 的
  `writeDiagnostics/`。
- 生产文件只能 `import type` TypeScript；需要 compiler API 时调用 backend
  capability。静态值导入会让 9 MiB 编译器重新进入
  `index.cjs`，构建依赖图门禁会直接失败。
- 不要为了让错误“看起来能跑”添加无意义 fallback；sandbox 失败应返回明确的 policy/runtime/typecheck 诊断。

## 测试入口

- profile：`packages/plugins/slides/src/backend/sandbox/pptComposeProfile.test.ts`
- typecheck：`packages/plugins/slides/src/backend/sandbox/codegenTypecheck/__tests__/*.test.ts`
- flex layout runtime
  loader：`packages/plugins/slides/src/backend/codegen/compose/flex-layout/__tests__/yogaRuntimeLoader*.test.ts`
- codegen
  service 集成：`packages/plugins/slides/src/backend/codegen/__tests__/CodegenPresentationService.test.ts`
