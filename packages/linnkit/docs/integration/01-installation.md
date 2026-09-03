# Installation · 装包

> **What** · 把 `@linnlabs/linnkit` 装到自己仓库 + 跑通装包 smoke。
> **When to read** · 第一次接入 linnkit；新加 CI 环境；遇到 `Missing tiktoken_bg.wasm` 类装包错误想排查。
> **Prerequisites** · 无（这是接入第 1 篇）。
> **Key exports** · 无（本文不涉及 import）。
> **Related** · [`02-quickstart.md`](./02-quickstart.md) · [`constraints-and-pitfalls.md`](./constraints-and-pitfalls.md)

## 1. 这个包发布在哪

`@linnlabs/linnkit` 发布到 **npmjs.com 公开 registry**（`https://registry.npmjs.org/`），scope 是 `@linnlabs`。正常 npm 项目不需要额外 `.npmrc`。

如果你以前接过 GitHub Packages 私有版本，请删除项目 `.npmrc` 里的旧配置：

```ini
@linnlabs:registry=https://npm.pkg.github.com/
```

这条旧 registry override 会让 npm 继续去 GitHub Packages 找包，公开版本反而装不到。

## 2. 安装

```bash
npm install @linnlabs/linnkit
```

如果你只想先跑 quickstart，也可以全局安装 CLI：

```bash
npm install -g @linnlabs/linnkit
linnkit init hello-linnkit
```

CLI v0 只包含三个命令：

| 命令 | 用途 |
|---|---|
| `linnkit init <name>` | 生成一个自包含 demo host（JS ESM + OpenAI-compatible fetch adapter + memory runtime） |
| `linnkit doctor [--config linnkit.config.mjs]` | 检查 Node / npm registry 配置 / env / config / LLM adapter 形状 |
| `linnkit run <agent-id> --input "..." [--model "..."]` | 运行 quickstart config 里的 agent，打印 final answer 和 cost 摘要 |

`replay` / `inspect` 不在 CLI v0 范围内。真要做生产级 replay / inspect，请接入自己的 EventStore / RunSupervisor，并按 [testing.md](./testing.md) 与 [run-supervisor.md](./run-supervisor.md) 做 host 侧工具。

`peerDependencies`：

| peer | 说明 |
|---|---|
| `zod` (`^3.22.0`) | 必需。`@linnlabs/linnkit/contracts` 用 zod 定义所有消息/事件 schema，运行时也会校验 |
| `vitest` (`^2 \|\| ^3`) | 可选。**只有当你打算 import `@linnlabs/linnkit/testkit` 写测试时才需要装** |

`@linnlabs/linnkit/testkit` 在源码顶层 `import { vi, expect } from 'vitest'`，所以生产代码 **绝对不能** import 这个子入口（详见 [constraints-and-pitfalls.md](./constraints-and-pitfalls.md)）。

## 3. 验证装包成功

新建一个 `smoke.ts`：

```ts
import { runtimeKernel, generateMessageId } from '@linnlabs/linnkit';
import type { AgentInvocationRequest, CanonicalInferencePort } from '@linnlabs/linnkit/ports';
import type { AiMessage, RuntimeEvent } from '@linnlabs/linnkit/contracts';

console.log(generateMessageId());
console.log(typeof runtimeKernel.graph);
```

`tsc --noEmit` 通过 + 运行无报错 = 装包成功。如果你在前端项目里这么写会拖进 `node:async_hooks`，请先看 [README.md §5 浏览器规则](./README.md#5-浏览器使用规则硬约束)。

如果想验证 CLI：

```bash
npx linnkit --help
```

---

## 常见装包问题（FAQ）

**Q：我装的是 `@linnlabs/linnkit`，但 npm/yarn 报 401 / 404？**

优先检查项目或用户级 `.npmrc` 是否还把 `@linnlabs` 指到了旧的 GitHub Packages：

```bash
npm config get @linnlabs:registry
```

如果输出是 `https://npm.pkg.github.com/`，请删掉这条配置，让 npm 回到默认的 `https://registry.npmjs.org/`。

**Q：我能不能 fork linnkit、改它内部然后用我自己的 fork？**

技术上可以，但你要自己负担"和上游同步 + boundary guard 自维护"的成本。99% 你想做的事都能通过依赖注入在 host 层完成；如果你发现某个改动只能 fork 才能做，那大概率说明你应该来跟 linnkit 维护方提 issue / PR。

**Q：import `@linnlabs/linnkit/runtime-kernel` 报 "Missing tiktoken_bg.wasm"？**

确认你装的版本 ≥ `0.1.3`。0.1.0~0.1.2 三个版本里 tiktoken wasm 被错误 inline 进 dist，已在 0.1.3 修复（external + 在 `dependencies` 声明）。
