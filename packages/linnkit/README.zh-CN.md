# linnkit

**linnkit 是一个可以方便地精细化管理上下文的 Agent 框架，追求控制发给LLM的每一个 token，同时保留清晰的运行生命周期、审计记录和测试边界。** 它提供了一种小巧、可审计的运行时环境，可对消息、工具结果、摘要及策略进行管控，而正是这些要素决定了每一次大语言模型调用的行为。

[English](./README.md) · [接入文档](./docs/integration/README.md) · [更新日志](./CHANGELOG.md)

---

## linnkit 是什么？

linnkit是一套 Agent 应用的底层骨架：

| 层 | 负责什么 |
|---|---|
| `runtime-kernel` | 跑 agent、跑工具、管理 run、记录事件、处理取消和 cost |
| `context-manager` | 构建发给模型的上下文，按预算裁剪，注入 host 上下文 |
| `ports` | 接入方需要实现的接口，例如 LLM、工具、存储、tokenizer |
| `testkit` | 用测试守住协议，不靠口头约定 |

linnkit 不内置 LLM provider，不绑定数据库，不提供 UI，也不替你做 RAG、记忆、权限、IM 接入这些产品层能力。

---

## 为什么选 linnkit？

**精细化上下文控制** — 用 `AgentSpec.contextPolicy` 声明 token 预算、工具历史保留、must-keep、system reminder、observation 治理与 tokenizer；canonical reasoning 按 Assistant 原始 part 顺序只回放一次，并一直保留到正式压缩。长单 turn 统一走默认开启的自动压缩：Context Manager 选择并校验可替换区段，Graph 使用当前 run 已锁定的模型重建上下文，并在主调用前提交唯一 durable `history_summary`。没有专用 Summary Agent、checkpoint 工具或按模型分叉的压缩算法。发给模型的上下文不是手拼的 `messages[]`，而是一套有规则、可观察的构建过程。

**ContextTrace 可观测性** — 每次上下文构建都会产出一份机器可读的 trace：哪些消息被保留、哪些被裁、为什么裁、每一步消耗多少 token、最终是否超过预算。模型答错时，不用猜"是不是上下文丢了"，直接看 trace。

**run 生命周期管理** — `RunSupervisor` 和 `RunHandle` 让每次 agent 调用变成一个有状态的 run：独立 `runId`、可取消、可观察事件流、可查询状态、可统计 cost、可跑同步子 run、可 spawn 后台 detached run。Agent 更接近真实服务，而不是临时函数调用。

**审计设计** — `AuditEnvelope` / `AuditPort` 把模型选择、工具拒绝、fallback、等待用户、sandbox 决策等重要行为纳入统一审计流。不是为了"看起来企业级"，而是为了在出问题时能回答：当时系统为什么这么做？

**干净的 host 边界** — linnkit 不知道你的业务里什么叫"文档片段""知识库""项目记忆"。host 用 fence 机制注册自己的上下文类型，linnkit 负责按规则保留、裁剪、观测——不硬编码任何业务词汇。

**协议不变量测试** — testkit 强制校验 26 条严格不变量：final tokens 不能超预算、tool call 与 tool output 不能拆散、must-keep 消息不能被裁、run 结束后不能停在 running、注入自定义 tokenizer 后预算决策必须真的使用它……Agent 系统越复杂，越需要这些不变量防止小改动悄悄弄坏协议。

---

## 它适合解决什么问题？

如果你已经做过 Agent 产品，通常会遇到这些问题：

- 上下文不好管理，难以观测每次发给LLM的全部上下文。
- 对话越长，模型到底看到了什么说不清。
- 工具调用一多，哪些结果该保留、哪些该压缩，只能靠经验调。
- 用户点取消后，run 状态、事件流、工具执行和前端展示容易不同步。
- 多个 agent 互相调用后，父子 run 的 cost、事件和错误不好追。
- 一个 bug 复现不了，因为当时上下文是怎么裁剪的没人记录。
- 测试只测"最后回答像不像"，但测不到协议是否坏了。

linnkit 的目标就是把这些事变成可配置、可观测、可测试的工程问题。

---

## linnkit 不做什么？

这些能力很重要，但不属于 linnkit 的核心职责：

- 不内置 OpenAI / Claude / Gemini provider。
- 不内置 RAG、向量库、知识库、记忆系统。
- 不内置业务工具，例如搜索、读文件、写文件、浏览器、IM。
- 不内置 UI、控制台、DevTools 平台。
- 不替 host 决定权限、安全策略、计费策略。

