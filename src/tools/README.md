# 自定义工具开发规范 (README.md)

> 🎯 **核心**: 本文档为开发者提供了在 `src/tools/` 目录下创建、实现和注册自定义工具的完整指南。遵循这些规范是确保工具能够被Agent系统正确识别、调用和管理的关键。

> **配套阅读**：Linnkit 的通用执行协议见 [独立 Linnkit 仓的 `src/runtime-kernel/tools/README.md`](https://github.com/linnlabs/linnkit/blob/main/src/runtime-kernel/tools/README.md)，接入说明见 [独立 Linnkit 仓的 `docs/integration/tools.md`](https://github.com/linnlabs/linnkit/blob/main/docs/integration/tools.md)，完整通用规范见 [独立 Linnkit 仓的 `docs/integration/tool-development-guide.md`](https://github.com/linnlabs/linnkit/blob/main/docs/integration/tool-development-guide.md)。本文件在这些通用合同之上补充 Linnya concrete tool 的目录、参数可读性、产品结果和 Renderer 约定。

## 设计思想

tool的设计思想是：用最少的token，传递最多的信息。因此在设计参数、返回结构时，不要一股脑啥都放，很多信息是不必要的。
tool的设计规范是：工具是抽象的，具体的复杂实现，应该在上层，除非必须，否则不建议在工具内部实现复杂函数。
tool 的数据合同应优先选择最小且稳定的结构：如果一个字段只是中间推导物、展示噪音或可以由上层自由决定，就不要把它塞进工具参数或返回值里，更不要为了“看起来更结构化”拆出多层次嵌套对象。

### 工具目录边界

- `src/tools/` 管理平台通用能力族；某个文档领域或插件独占、且离开该领域就没有意义的专属工具，应与领域实现放在 `src/domains/<domain>/tools/` 或插件包内，再由 App Host 汇集其 `toolClasses` contribution。不要为了让所有类都位于 `src/tools/` 而拆散业务领域。
- `src/tools/` 第一层优先表达稳定能力族，例如 `workspace/`、`commands/`、`agent_control/`、`knowledgebase/`、`web/`；第二层才是单个工具或紧密协作的 feature。
- 只被工具消费的存储 reader、历史回放、Host ToolContext 适配或领域规则，仍然必须回到它们自己的 domain / app-host feature；“工具会用到”不等于“它属于 `src/tools/`”。
- 单工具目录使用公开工具的稳定业务名，例如 `workspace/read_file/`、`commands/shell/`、`agent_control/ask/`。路径和工具名应尽量保持同一语言，禁止使用 `base/`、`common/`、`misc/` 等无法说明事实源与权限的宽泛名称。
- 工具类、测试、专属文档以及该工具内部的 `definitions/`、`functions/`、`orchestration/` 应收口在同一目录，禁止把生命周期和变更原因不同的工具塞进宽泛的聚合目录。
- 多个工具只有在共享同一业务语言、事实源或控制面时才归入同一能力族；它们仍应保留独立 feature 目录和合同。能力族 `shared/` 只接纳至少两个 feature 稳定复用的窄能力，不能成为迁移遗留文件的收容所。
- 能力族 `index.ts`、顶层 `index.ts` 和宿主注册层只负责公开入口与清单聚合，不承载业务规则。
- 当前平台示例：Workspace 聚合只包含五件套；`markdown_create_annotations` 与 `write_to_table` 位于 Markdown domain，分别依赖正式文档的 Block/annotation 生命周期和富文档 TableBlock 填充 session。普通 `text/markdown` 预览没有这些语义，也不会加载该工具能力。
- 请求级动态 Schema 由 App Host registry 从通用 invocation 派生窄 `LinnyaToolSchemaContext` 后交给 concrete tool；工具不得直接读取完整 query/history，产品字段也不得反向加入 Linnkit。该窄合同属于既有 `types.ts`，具体规则和测试仍收口在对应工具 feature。
- 调试、mock 和 testkit 工具必须留在对应的测试边界，不得为了端到端调试加入平台生产 `toolClasses` contribution。Mock LLM 若要模拟工具调用，必须显式指定本次 Agent 已经暴露的真实工具，不能依赖全局调试工具。
- 数据库检查、数据重置、手工诊断 CLI 和端到端脚本属于 [`scripts/`](../../scripts/README.md)，即使它们直接调用某个工具类也不能放进 `src/tools/`。顶层只允许 `index.ts`、`ports.ts`、`types.ts` 三个公共合同/聚合入口。

Concrete tool 的 strict parser/result schema 跟随领域 owner：Host 工具放在 `@app/schemas` 或对应 Host domain；插件独占工具放在插件 shared，由插件 backend producer 与 Renderer projector 共同消费。禁止为了统一物理目录把插件业务字段塞进 Host 全局 schema，也禁止前端再手写一套宽松读取器。Slides 的最小结果示例见 [Slides shared](../../packages/plugins/slides/src/shared/README.md) 与 [presentationInspection](../../packages/plugins/slides/src/backend/features/presentationInspection/README.md)。

### Agent 工具粒度与 bash 网络边界

- 优先提供可组合、可逐步决策的原子能力。agent 能在一次 observation 后决定下一步时，不要为了“批量化”预先发明范围、深度、页数等大而全参数。
- 批量工具只有在出现稳定、重复、可观测的真实工作流，并且原子工具或 bash 组合明显不足时才立项；禁止仅因底层可以实现就暴露新的 agent 工具。
- `web_read` 属于 Web domain：请求会经过 URL/DNS/SSRF 策略、预算、内容抽取、注入隔离与 Evidence 物化。bash 中的 `curl`、`wget` 和用户脚本不经过这些链路，二者不是安全等价入口。
- bash 若允许联网，必须在 bash feature 自身定义网络隔离、文件系统隔离、进程权限、资源预算与审计边界。bash 输出不会自动生成 Web citation 或 Evidence；禁止通过无业务合同的通用胶水把任意命令输出伪装成可信网页证据。

### 插件 CLI 与 Shell 的边界

Agent 通过既有 `shell` 调用 enabled 插件的 CLI facade，例如 `linnya-slides`，再按插件 Skill 指引使用
`read_file` 读取对话目录中的产物。Agent 工具协议、Commands domain 和 Shell schema 都不增加插件 ID 或
插件参数字段；命令名、argv、exit code 和领域错误仍由插件自己的 parser 与 orchestration 拥有。

facade 是不启动 Electron 的极小原生 client，通过父 Shell execution 的内部环境访问当前 App Host 的
execution-scoped bridge。bridge 只做 enabled registry 寻址、access plan 校验和 invocation draining，不拥有
第二个 command owner、审批、输出或终态。未来新增插件只贡献同一个窄 `pluginCli` 合同和 Skill，不应在
Linnya 本体增加 Agent 工具分支。`plugin.json.entry.command` 继续表示供人、开发脚本与 CI 使用的 standalone
入口，不是 Agent PATH 中的 facade 文件。

## Shell 与 Process 工具

当前正式注册的命令工具是 `shell` 和 `process`，分别负责启动一次性 Shell和控制已经返回 handle 的进程。
插件 CLI 也是 Shell 命令，不是第三种 Agent 工具。产品字段、返回投影和生命周期不在本通用工具开发指南中重复维护：

- [Shell Tool](./commands/shell/README.md)
- [Process Tool](./commands/process/README.md)
- [Plugin CLI Shell Bridge](../app-hosts/linnya/application/plugin-cli-shell-bridge/README.md)
- [Commands Domain](../domains/commands/README.md)
- [命令执行](../domains/commands/README.md)

Shell 和 Process 可以调用网络与普通宿主 CLI，但 Linnya 不管理其安装、版本、Python 环境或包管理器。
Linnya 自己安装的插件 facade 受 bridge v1 access plan 约束，固定拒绝外部文件、网络、GUI 和本地 IPC；
普通第三方 CLI 不因此获得相同承诺。新增命令工具字段必须先更新 Commands schema 和对应工具 README，再经过
host projection；不能直接把内部 runtime 对象塞进工具结果。

## Subagent 协作工具

`subagent` 是 Agent 为节省上下文或并行拆解独立工作而使用的通用协作能力，不是子 Agent 的专属功能入口。facade、动态类型解析、正式 artifact 提取与可见 child runner 均收口在 [Subagent 工具规范](./agent_control/subrun/subagent/README.md)。旧 `delegate` 没有 executable alias；历史事件只由 Renderer 回放配置解释。

TaskState、Checkpoint、Ask 与 Subrun 的目录和依赖边界见 [Agent Control 工具族](./agent_control/README.md)。该目录只做能力归属，不把四种不同生命周期合并成统一状态机。

## 1. 核心概念：`BaseTool` 抽象类

所有自定义工具都**必须**继承自 `src/tools/types.ts` 中定义的 `BaseTool` 抽象类。这个基类定义了Agent系统与工具交互所需的标准接口。

```typescript
// src/tools/types.ts
export abstract class BaseTool {
  // 强制实现
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly parameters: ToolParameterSchema;
  
  // 可选实现（只描述执行语义）
  readonly idempotency?: ToolIdempotencyPolicy;
  readonly modelInputRequirement?: ModelInputRequirement;
  readonly modelInputDelivery?: 'required' | 'when_supported';
  getExecutionSummary?(output: string): string;

  // 必须实现
  abstract run(args: ToolArgs, context: ToolContext): Promise<string>;
}
```

## 2. 强制实现的属性

每个工具都必须定义以下三个核心属性：

### a. `name`

工具的唯一标识符。

- **规范**:
  - **命名**: 必须使用 `snake_case` (小写字母，下划线分隔)，例如 `knowledge_search`。
  - **唯一性**: 在所有工具中必须是唯一的。
- **示例**:
  ```typescript
  readonly name = 'my_custom_tool';
  ```

### b. `description`

工具的功能描述，这是**写给 LLM 看的**。一个高质量的描述是让 Agent 能够准确理解并恰当使用该工具的关键。

- **规范**:
  - **清晰简洁**: 用一句话概括工具的核心功能。
  - **何时使用 (When to Use)**: 明确列出 Agent 应该在何种场景下选择使用此工具。
  - **策略 (Strategy)**: (可选) 提供使用该工具的最佳实践或建议策略。
  - **输入/输出**: 简单说明工具的输入和输出。
- **示例**:
  ```typescript
  get description() {
    return `Calculates the sum of a list of numbers.

# When to Use

- When the user asks to sum, add up, or find the total of multiple numbers.

# Output

Returns a single number representing the sum.`;
  }
  ```

### c. `parameters`

使用 [JSON Schema](https://json-schema.org/) 格式定义工具所需的输入参数。Agent 会利用这个 Schema 来验证参数，并可能用它来辅助生成调用代码。

- **规范**:
  - **类型**: 必须是 `object` 类型。
  - **`properties`**: 定义每个参数的名称、类型 (`string`, `integer`, `boolean`, `array`, `object`) 和描述。
  - **`required`**: 一个字符串数组，列出所有必选参数的名称。
  - **声明位置**：暴露给 AI 的完整 `readonly parameters` JSON Schema 必须直接声明在 concrete tool 文件中，方便开发者打开工具文件时同时查看、修改工具描述、输入参数和执行逻辑。不能把顶层 `properties`、`required` 或完整 `oneOf` 隐藏到 schema factory / builder 后面。正式 parser、DTO 和推导类型仍按职责放在对应 `definitions/` 或 schema 包中。
  - **允许的复用**：复杂参数内部若包含独立、稳定且在多个分支复用的子合同，可以使用有业务名称的常量；但 concrete tool 中仍须一眼看清顶层参数和合法分支。为了让 provider 收到封闭 `oneOf` 而重复列出少量字段是有意的合同表达，不要用“更聪明”的 builder 牺牲可读性。
  - **可选非空字段**：字段可省略不代表可以传空字符串。新增或修改工具时，若字段一旦出现就必须有内容，必须同时在这里声明 `minLength: 1`，并在 `@app/schemas` 的正式参数合同中使用同等约束；未指定时在调用中省略该字段，不要传 `""`。
- **示例**:
  ```typescript
  readonly parameters: ToolParameterSchema = {
    type: 'object',
    properties: {
      numbers: {
        type: 'array',
        items: { type: 'number' },
        description: 'An array of numbers to be summed.'
      }
    },
    required: ['numbers']
  };
  ```

- **必填参数是强约束，不是提示**:
  - 任何业务上“没有它就不能执行”的字段，都必须放进 `required`。
  - 例如 `write_file.content`、`edit_file.old_string`、`edit_file.new_string`。
  - 缺失 `required` 字段的工具调用会在执行层被直接判定为失败，不会进入 `run`。

- **判别联合必须写进结构合同**：
  - 同一对象因 `type` 等判别字段拥有不同合法字段时，必须使用 `oneOf` 为每个分支声明封闭对象，并在分支中设置 `additionalProperties: false`。
  - 禁止只在字段 `description` 里写“仅某类型可用”，同时把该字段放进所有类型共享的 `properties`；这会让模型可见合同与 owner admission 分叉。
  - `validateArguments` 的正式 parser 必须表达同一组分支。协议错误应返回具体字段路径，便于模型修正，不能只拼接重复的无路径消息。
  - JSON Schema 是模型可见合同，正式 parser 是 owner 执行合同。二者必须同构，但不要求由同一个生成器产出；如果生成器会让开发者无法直接审查模型完整输入面，应优先保留显式声明，并用业务测试证明二者一致。

## 3. `run` 方法

这是工具的执行入口，包含了工具的核心逻辑。

- **规范**:
  - **签名**: `async run(args: ToolArgs, context: ToolContext): Promise<string>`
  - **`args`**: 一个包含所有已验证参数的对象。
  - **`context`**: 一个包含额外上下文信息（如 `knowledgeBaseService`）的对象，按需使用。
  - **返回值**: **必须**返回一个 `Promise<string>`，并且**强制要求返回 JSON 字符串**（`JSON.stringify(...)` 的结果），不要返回纯文本。
    - 原因：执行层会解析并校验返回值，再把 `observation/data` 作为唯一 `tool_output` 结果合同持久化。纯文本无法提供可校验的数据合同。
    - 约定：请将“给 Agent 的文本”放在 `observation`，将“给程序化消费者的结构化事实”放在 `data`。

### 结构化返回 (`StructuredToolResult`)

所有暴露给 Agent 的工具都必须使用 `StructuredToolResult`，明确分离“给 Agent 的文本”和“给程序化消费者的结构化事实”：

```typescript
// src/tools/types.ts
export type StructuredToolResult<T = Record<string, unknown>> = {
  data: T; // 供持久化、审计与后续业务流程消费的结构化事实
  observation: string; // 必填，提供给 AI 的唯一业务结果视图
  control?: ToolControlInfo; // (可选) 工具控制面，如 requireUser / terminateRun / finalAnswer
  observationPreviewMeta?: ToolObservationPreviewMeta; // (可选) 超长 observation 预览元信息
};
```

- 类型入口已经统一收口到 [`src/tools/types.ts`](./types.ts)。
- 新工具不要再从旧的 `ui_types` 路径导入；请统一使用：

```typescript
import type { StructuredToolResult } from 'src/tools/types';
```

- **`data`**（必填）: 包含持久化、审计或后续业务流程所需的稳定事实；没有结构化结果时返回空对象 `{}`。
- **`observation`**（必填）: 提供给 AI 的唯一业务结果视图，必须包含至少一个非空白字符的纯文本；正文首尾的换行或缩进必须保留，不能用 `.trim()` 改写工具真实输出。ToolNode 会在运行时校验；缺失或全空白字符串会返回 `TOOL_RESULT_CONTRACT_VIOLATION`，不会把 `data` 回退暴露给 AI。
- **强制分层规范（必须遵守）**：
  - **`data`（给程序化消费方）**：
    - 必须包含审计或后续流程所需的业务字段；字段名要稳定，消费方不得临时猜 shape。
    - 工具 owner 必须在 `@app/schemas` 提供 strict schema，并在生产边界按同一 schema 构造结果。
    - “对象是谁、操作了什么、作用在哪个范围”等稳定事实必须直接进入具名字段，不能要求消费方解析 `observation` 恢复结构。
    - 可以保留确有消费价值的索引或派生字段，但不要把长正文、重复文本或中间计算状态塞进 `data`，避免放大持久化与网络开销。
  - **`observation`（给 AI）**：
    - 必须是**纯文本**、可读、信息密度高且自包含；同一业务事实可以分别以结构化字段和自然语言出现，但不要复制 `data` 的 JSON 或大段正文。
    - 禁止在 observation 里拼大段 JSON；也不要加 emoji 等噪音（除非产品明确要求）。
    - **不要在工具内部实现“超长截断/落盘”**：统一由执行层（ToolNode）治理超长 observation。
      - 机制：当 `observation` 超过 20,000 字符或 1,200 行时，ToolNode 会自动把全文写入 conversation-root 的 ToolOutputStore（生成 `blob_id`），并把 observation 替换为“短预览 + `tool_output_read({"blob_id":"<blob_id>"})` 继续读取指引”；durable 身份发布在 `tool_output.metadata.observationTruncation.blobId`，不得注入具体工具 `data`。
      - 好处：全仓一致、避免重复落盘、避免每个工具各自发明一套截断协议。
      - Host 存储、身份和字符 cursor 续读合同见 [`tool_output/README.md`](./tool_output/README.md)；禁止在其他工具里复制 blob schema、路径或行 cursor。
  - **返回字符串必须是 JSON**：
    - `return JSON.stringify({ data, observation })`
    - 禁止：`return '已完成...'` 或 `return observation`
    - 禁止：只返回 `{ data }` 并依赖执行层把 JSON 暴露给模型
- **`metadata` 的边界**：
  - `metadata` 只能表示结果的次要业务属性；对象身份、操作结果、分页状态、流程控制等核心事实必须使用具名字段或判别联合。
  - 工具只有在自身结果合同确实需要这组属性时才定义 `data.metadata`。它必须由工具 owner 在 `@app/schemas` 中声明为封闭的 strict schema；禁止使用 `Record<string, unknown>`、`z.record(z.unknown())`、`passthrough` 或任意键扩展。
  - 每个字段都必须有明确生产者、业务含义和消费者。不能回答这三件事的字段不进入公共工具结果。
  - 值必须是可序列化 JSON，禁止放实例、函数、路径句柄、临时缓存、重复核心字段或流程控制状态。
  - 消费方必须解析完整工具结果后读取字段；禁止用 `typeof` 探测、字段组合猜测或默认值吞掉未知 shape。
  - VFS、插件和 provider 可以在各自内部合同中保存 owner 管理的详情；内部详情不会自动穿透到 `StructuredToolResult.data`。出现真实跨边界消费者时，只把它需要的事实提升为公共 strict schema 的具名字段。
- **工具控制面（`control`）**：
  - `control.requireUser=true`：交互工具请求暂停本轮 run，等待用户输入。详见下方“事件/投影层注意事项”。
  - `control.terminateRun=true`：工具执行并写入 `tool_output` 后，当前 run 直接结束，不再回到 LLM 生成复述文本。
  - `control.finalAnswer='...'`：请求 runtime 把工具产物投影为 `final_answer` 事件。
  - 典型组合：`finalAnswer + terminateRun`，用于“工具结果就是最终答案/闭环产物”的工具，例如 deep research 的 `write_report`，以及 deep search 的 `assemble_documents`。
  - 不要滥用：普通读取、检索、编辑、写文件工具不应 `terminateRun`；它们只是给 agent 下一步决策提供 observation。
- **超长 observation 预览元信息（`observationPreviewMeta`）**：
  - 如果工具知道这段 observation 对应哪个文件/文档，可以返回 `filename`、`document_name`、`doc_type` 等轻量字段。
  - ToolNode 只读取这个通用字段并传给预览/落盘 port，不会再按具体工具名猜业务规则。
  - 该字段是执行期输入，会被 ToolNode 消费；Conversation 工具消息只持久化业务 `data`、`observation` 和通用截断身份。Renderer 卡片不得依赖 `observationPreviewMeta` 重建业务展示。
- **`run` 方法示例**:
  ```typescript
  async run(args: ToolArgs, context: ToolContext): Promise<string> {
    const { numbers } = args;
    const sum = numbers.reduce((a, b) => a + b, 0);

    const result: StructuredToolResult<{ sum: number }> = {
      data: { sum },
      observation: `The sum of the numbers is ${sum}.`
    };

    return JSON.stringify(result);
  }
  ```

### 错误处理规范（必须遵守）

- **工具执行失败**：
  - 直接 `throw new Error('...')`，由执行层统一将 `tool_output.status` 标记为 `error`。
  - 不要用“返回一个看似成功的 JSON，但 data.error=xxx”的方式来伪装成功；这样会让 UI 状态与实际不一致。
  - 若该失败存在明确的 UI、审计或自动化消费者，可由错误类声明稳定非空 `code`；Host 会把它投影为 `tool_output.error_code`。错误自然语言仍应简短并能指导 Agent 下一步，前端不得解析文案识别错误类型。
- **必填参数缺失 / schema 不满足**：
  - 这属于**工具调用协议错误**，不是普通业务结果。
  - 必须通过 `parameters.required` 声明，让执行层在 `run` 前统一拦截。
  - 当前 `BaseTool.validateArguments` 只检查顶层 required 与 additional properties。数组元素、唯一性、跨字段计数等深层合同必须由工具使用正式 schema parser 校验；需要让 ToolRegistry 把它归类为 protocol error 时，应覆写 `validateArguments`，`run` 内仍保留同源解析以支持直接调用。
  - 覆写后的 `validateArguments` 会通过 `ToolRuntimeDefinition` 暴露给 Linnkit ToolNode，并在 `tool_process(start)` 之前执行。失败调用不算“已启动”，只产生配对 `tool_output(error)`；Renderer 不得通过 loading 卡片补造失败。
  - 直接调用 `run()` 的测试不能证明这一时序。涉及跨字段或判别联合时，必须另有真实 `ToolNode + ToolRuntimeDefinition.validateArguments` 测试，证明错误参数不会产生 start、不会进入 provider 或业务 mutation。
  - 不要在 `run` 里把这类错误包装成 `{"data":{"error":"Missing required parameter: ..." }}` 再返回成功字符串。
- **工具执行成功但部分子操作失败（批量场景）**：
  - `tool_output.status` 仍然是 `success`，但必须在 `data` 中给出每条子操作的 `status/message`，供后续流程准确判断。
  - 同时在 `observation` 里给 AI 一个简短摘要（不要重复每条细节）。
- **工具执行成功但增强步骤降级（非批量也适用）**：
  - 如果主操作已经完成，而失败的是 citation hydration、摘要补全、附加元数据写入这类“增强步骤”，则不应把整个工具升级为失败。
  - 这种情况应保持 `tool_output.status=success`，并在 `data.warnings` / `observation` 中明确说明“主操作已完成，但某个增强步骤已降级或跳过”。
- **LLM 在工具调用前产出坏掉的参数，不属于工具错误**：
  - 例如流式阶段的 `tool_call.arguments` 最终不是合法 JSON，这说明是上游模型输出损坏，`run` 还没有执行。
  - 这种情况必须在运行时 / LLM 调用层处理为协议错误或可重试错误，不能伪装成某个工具的业务失败，也不要在工具层返回“成功但 data.error=...”。

### 生命周期阶段的参数

`tool_call_decision` 与 `tool_process` 的 loading 快照可能来自模型参数增量，尚未通过工具 owner 的正式 schema。需要展示 loading/error 的工具可以定义显式 lifecycle 参数合同，只读取展示所需的少数字段；正式 success 分支仍必须 parse 正式参数和结果 schema。禁止在 Renderer 用 `catch`、空对象或 observation 猜测业务结果掩盖合同错误。

### 幂等执行规范

只有真正有副作用、同一业务 scope 内同参重试必须复用成功结果的工具才声明 `BaseTool.idempotency`。只读或纯计算工具不要把普通缓存伪装成幂等合同。

- scope 只能是 `conversation` 或 `turn`，对应身份缺失时 runtime 明确失败，不猜测其它 scope。
- 唯一 key 合同是 32 hex（128-bit）的 SHA-256 前缀；具体工具和 Host 不复制生成算法。
- ToolNode 只复用成功结果，并只保证进程内 in-flight 合并与 working history 复用。跨进程强幂等需要 Host 持久化锁或唯一索引。
- 旧 16 hex key 不双读；升级后按 cache miss 处理。
- cache hit 后，模型附件等 scope-sensitive 后处理仍按当前上下文重新解析，不能直接复用旧 durable ref。
- 对可变文件的写入/编辑不能仅按同参历史结果去重：相同参数不代表当前文件仍是上次操作后的状态，见 [Workspace 工具合同](workspace/README.md)。

权威合同与完整验收矩阵见 [独立 Linnkit 仓的 `docs/integration/tool-development-guide.md §3.2`](https://github.com/linnlabs/linnkit/blob/main/docs/integration/tool-development-guide.md#32-幂等执行合同)；底层 owner 见 [独立 Linnkit 仓的 `src/runtime-kernel/tools/README.md`](https://github.com/linnlabs/linnkit/blob/main/src/runtime-kernel/tools/README.md)。

### 系统专用批量工具

正式参考实现见 `src/tools/agent_control/subrun/batch/README.md`。该工具展示了以下边界：host 注册但不暴露给 Agent、稳定 child 身份、父模型透传、受控并发、部分失败/取消聚合，以及工具完成后回到父 LLM 正常生成 `final_answer`。业务资源写入不属于 batch 工具，应由调用方 domain 的窄 port 承担。

## 4. 可选的增强功能

### a. Renderer 展示开发入口

工具的前端展示是对应 feature 的独立交付部分，使用 Renderer `ToolUiConfig` 注册：

1. 工具 feature 提供 strict result schema 与纯 presentation projector。
2. app-level registry 按 `tool_name` 解析 alias，并在 live/reload admission 边界调用 projector。
3. projector 一次完成 wrapper adapter、strict parse 和展示模型构造。
4. Vue 卡片只读取 `presentation`，不读取原始 `args/result`，也不在 reactive effect 中 parse。
5. 每个 live executable 的最终非 alias config 同时声明 `compactStep`；它只生成紧凑步骤
   presentation，不能调用完整卡片 projector。标题保存延迟本地化 descriptor，不进入工具结果。

完整卡片与紧凑步骤共用同一份 Renderer `toolCards` 注册和 alias 解析，但使用两个独立 projector。
Conversation 只通过窄 port 请求紧凑展示，不维护工具名映射；未注册或插件未加载的工具才显示通用
诊断标题。已命中注册项但 compact 参数违法时必须拒绝该批 admission，禁止降级成协议名。

卡片若需要 subrun trace 或 conversation scope 的历史资源读取，必须在 `ToolUiConfig.runtime` 中逐项
声明 capability，由 Host 只透传被声明的事实。trace、conversation identity 不属于展示派生数据，禁止
塞进 presentation 或 message metadata；也禁止扩张成可以读取整份 store/message 的万能 context。

每个正式暴露给 Agent 的业务工具都必须提供自己的 Renderer UI 注册。卡片可以按产品语义只展示 header，也可以复用同一业务 feature 的共享组件，但不能因为工具当前未被某个 Agent 注册、当前配置了 `hideContent`，或通用内容视图能够显示原始文本，就省略或删除对应卡片。通用工具内容视图只负责未知工具、插件未加载或注册异常时的诊断展示，不是正式工具的目标实现。

展示合同、注册位置与迁移门禁统一见 [`docs/conversation-platform/09-tools.md`](../../docs/conversation-platform/09-tools.md)，本工具执行指南不重复定义展示字段。

### b. 事件/投影层注意事项（开发者须知）

这不是工具代码的一部分，但会影响你设计返回结构：

- **前端只读取 canonical `tool_output.observation/data`**。live/reload admission 必须共用 strict schema projector，禁止解析原始返回字符串，也禁止恢复 `output/payload.result` 影子合同。
- **最终产物工具可以结束 run loop**：
  - 当工具结果已经是本轮最终答案或最终产物时，返回 `result.control.terminateRun=true`。
  - 如果还需要在 UI / 持久化层出现最终答案事件，同时返回 `result.control.finalAnswer`。
  - 这属于工具返回协议，不属于 runtime 的工具名特判；新增工具不要要求 ToolNode 识别自己的名字。
- **`requireUser` 工具必须遵守 ask 同构的“单消息交互协议”**：
  - 第 1 段：工具本身返回完整 `StructuredToolResult`，并在 `result.control.requireUser=true` 中声明“需要用户继续交互”。
  - 第 2 段：`ToolNode` 不再为这类工具额外持久化首条 `tool_output`；它只把 `pendingInteractionSpec` 写入 local state，然后 route 到 `wait_user`。
  - 第 3 段：`WaitUserNode` 发出 `requires_user_interaction`，表达“本轮 run 已正式 pause，等待用户输入”。
- **reload / replay 恢复规则**：
  - 交互卡片的初始内容必须能从 `tool_call.arguments` 直接重建；不要把“首次工具输出快照”当成唯一事实来源。
  - `ppt_plan`、`ask` 这类卡片都应按这个原则设计：等待态依赖 `args`，完成态再叠加 `interaction`。
  - 只有那些“初始 UI 数据天然不在 arguments 里”的工具，才应该重新审视其数据合同；不要默认通过多写一条持久化 `tool_output` 来补救设计问题。
- **用户回复 interactive tool 时，也必须继续使用唯一那条 `tool_output` 事件**：
  - 例如 `approved / modified / submitted / skipped` 这类状态，以及对应的 `response` 数据，应写在新的 `tool_output.metadata.interaction` 中。
  - `tool_output.observation/data` 承载继续执行所需的文本与结构化事实；`metadata.interaction` 只承载交互完成态。
- **前端约定**：
  - 交互工具的初始事实来自 `tool_call.arguments`，完成态事实来自 `message.metadata.interaction`；二者都必须在 live/reload admission 边界经 registry projector 转为 presentation，Vue 卡片只读取 presentation。
  - 完成态统一读取 `message.metadata.interaction`。
  - `requires_user_interaction` 是控制面事件，不应被当成新的工具结果消息。
- 换句话说：`StructuredToolResult` 是“工具层协议”，交互工具的事件层协议是“`tool_call.arguments` 初始数据 + `requires_user_interaction` 控制事件 + 用户提交时唯一一条 `tool_output(metadata.interaction)` 回复事件”。

这是新增和迁移工具卡的终态要求。当前十六张实体卡、七个 live header-only 注册项 `list_files / read_file / write_file / edit_file / grep / assemble_documents / evidence_resolve`，以及历史只读 `assemble_evidence` 注册项由 AST baseline 锁住；已知存量迁移面已经清零，[`R-22`](../../docs/conversation-platform/12-open-risks.md) 关闭。新增正式工具仍必须在同一业务切片补共享 schema、projector、live/reload admission 与 baseline；历史 projector 不得被误认为 executable alias。

### c. 工具占位渲染（早期 tool_call）

为了让某些工具在参数尚未完整时也能提前渲染卡片（类似图片生成的占位效果），系统支持“占位 tool_process”：

- **触发时机**：LLM 流式返回 `tool_calls` 的 delta 阶段，一旦拿到 `tool_call_id + tool_name` 就可发出占位 `tool_process`。
- **作用**：前端立刻显示卡片并进入 loading 状态，后续完整 `tool_call_decision/tool_output` 再补齐内容。
- **实现方式**：
  - 占位 `tool_process` 会携带 `meta.ephemeral = true`，仅用于实时 UI，不会持久化历史。
  - policy 由 concrete tool/runtime definition 声明，并由 host 在本次调用上下文中传给 Linnkit；accumulator 只负责按通用 policy 聚合并触发事件。

**如果你的工具需要占位渲染**：

- 确保前端组件能在 args 不完整时安全显示 loading。
- 在 concrete tool/runtime definition 上声明 `streaming` policy，并验证不完整 args 的 lifecycle presentation。

host forced-tool 不走这套 LLM 参数增量占位机制。宿主必须在工具开始执行前发送携带完整 `args` 的 `tool_call_decision`；前端应由 admission projector 使用这些参数创建 loading presentation，并用后续实时事件增量更新，最终 `tool_output` 只负责收敛结果。不要仅为 host forced-tool 扩展流式占位名单，也不要等待工具结果后才首次渲染。

### d. `getExecutionSummary`

为工具的执行结果生成一个简洁、信息保真度高的文本摘要。这个摘要将被历史压缩器 (`ToolHistoryCompressor`) 用来替代历史记录中完整的、冗长的工具调用，以节省 Token。

- **规范**:
  - **签名**: `getExecutionSummary?(output: string): string`
  - **输入**: `run` 方法返回的原始 JSON 字符串。
  - **输出**: 一句简短的、人类可读的摘要。
  - **重要**: 如果不实现此方法，系统将使用一个通用的、可能信息量不足的默认摘要。
- **示例**:
  ```typescript
  getExecutionSummary(output: string): string {
    try {
      const parsed = JSON.parse(output);
      const sum = parsed.data.sum;
      return `计算的总和为 ${sum}。`;
    } catch {
      return '计算失败或无法解析结果。';
    }
  }
  ```

## 5. 注册工具

创建完工具类后，先在所属 plugin 的 backend registration 中注册；产品默认 registry 由 [`src/app-hosts/linnya/adapters/tools/toolRegistry.ts`](../app-hosts/linnya/adapters/tools/toolRegistry.ts) 从当前 enabled plugin registrations 惰性收集。`src/tools/index.ts` 只是 concrete tool 的公共导出面及 `getAllToolClasses()` compatibility re-export，不是第二份注册表。

---

## 6. Sheet 工具（语义化接口）

Sheet 工具的约束与规划见：`packages/plugins/sheet/src/backend/tools/README.md`。

注册 owner、启停语义与真实装配链见 [`src/app-hosts/linnya/adapters/tools/README.md`](../app-hosts/linnya/adapters/tools/README.md)。新增工具不得直接修改 Host registry 单例来绕过 plugin enabled 状态。

Linnkit 是可独立复用的 framework，其公开文档只互引 Linnkit 自身协议与接入文档，不反向依赖 Linnya 目录。跨层阅读入口统一由本文和 App Host 文档指向 Linnkit；这不是文档缺链，而是避免通用包持有具体产品语义。

---
