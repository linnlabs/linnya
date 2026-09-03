# 06 · 开发者体验路线图

> linnkit 当前 DX 评分 6.5——文档密度高、深度好，但缺"30 行跑起 hello-agent"的 5 分钟入门，缺 CLI、缺 DevTools、缺 fluent test DSL。
> 本文给出 5 个 DX 抓手 + 优先级。这些不是协议层（不属于 [`04`](./04-protocol-roadmap.md)），但 ROI 极高，**接入方第一周就会要**。

---

## 1. 5 个 DX 抓手

| 抓手 | 目标 | Phase | ROI |
|---|---|---|---|
| 5 分钟 quickstart | 30 行代码跑起一个 agent，不要求理解 GraphExecutor | F.1 | ⭐⭐⭐⭐⭐ |
| `linnkit-cli` | `init / run / replay / inspect / doctor` | F.1 → G.1 | ⭐⭐⭐⭐⭐ |
| Test DSL | `defineAgentTest()` 链式 API | G.1 | ⭐⭐⭐⭐ |
| DevTools Web | 事件流 + 上下文窗口 + prompt diff | G.1 → G.2 | ⭐⭐⭐⭐⭐ |
| Plugin 模板 | `create-linnkit-plugin` / `create-linnkit-tool` | G.2 | ⭐⭐⭐ |

---

## 2. 5 分钟 quickstart（Phase F.1）

### 2.1 当前痛点

`INTEGRATION_GUIDE` 5 个例子是好的，但每个都要求接入方先理解：

- `GraphExecutor`
- 依赖袋（dep bag）
- bridge / port 注入
- conversation-context registry

→ 没人在 5 分钟内能跑起来。

### 2.2 目标形态

> 2026-05-13 修订：1C v0 不再新增 `@linnlabs/llm-openai` / `@linnlabs/store-memory` starter 包。quickstart 是试用骨架，不是生产平台；provider/store 参考实现先内联在 `linnkit init` 模板里，避免扩大维护面。

```bash
npm install @linnlabs/linnkit
npx linnkit init hello-linnkit
cd hello-linnkit
npm install
```

```ts
// hello-agent.ts
import { runAgent, defineAgent } from '@linnlabs/linnkit';
import { createOpenAICompatibleProvider } from './adapters/openai-compatible.mjs';

const helloAgent = defineAgent({
  id: 'hello',
  description: 'A friendly hello-world agent',
  systemPrompt: 'You are a helpful assistant. Greet the user warmly.',
  tools: [],
});

const result = await runAgent(helloAgent, {
  input: 'Hi there!',
  llm: createOpenAICompatibleProvider(),
  modelId: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
});

console.log(result.finalAnswer);
```

跑：

```bash
npx linnkit run hello --input "Hi there!"
```

**关键约束**：

- 30 行以内（包括 imports）
- 不出现 `GraphExecutor` / `tickPipeline` / `dep bag` 等内部概念
- 默认值合理：context profile 用 `agent`，checkpoint / event store / run supervisor 用 quickstart memory runtime
- 失败信息友好：missing API key 直接说"please set OPENAI_API_KEY"

### 2.3 实施任务

1. 写 `defineAgent()` helper —— `AgentSpec` 的简化构造器（来自 N-1）
2. 写 `runAgent()` helper —— 自动装配 dep bag + GraphExecutor
3. 写 `linnkit init` 模板内联的 OpenAI-compatible fetch adapter（不进入 runtime）
4. 写 `docs/integration/02-quickstart.md` 的真实可跑流程

---

## 3. `linnkit-cli`（Phase F.1 → G.1）

### 3.1 命令清单

