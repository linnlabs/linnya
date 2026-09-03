# 后端基础能力层：`src/core/`

Layer: `residual shared backend utilities`

`src/core/` 已不再承载 Agent runtime 的主链实现、bridge 或近代码测试。

Agent 主链真实 owner 现在是：

- `src/agent/runtime-kernel/*`
- `src/agent/context-manager/*`
- `src/app-hosts/linnya/*`
- `src/agent/testkit/*`

## 当前保留内容

`src/core/` 现在只保留仍有真实 owner 语义、且尚未完成 domain-first 迁移的后端能力：

- `src/core/invoke-request.types.ts`
- `src/core/di/ServiceRegistry.ts`

宽 `AIEngine`、Provider stream 再解析的 `StreamProcessor` 和旧 chat 类型已删除。文本生成、Embedding、Reranking、OCR 与 ASR 分别通过自己的窄 port 进入 App Host capability，不允许在 `core/` 重建总引擎。

图片生成也已迁移到 `src/domains/image-generation` 的窄 port、Linnya Host AI SDK adapter 与 app-level publication workflow；旧全局引擎和 Provider 专用 adapter 已删除。

## 已完成收口

以下旧子树已完成迁移并删除旧目录源码/测试容器：

- `src/core/graph-engine/*`
- `src/core/execution/*`
- `src/core/events/*`
- `src/core/llm/*`

历史测试总结文档已归档到：

- `docs/archive/legacy-src-core/graph-engine/*`

## 现在该看哪里

如果你是来改 Agent 后端代码，直接看：

- `src/agent/README.md`
- `src/agent/runtime-kernel/README.md`
- `src/app-hosts/linnya/adapters/flow/README.md`
- `src/agent/context-manager/README.md`
- `src/app-hosts/linnya/agent-registry/README.md`

## 开发注意事项

1. 不要把新的 Agent 逻辑再放回 `src/core/*`。
2. 只有当能力确实不属于 Agent runtime / app-host / context-core 时，才应继续留在 `src/core/*`。
3. 若未来继续抽 shared layer，应从 `src/agent/context-manager/*` 与 `src/app-hosts/linnya/*` 的边界做提炼，而不是回退到旧 `core/*` 目录。
