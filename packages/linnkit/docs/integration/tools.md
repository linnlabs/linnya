# Tools · 注册工具集

> **What** · 把工具注册进 linnkit —— `ToolRuntimePort` 接入面 + `ObservationPreviewPort` 治理超长 observation。
> **When to read** · 要给 agent 加工具；要治理超长 observation；接 MCP / 远程工具；review 既有工具实现。
> **Prerequisites** · [`02-quickstart.md`](./02-quickstart.md)；写自定义工具前推荐先读 [`tool-development-guide.md`](./tool-development-guide.md) ⭐。
> **Key exports** · `BaseTool` / `ToolRuntimePort` / `ObservationPreviewPort` / `ToolExecutionContext` / `ToolCallStreamingPolicy` / `computeToolIdempotencyKey` from `@linnlabs/linnkit/runtime-kernel`。
> **Related** · [`tool-development-guide.md`](./tool-development-guide.md) ⭐ · [`tool-history.md`](./tool-history.md) · [`context-engineering.md` §6](./context-engineering.md)

## 1. linnkit 给你的合同

- `BaseTool` + `CommonParameterTypes`（来自 `@linnlabs/linnkit/runtime-kernel`）：抽象类，要求实现 `name` / `description` / `parameters` / `run(args, context)`。`run` 必须返回 `Promise<string>`，且成功结果必须是 `JSON.stringify({ data, observation })` 格式。
- `ToolExecutionContext`（同上）：工具执行时收到的 runtime 最小上下文。
- `ToolSchemaBuildRequest` / `ToolRuntimePort` / `ToolCatalogPort` / `ToolExecutionPort`（同上）：把工具集合装成“runtime 可调用”的合同。Linnkit 在每次调用前把通用 `AgentInvocationRequest` 原样交给 Host 构建 Schema，但不解释 Host 的扩展字段。Linnkit 不接收前端展示配置；组件、标题、图标和布局属于具体产品的 Renderer registry。
- `ObservationPreviewPort`（同上）：工具产出 observation 在 UI 展示前的预览决策点。
- `TokenizerPort`（来自 `@linnlabs/linnkit/ports`，0.8.0+）：host 可选注入的上下文预算 token 估算合同；它不属于工具执行，但会影响工具 observation / tool_calls 在上下文窗口里能保留多少。
- `ensureToolContextRuntimeCapability`（同上）：把 runtime 必需的保留字段补进 host 的 patch，避免手抖漏字段。
- `ToolIdempotencyPolicy` / `computeToolIdempotencyKey`（同上）：声明 `conversation | turn` scope，并按正式 32-hex 合同生成稳定 key。详细语义见 [`tool-development-guide.md §3.2`](./tool-development-guide.md#32-幂等执行合同)。
- `ToolCallStreamingPolicy`（同上）：工具按需声明早期占位或参数快照；未声明时不发布未接纳的流式生命周期事件。该 policy 只进入 Linnkit invocation context，不进入 provider options。

## 2. linnkit 自带的 mock primitive

- `createToolContextFixture`（来自 `@linnlabs/linnkit/testkit`）：最小 `ToolExecutionContext`，已自动通过 `ensureToolContextRuntimeCapability` 补全 runtime 字段。

## 3. 你必须做的

1. 把每个工具定义为 `BaseTool` 的子类（或满足 `AgentTool` 接口的对象）；详细规范见 [`tool-development-guide.md`](./tool-development-guide.md)。
2. 决定哪些字段走通用 `ToolExecutionContext`，哪些走 host patch；patch 必须经 `ensureToolContextRuntimeCapability` 补齐保留字段。
3. 把工具集合装进 host 的 `ToolManager` / `ToolRuntimePort` 实现，让 runtime 在 LLM 决策返回 tool calls 时能 dispatch。
4. 实现 `ObservationPreviewPort`，决定超长 observation 的完整副本写到哪里；再在 runtime assembly 里传给 `createDefaultGraphExecutor({ observationPreview })` 或你的自定义 `ToolNode` 装配。
5. 把 AgentSpec 与工具集合装配在一起；详细规范见 [`agent-registration-guide.md`](./agent-registration-guide.md)。
6. 只有真正有副作用且同参重试必须复用成功结果的工具才声明 `idempotency`；确认 scope 身份注入、成功缓存复用和跨进程边界，见 [`tool-development-guide.md §3.2`](./tool-development-guide.md#32-幂等执行合同)。

如果工具 Schema 依赖本次产品配置，Host 应在 `getToolSchemas(ToolSchemaBuildRequest)` 边界校验自己的扩展请求字段，再派生窄小的 Host 上下文交给具体工具。完整 query/history 不应暴露给所有 concrete/plugin tools。不要把用途模型 ID、产品模式或开放 metadata Map 加回 Linnkit；框架只拥有调用时机和通用 invocation。

工具需要把图片交给下一轮模型时，工具只返回 `StructuredToolResult.modelInput.attachments` selection；host 实现并注入 `ToolModelInputResolverPort` 与 `ToolModelInputCapabilityValidatorPort`，负责 scope、完整性和真实 active model 校验。linnkit 只拥有 selection 解析时机、工具配对和失败生命周期，不认识 asset 表、文件路径、具体 provider 或产品工具名。完整规则见 [`tool-development-guide.md §7.4`](./tool-development-guide.md)。

默认 delivery 是 `required`。如果图片只是主操作成功后的增强反馈，工具 definition 可以显式声明
`modelInputDelivery='when_supported'`：ToolNode 不会因当前模型缺少图片输入能力而隐藏或拒绝工具，
而会在执行期通过 `ToolExecutionContext.modelInputAdmission` 告知工具是否允许生产 selection。
这不是 catch 后丢附件；工具必须在创建临时授权或受管副本前读取准入事实。

## 4. 你不要做的

- 不要让工具直接吃 host 的全局单例（数据库、配置中心等都按 patch / context 注入）。
- 不要把 runtime 保留字段（`__runtime` / `__capabilities`）手工拼进 patch；统一过 `ensureToolContextRuntimeCapability`。
- 不要从 deep path 抓 helper（凡是没出现在 `@linnlabs/linnkit/runtime-kernel` 公开符号里的，下个 minor 可能就消失）。
- 不要在 ToolNode 或通用工具协议里按工具名、插件名或 asset 表结构分支；产品 selection 和解析规则由 host 工具与窄 port 提供。
- 不要把 Host 的动态 Schema 输入包装成 Linnkit 的通用扩展袋，也不要把完整 invocation 直接暴露给 concrete/plugin tools；Host 只派生真实消费者需要的窄上下文。
- 不要给工具 definition 或 RuntimeEvent metadata 增加 UI 展示字段；runtime 只传业务事实，Renderer 自己拥有完整卡片 `presentation` 与紧凑步骤 `compactStep` projector。两者共用产品 Renderer registry，但都不属于 Linnkit 执行合同。
- 不要把进程内 in-flight/history 复用当成跨进程强幂等；后者需要 host 持久化锁或唯一索引。

## 5. 最小验证

- 单测：用 `createToolContextFixture()` 直接测 `tool.run(args, fixtureContext)`。
- 集成测：在 host-bound `ToolRuntimeHarness` 上覆盖"失败恢复 / 并行调用 / observation 预览"路径。

## 6. ObservationPreviewPort：配置超长 observation 存储路径

`contextPolicy.toolOutput.observationGovernance` 只控制**什么时候治理**：

```ts
contextPolicy: {
  profileId: 'agent',
  toolOutput: {
    observationGovernance: {
      enabled: true,
      maxChars: 20_000,
      maxLines: 1_200,
    },
  },
}
```

完整内容**存到哪里**由 host 的 `ObservationPreviewPort` 决定。最小形态：

```ts
import path from 'node:path';
import { promises as fsp } from 'node:fs';
import { createHash } from 'node:crypto';
import type { ObservationPreviewPort } from '@linnlabs/linnkit/runtime-kernel';

export function createFsObservationPreviewPort(params: {
  rootDir: string;
}): ObservationPreviewPort {
  return {
    async truncateObservation({ context, toolName, text, maxChars, maxLines }) {
      const raw = String(text ?? '');
      const lines = raw.split('\n');
      if (raw.length <= maxChars && lines.length <= maxLines) {
        return { truncated: false, preview: raw };
      }

      const blobId = createHash('sha256')
        .update(JSON.stringify({
          conversationId: context.conversationId,
          turnId: context.turnId,
          toolName,
          textHash: createHash('sha256').update(raw).digest('hex'),
        }))
        .digest('hex')
        .slice(0, 16);

      const filePath = path.join(params.rootDir, 'tool_output', 'blobs', `${blobId}.json`);
      await fsp.mkdir(path.dirname(filePath), { recursive: true });
      await fsp.writeFile(
        filePath,
        JSON.stringify({
          version: 1,
          kind: 'tool_output_text',
          conversation_id: context.conversationId,
          turn_id: context.turnId,
          tool_name: toolName,
          text: raw,
        }, null, 2),
        'utf-8',
      );

      return {
        truncated: true,
        blob_id: blobId,
        preview: [
          raw.slice(0, Math.floor(maxChars * 0.7)),
          '',
          `...（内容已截断，完整内容已写入 blob_id=${blobId}）...`,
        ].join('\n'),
      };
    },
  };
}
```

然后在 executor 装配处传入：

```ts
import { createDefaultGraphExecutor } from '@linnlabs/linnkit/runtime-kernel';

const observationPreview = createFsObservationPreviewPort({
  rootDir: process.env.MY_AGENT_TOOL_OUTPUT_DIR ?? '/var/lib/my-agent',
});

const executor = createDefaultGraphExecutor({
  llmNode,
  toolRuntime,
  observationPreview,
});
```

**重要边界**：

- `blob_id` 只是指针。host 如果提供续读工具，该工具必须和 `ObservationPreviewPort` 使用同一个 store / rootDir。linnkit 不规定工具名、URI 或产品领域协议。
- live 截断成功后，Linnkit 把这个引用发布为 `tool_output.metadata.observationTruncation.blobId`；它属于通用运行时元数据，不能注入具体工具 owner 的 `data`。
- AgentSpec 不应该包含本地路径、S3 bucket、数据库 DSN 这类基础设施字段；这些属于 host 部署配置。
- 示例 host 可以使用 workspace root 下的 conversation artifact 路径：
  `<workspaceRoot>/Artifacts/v1/conversations/<conversationId>/instances/<instanceId>/tool_output/blobs/<blobId>.json`。
  其中 `workspaceRoot` 应来自 host 自己的部署配置、环境变量或工作区配置。host 的续读工具也必须使用同一个 store，否则模型拿到 `blob_id` 后无法续读。

## 7. 工具最小示例

> 完整规范见 [`tool-development-guide.md`](./tool-development-guide.md)。本节只给最小可运行示例。

```ts
import {
  BaseTool,
  type ToolArgs,
  type ToolExecutionContext,
  type ToolParameterSchema,
} from '@linnlabs/linnkit/runtime-kernel';

interface EchoArgs extends ToolArgs {
  text: string;
}

export class EchoTool extends BaseTool<EchoArgs> {
  readonly name = 'echo';
  readonly description = '回声测试，用于验证工具调用链路';

  readonly parameters: ToolParameterSchema = {
    type: 'object',
    properties: {
      text: { type: 'string', description: '要回声的文本' },
    },
    required: ['text'],
  };

  async run(args: EchoArgs, _context: ToolExecutionContext): Promise<string> {
    const result = {
      data: { echoed: args.text },
      observation: `Echoed: ${args.text}`,
    };
    return JSON.stringify(result);
  }
}
```

**协议层强制约束**（违反会被运行时拒绝或导致下游解析失败）：

| 约束 | 协议层守门 |
|------|-----------|
| `name` / `description` / `parameters` 必填 | `BaseTool` 抽象类强制 |
| `run` 返回 `Promise<string>`（不是对象，是字符串）| `BaseTool.run` 签名 |
| 成功 `run` 返回 `JSON.stringify({ data, observation })` 格式 | ToolNode 运行时合同与上下游消费者依赖 |
| 顶层必填参数走 `parameters.required[]`，**不要**在 `run` 里手写 if-check | `BaseTool.validateArguments` 默认浅校验 |
| 类型、格式、判别联合与跨字段规则在 start 前拒绝 | concrete tool 的 `validateArguments` + ToolNode admission |
| 失败必须 `throw`，**不能**返回伪装成功的 JSON | tool 配对不变量 C10 + AuditEnvelope |

详细的设计思想、错误处理规范、超长 observation 治理、交互工具协议等见 [`tool-development-guide.md`](./tool-development-guide.md)。

### SDK 边界

Linnkit 负责 `parameters` / `validateArguments` 的通用接口和“owner admission 先于 start”的执行顺序，
不负责具体产品的字段身份、互斥分支、parser 或错误码。只有在多个独立 host 已形成稳定、parser-neutral
合同后，参数 admission 适配器才适合成为公开 SDK；不要把单一产品的 schema builder 下沉到 framework。

最小测试分三层：直接调用 `run()` 验证工具业务；真实 `ToolNode + ToolRuntimeDefinition.validateArguments`
验证错误参数不会产生 start 或进入 execute；host runtime harness 验证能力注入与产品装配。三者不能互相替代。