| 命令 | 用途 | Phase |
|---|---|---|
| `linnkit init` | 在当前目录起一个 hello-agent 项目（含 `linnkit.config.mjs`、demo adapter、示例 agent） | F.1 |
| `linnkit run <agent-id>` | 跑指定 agent；实时打印事件流 | F.1 |
| `linnkit doctor` | 检查环境（Node 版本 / API key / 必要依赖 / `linnkit.config.mjs` 合法性） | F.1 |
| `linnkit replay <run-id>` | 从 EventStore 回放一条 run，看每一步 | G.3 之后 |
| `linnkit inspect <run-id>` | 打印一条 run 的快照（context window / cost / events 摘要） | G.3 之后 |
| `linnkit dev` | 起一个本地 DevTools Web server，连到 in-memory EventStore | G.1 |
| `linnkit gen <kind>` | 脚手架：`linnkit gen agent foo` / `linnkit gen tool bar` / `linnkit gen plugin baz` | G.2 |

### 3.2 配置文件

`linnkit.config.mjs` 是 quickstart 级配置；生产 host 可以继续使用自己的配置系统：

```ts
import { defineConfig } from 'linnkit/cli';

export default defineConfig({
  agents: ['./agents/*.ts'],
  llm: 'openai',                                 // 或 ('anthropic' | function)
  store: 'memory',                               // 或 ('sqlite' | function)
  devtools: { port: 4242 },
  audit: { sink: 'console' },                    // 或 ('file' | 'otel')
});
```

### 3.3 实施依赖

- 依赖 N-1 AgentSpec 完成
- 依赖 G-1 AuditEnvelope（doctor / inspect 用）
- DevTools 部分依赖 G-3 Replay SDK + DevTools Web

---

## 4. Test DSL（Phase G.1）

### 4.1 当前

`scriptedAiEngineHarness` 是好的测试 primitive，但用起来还是"配 mock LLM → 跑 GraphExecutor → assert events"——**几十行配置代码**。

### 4.2 目标

```ts
import { defineAgentTest } from 'linnkit/testkit';

defineAgentTest('researcher')
  .given({
    history: [{ role: 'user', content: 'Find the best Rust async runtime' }],
  })
  .when({
    llmScript: [
      { thought: 'I should search for Rust async runtimes' },
      { tool: 'web_search', input: { q: 'rust async runtime comparison' } },
      // ...
    ],
  })
  .expect.toolCall('web_search').withInput({ q: /rust async/ })
  .expect.contextWindowToContain('async runtime')
  .expect.finalAnswer.toMatch(/tokio/i)
  .expect.cost.toBeLessThan({ tokens: 5000 })
  .run();
```

### 4.3 设计要点

- **fluent + chained**——不要又一套 expect 句法
- **基于 testkit/agent-harness**——不重写底层 mock 机制
- **支持 record / replay 模式**——`.recordAt('fixtures/researcher-1.json')` 一次跑出 fixture，下次自动 replay
- **vitest / jest 友好**——`run()` 内部跑断言，失败抛 `AssertionError`

### 4.4 实施依赖

- N-1 AgentSpec（test 引用 agent id）
- G-1 AuditEnvelope（cost / decision 断言用）

---

## 5. DevTools Web（Phase G.1 → G.2）

### 5.1 形态

独立 npm 包 `@linnkit/devtools`，启动一个 Web SPA + 本地 server：

```bash
npx linnkit dev
# → http://localhost:4242
```

### 5.2 4 个核心 view

| View | 内容 |
|---|---|
| **Event Timeline** | 实时事件流，按 run / agent / channel 过滤；点单条事件看 raw + governance + audit envelope |
| **Context Window** | 当前 run 在 LLM 调用时看到的实际 prompt；可切换历史轮次；显示 replacementSourceIds 的来源 |
| **Prompt Diff** | 两次相邻 LLM 调用之间的 prompt 增量（红绿 diff） |
| **Cost / Run Tree** | RunSupervisor 视图：所有 active runs + 树形 + cost 累计 + cancel 按钮 |

### 5.3 加分 view（Phase G.2）

