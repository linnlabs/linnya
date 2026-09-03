# 后端业务模块：`src/features/`（宏观导航）

> 本目录是后端“业务 Feature”的主要承载层：对话、知识库、workspace、转录、agent 注册等都在这里演进。
>
> 目标：让每个 Feature 尽量自洽（service/repo/schema/router/infrastructure），避免业务逻辑散落到 `electron-main/`。

---

## 1) `features/` 的定位（和 `core/` / `tools/` / `electron-main/` 的边界）

- **`features/*`**：业务模块（领域规则 + 业务编排）
- **`core/*`**：与业务无关的可复用基础设施（execution/event-store/graph-engine/llm 等）
- **`tools/*`**：Agent 可调用的工具（协议与返回结构强约束）
- **`electron-main/*`**：Electron 环境适配与装配（进程生命周期/IPC/preload/路由挂载/DB连接等）

后端总览入口见：`src/README.md`

---

## 2) 重点模块索引（按“你大概率要改的地方”排序）

### 2.1 对话（Conversation）

- **对话流程编排（统一端点）**：`features/conversation/flow/`
  - 文档：`features/conversation/flow/README.md`
  - 端点：`POST /api/v1/conversation/next`（由 `electron-main/routes/index.ts` 挂载）
- **对话历史（事件库读写/回放）**：`features/conversation/history/`
  - 文档：`features/conversation/history/README.md`
- **会话附件（存储、回放、Agent 读取与回收）**：`features/conversation/attachments/`
  - 总领文档：`features/conversation/attachments/README.md`

### 2.2 AgentRegistry（promptKey / agent / chat 的注册式内聚）

- 入口文档：`features/agent-registry/README.md`
- 关键约束：PromptKeys SSOT 在 `@app/schemas`（`packages/schemas/src/agent-config/index.ts`）

### 2.3 Context Manager（上下文构建/压缩/工作记忆等）

- 总入口：`agent/product-extensions/linnya/context-manager/README.md`
- 兼容桥接：`features/context-manager/agent/README.md`
- 兼容桥接：`features/context-manager/chat/README.md`

### 2.4 Knowledge Base（知识库）

- 总览：`features/knowledge-base/README.md`

### 2.5 Transcription（转录）

- 总览：`features/transcription/README.md`

### 2.6 Parsers（解析）

- PDF：`features/parsers/pdfParser/README.md`

### 2.7 Text Measurement（平台文本测量）

- 总览：`features/text-measurement/README.md`
- 边界：通用测量原语、单位换算、Pretext/Heuristic adapter 与默认测量 service；依赖 Slides `DeckSpec` / `RenderModel` 的输入收集逻辑不放这里。

---

## 3) 新增一个 Feature 的建议结构

最小骨架（示意）：

```text
src/features/<feature>/
├─ README.md
├─ <feature>.service.ts
├─ <feature>.repository.ts
├─ <feature>.router.ts        # 可选：若该 Feature 直接提供 HTTP 路由
└─ infrastructure/            # 可选：sqlite/qdrant/worker 等
```

如果涉及落库、IPC、preload 等“Electron 环境装配”，请优先遵循 `src/docs/README.md` 的约束（SchemaProvider/白名单/聚合入口），避免把业务规则写回 `electron-main/`。