linnkit 会提供边界和协议，让这些能力更容易接入；但具体实现应该属于你的产品。

它让 linnkit 可以被不同 host 使用，而不是变成某一个产品的内部框架。

---

## 5 分钟快速试用

安装：

```bash
npm install @linnlabs/linnkit
```

创建 demo host：

```bash
npx linnkit init demo-agent
cd demo-agent
npm install
```

配置环境变量后检查：

```bash
npx linnkit doctor
```

运行 hello agent：

```bash
npx linnkit run hello --input "用一句话介绍 linnkit"
```

这个 quickstart 是为了让你快速跑起来，不代表生产接入方式。生产 host 应该按 [接入文档](./docs/integration/README.md) 装配自己的 LLM、工具、存储、审计和上下文策略。

### 一句话交给 Coding Agent 安装

如果你在用 Claude Code、Codex、Cursor、Windsurf 或其他 coding agent，可以直接把下面这句话发给它：

> 如果还没 clone linnkit，就先 clone https://github.com/linnlabs/linnkit；然后按 README 和 `docs/integration/02-quickstart.md` 初始化一个本地 demo host，优先使用 npm，运行 `linnkit doctor`，不要接入生产存储或真实业务工具，结束时告诉我下一条运行命令，以及还缺哪些 `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_MODEL` 配置需要补充。

---

## 最小代码示例

```ts
import { defineAgent, runAgent } from '@linnlabs/linnkit/quickstart';

const agent = defineAgent({
  id: 'hello',
  version: '0.1.0',
  role: '助手',
  systemPrompt: '你是一个简洁、可靠的助手。',
  modelId: 'gpt-4o-mini',
  capabilities: ['agent'],
  tools: [],
});

const result = await runAgent(agent, {
  input: 'linnkit 是什么？',
  llm,
});

console.log(result.finalAnswer);
```

---

## 公开入口

| 子入口 | 用途 |
|---|---|
| `@linnlabs/linnkit` | 根入口，导出主要 namespace |
| `@linnlabs/linnkit/ports` | host 需要实现的接口 |
| `@linnlabs/linnkit/contracts` | 稳定数据结构，例如 `AgentSpec`、`AiMessage`、`RuntimeEvent` |
| `@linnlabs/linnkit/runtime-kernel` | graph、tool runtime、run supervisor 等运行时能力 |
| `@linnlabs/linnkit/runtime-kernel/events` | 浏览器安全的事件治理函数 |
| `@linnlabs/linnkit/context-manager` | 上下文构建、fence、message formatter、context policy |
| `@linnlabs/linnkit/testkit` | 测试 harness 和协议不变量 |
| `@linnlabs/linnkit/quickstart` | demo / 试用辅助函数 |

注意：前端页面不要 import `@linnlabs/linnkit/runtime-kernel`，它包含 Node-only 子树。前端只需要事件展示规则时，用 `@linnlabs/linnkit/runtime-kernel/events`。

---

## 文档入口

| 文档 | 内容 |
|---|---|
| [docs/integration/README.md](./docs/integration/README.md) | 接入总入口 |
| [docs/integration/01-installation.md](./docs/integration/01-installation.md) | 安装和包源配置 |
| [docs/integration/02-quickstart.md](./docs/integration/02-quickstart.md) | quickstart demo |
| [docs/integration/agent-registration-guide.md](./docs/integration/agent-registration-guide.md) | agent 注册与 `AgentSpec` |
| [docs/integration/context-engineering.md](./docs/integration/context-engineering.md) | 上下文策略、trace、tokenizer |
| [docs/integration/context-fences.md](./docs/integration/context-fences.md) | host 上下文注入 |
| [docs/integration/tools.md](./docs/integration/tools.md) | 工具接入总览 |
| [docs/integration/tool-development-guide.md](./docs/integration/tool-development-guide.md) | 工具开发细节 |
| [docs/integration/run-supervisor.md](./docs/integration/run-supervisor.md) | run 生命周期管理 |
| [docs/integration/testing.md](./docs/integration/testing.md) | testkit 和不变量 |
| [CHANGELOG.md](./CHANGELOG.md) | 公开版本更新记录 |

---

## 当前状态

- 当前版本：以 [package.json](./package.json) 为准。
- 当前发布：npmjs.com 公开发布。
- 稳定性：仍是 `0.x`，公开子入口已经锁定；minor 版本仍可能包含更新日志明确记录的协议级 breaking change。
- 开源状态：已按 MIT 协议开源，源码仓为 <https://github.com/linnlabs/linnkit>。

## License

MIT — 见 [LICENSE](./LICENSE)。