| View | 内容 |
|---|---|
| **Tool Call Diff** | 工具调用前后 state 对比 |
| **Memory Browser** | MemoryPort 写入查询；可视化 citations 链 |
| **Audit Trail** | AuditEnvelope 时间线；按 actor / decision 过滤 |

### 5.4 实施依赖

- G-3 Replay SDK（事件回放底座）
- G-1 AuditEnvelope（Audit Trail view）
- N-3 RunSupervisor 本体（Run Tree view）
- N-4 MemoryPort（Memory Browser view，G.2）

### 5.5 集成方式

| 集成方式 | 描述 |
|---|---|
| **CLI standalone** | `linnkit dev` 起 server，连本地 EventStore |
| **桌面消费者内嵌** | 桌面 app 主窗口加一个 "Agent Inspector" panel，复用同一 SPA |
| **后台 daemon 暴露 web port** | 远程访问 daemon 的 EventStore |

---

## 6. Plugin 模板（Phase G.2）

### 6.1 形态

```bash
npm create linnkit-plugin@latest my-plugin
# 选项：
#   - kind: tool | port-adapter | memory-backend | llm-provider
#   - lang: typescript | javascript
#   - test: vitest | jest

npm create linnkit-tool@latest my-tool
# → 直接生成单个工具的 skeleton
```

### 6.2 模板内容

包含：

- `src/index.ts` —— 标准导出
- `__tests__/*.test.ts` —— 接 contract test
- `package.json` —— 标准 peer deps
- `README.md` —— 含使用示例
- AGENTS.md —— 给 AI agent 的开发约定

### 6.3 实施依赖

- N-1 AgentSpec.capabilities 协议（tool plugin 要声明 capabilities）
- 6.1 命令依赖 `linnkit gen` 命令族

---

## 7. 文档体系升级

DX 的最后一块是文档。当前文档密度高深度好，但**新接入方找不到入口**。

### 7.1 三层文档体系

| 层 | 内容 | 受众 |
|---|---|---|
| **Quickstart**（`docs/quickstart/`） | 5 分钟跑 hello-agent / 30 分钟接第一个工具 / 1 小时接 LLM provider | 第一次接触 |
| **Guides**（`docs/guides/`） | how-to：how to add a tool / how to do multi-agent / how to test / how to deploy | 第一周接入 |
| **Reference**（本目录 + 源码 README） | 协议层 / 架构 / 决策记录 | 长期维护 |

### 7.2 入口页（`packages/linnkit/README.md`）

新接入方读到的第一份文档要在 60 秒内告诉他：

1. linnkit 是什么 / 不是什么（一段）
2. 5 行代码跑起 hello-agent（一段）
3. 我什么时候不该用 linnkit（一段，反向定位 Vercel AI SDK / LangGraph）
4. 我下一步该读哪个文档（链接到 quickstart / framework/00 / framework/01）

---

## 8. ROI 总览

| 抓手 | 实施成本 | 影响范围 | ROI |
|---|---|---|---|
| 5 分钟 quickstart | 1 周 | 100% 接入方第 1 天 | ⭐⭐⭐⭐⭐ |
| linnkit-cli v0 (init/run/replay/doctor) | 2 周 | 80% 接入方第 1 周 | ⭐⭐⭐⭐⭐ |
| DevTools Web v0 (Event Timeline + Context Window) | 3 周 | 100% 接入方第 1 个月 | ⭐⭐⭐⭐⭐ |
| Test DSL | 1 周 | 长期维护方第 1 个月 | ⭐⭐⭐⭐ |
| Plugin 模板 | 1 周 | 第三方扩展生态启动期 | ⭐⭐⭐ |
| DevTools Web v1 (Cost / Memory / Audit) | 2 周 | 多租户 / 长 run 场景 | ⭐⭐⭐⭐ |

**总投入** ≈ 10 个工程周，分摊到 Phase F + G。

→ 详见 [`07 §3-§4 时间排期`](./07-roi-ranked-priorities.md)。
