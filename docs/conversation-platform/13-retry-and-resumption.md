# 13 · 模型重试、任务暂停与继续

> **What** · 统一解释一次模型请求重试、整个任务暂停恢复、交互等待和真正终止之间的关系。
> **When to read** · 排查“为什么没有重试”“还能不能继续”“是否必须新发消息”，或修改相关 Provider、Host、CLI、Renderer 行为之前。
> **Related** · [身份](./01-identity.md) · [错误与重试通知](./05-live-projection.md#34-运行错误与重试是持久时间线通知) · [生命周期](./08-lifecycle.md) · [子运行](./10-subruns.md)

本文是跨 owner 的产品行为入口，不建立新的执行模块。具体 failure schema、预算配置、恢复输入与副作用合同仍由下文链接的 owner 维护。

## 1. 先区分四种动作

**不可自动重试，表示本次模型调用不再自行重发；不表示整个任务已终止。**

| 动作 | 处理对象 | 是否产生用户消息 | 身份和预算 |
| --- | --- | --- | --- |
| 自动重试 | 当前 LLM 调用 | 否 | 同一调用内产生新的 Provider attempt，受该次重试预算约束 |
| 暂停后继续 | 已收口的原任务 | 否 | 保留 `run_id / turn_id`，创建新 `execution_id`，保留累计步数 |
| 交互响应 | 正在等待的具体问卷或交互 | 提交正式 interaction response，不伪装成普通输入 | 原 run、新 execution，验证原 interaction 身份 |
| 发送新消息 | 新一轮用户请求 | 是 | 新 turn、新 run；接纳时可以原子替代旧暂停任务 |

模型响应已经断开时不能接回原来的网络 token 流。恢复从最后提交的执行边界继续，必要时重新请求模型。

## 2. 当前行为矩阵

下表描述已经装配持久恢复能力的生产 foreground run；缺少恢复描述的旧历史或非持久测试接入不据此获得恢复能力。

| 情况 | 当前系统行为 | 下一步 |
| --- | --- | --- |
| 传输失败、已识别的限流或其他可重试模型错误 | 在当前 LLM 调用内有限等待并重试，期间任务保持执行状态 | 通常无需操作 |
| 自动重试耗尽 | 结束当前 execution，通常保留原任务为 `paused` | 收口后显式继续原 run |
| 通用 HTTP400、鉴权或协议等不可自动重试错误 | 跳过自动重试；尚未终态的持久任务通常仍保存为 `paused` | 先判断原因是否已解决，再继续；可以恢复不代表原样重发会成功 |
| 单次模型输出触及长度上限 | 作为不完整输出报错，不按普通完整回答交付；持久任务通常暂停 | 检查输出与模型限制，不能把“继续”当作无限输出续传 |
| 普通工具返回业务失败 | 工具结果进入后续模型处理；不直接等同 run 失败 | 模型可改参数或调整方法；连续协议错误等熔断另行暂停 |
| 用户请求暂停 | 先保存暂停意图、中断 attempt并收口资源，再落已收口 `paused` | 输入框为空时点击恢复 |
| 等待问卷等 HITL | 保持 `awaiting_user`，普通恢复禁用 | 在原交互提交回答 |
| Shell 命令等待审批 | 由 Commands owner持有审批，不据此伪造 HITL 或暂停状态 | 回复原审批请求；CLI 与前端使用同一审批身份 |
| 已结算 `completed / failed / cancelled` | 原 run已终止，释放恢复资源 | 如需继续工作，发送新消息 |
| SSE、观察客户端或页面断开 | 只影响订阅，不自行决定后台 run终态 | 查询精确 run状态；不要直接重复 send或 continue |

累计步数上限是整个逻辑 run的硬边界，恢复不清零。当前 Graph在步数耗尽时发布 `engine.budget_exhausted` 并强制结束；Host的正常返回路径可将其结算为 `completed`。因此 `completed` 是执行生命周期事实，不是任务目标或交付质量的验收结论。

### 2.1 错误事实不能代替控制状态

Provider failure的 `retryable` 决定当前模型请求能否进入自动重试；RunRegistry的状态决定原任务还能否继续。不能从一条红色错误通知、`retryable=false`、某个 HTTP状态或重试次数反推 run已经 `failed`。

生产持久链路的 [AgentRunner](../../src/app-hosts/linnya/adapters/flow/flow.agent-runner.service.ts) 在异常后，若原记录尚非终态，会收口 Commands、等待持久化、保留最后提交的 checkpoint并标记暂停。这条分支不使用 Provider的 `retryable` 决定是否保留任务。

暂停原因使用 Host的固定原因或框架稳定错误码，例如 `user_pause`、`tool_reconciliation_required`；无法进一步分类的异常可投影为 `execution_interrupted`。它不是完整 Provider错误说明，也不能单凭该值认定网络故障。原始 Provider正文、凭据或堆栈不进入控制面；安全诊断边界见 [Inference Adapter](../../src/app-hosts/linnya/adapters/inference/README.md)。

## 3. 自动重试的唯一执行者

调用链为：Provider SDK解码失败 → AI SDK adapter投影 canonical failure → Linnkit LLM caller按分类和预算重试 → 耗尽或不可重试后交给 Host结算。

- Provider SDK保持零自动重试，避免和 Linnkit叠加。
- adapter负责失败类型、稳定错误码、`retryable` 和重试类别，不拥有等待或循环。
- Linnkit拥有重试次数、等待、取消、失败 attempt输出撤回，以及已允许的切模策略。
- Linnya的 `createDefaultLlmCaller()` 只装配产品默认预算；root和 child共用该入口。

当前默认是传输类最多重试6次，输出损坏、限流和其他可重试错误各最多3次；首次请求不算重试。完整等待序列、混合错误和切模总上限的唯一详细说明在 [Runtime Assembly](../../src/app-hosts/linnya/adapters/runtime-assembly/README.md#llm-重试策略)，配置实现在 [graphRuntimeFactory.ts](../../src/app-hosts/linnya/adapters/runtime-assembly/graphRuntimeFactory.ts)。

这些预算仅适用于已允许客户端重试的调用。调用显式禁用、模型配置禁用或云计费等限制仍由框架准入；不能为了补足次数绕过不可重试分类。HTTP状态、SDK类型和已解码信号的规则由 [failure-projection](../../packages/linnkit-provider-ai-sdk/src/features/failure-projection/README.md) 持有，通用 HTTP400当前不自动重试。

重试预算属于一次模型调用；恢复后重新进入模型调用时重新计算该调用的重试机会，但不重置原 run累计步数。产品没有“某类400等待固定时间后自动恢复若干次”的通用规则；外部调用方的恢复策略必须显式区分，不得冒充框架自动重试。

## 4. 暂停后继续的正式合同

前端恢复和 CLI `resume` 进入同一 Host `continueRun` 主链：

1. 读取精确 foreground root的已收口暂停状态。
2. 验证原 run、execution和更新时间，防止重复或过期激活。
3. 加载原 descriptor、输入和 checkpoint，验证运行能力兼容。
4. 保留原 Agent、模型、权限和初始系统输入，创建新的 execution，续行原执行位置。

继续不重新构建用户消息，不重新选默认 Agent或模型，也不因重启重新加载最新提示词替换原输入。没有原恢复资料、能力不兼容或副作用尚待核实时，恢复可以被拒绝；不能从聊天历史猜造断点。

### 4.1 工具和子任务

| 已保存的事实 | 恢复行为 |
| --- | --- |
| 模型请求中断或工具尚未开始 | 从最后提交位置重新尝试 |
| 工具结果已有可靠 receipt | 读取已保存结果，不重复执行 |
| child尚未完成 | 由父级 Host按原委派身份恢复同一 child |
| child完成、父级尚未提交交接 | 读取原 child结果，不重跑 |
| Shell、插件或外部写入的效果未知 | 由实际 owner对账；无可靠凭据就阻止恢复 |

这不是对所有外部效果的通用“恰好一次”承诺。纯读取允许重读当前内容，不保证外部网页或文件仍是旧版本。完整支持范围由 [run-resumption](../../src/app-hosts/linnya/application/run-resumption/README.md) 维护；不能为了继续而重放未知命令、自动批准或覆盖用户后续编辑。

### 4.2 按钮、CLI和网络边界

- 输入框为空：运行中显示暂停，已收口 `paused` 显示恢复；`pausing`等过渡态禁用，`awaiting_user`通过原交互回答。
- 有可发送草稿：按钮表达发送意图。只有新请求成功接纳后才替代旧暂停任务；编辑草稿本身不取消旧任务。
- CLI `resume`恢复精确原 root，`respond`提交 HITL，`approval-reply`回复 Commands审批，`stop`执行明确取消。四者不能互换。
- 恢复请求回执未知时，先查精确状态和新的 execution，不能直接再次提交。SSE断开不证明执行未接纳。
- Backend重启重建控制状态后等待显式恢复，不自动发出模型或工具请求。

Renderer的 `reconnecting` 或本地请求失败不是 durable RunRegistry终态。结算查询失败时保留身份并重连；服务端确认无可用 run与服务端确认 `failed`也应分别理解。错误/重试的历史显示见 [05 §3.4](./05-live-projection.md#34-运行错误与重试是持久时间线通知)，控件行为见 [interactive-run](../../apps/renderer/domains/conversation/features/interactive-run/README.md)，命令用法见 [CLI](../../apps/linnya-cli/README.md)。

## 5. 为什么代码保持分离

按业务责任内聚，不按目录距离内聚。自动重试解决一次模型调用；持久恢复解决整个产品任务，两者的输入、生命周期和变更原因不同。

| owner | 拥有的判断 | 不应承担的责任 |
| --- | --- | --- |
| AI SDK failure projection | 失败类型、稳定码、自动重试资格 | 任务断点、UI按钮、恢复次数 |
| Linnkit LLM caller | 有限重试、等待、取消、attempt输出清理 | Linnya数据库、Workspace与页面控制 |
| Runtime Assembly | root/child默认 caller配置 | 第二套重试循环或 Provider解析 |
| run-resumption与 Flow | 原输入、恢复准入、checkpoint与副作用交接 | 重写 SDK或 Provider重试分类 |
| AgentRunner / execution-settlement | 持久中断暂停，以及成功/失败/取消的结算 | 在异常 catch中另建网络重试器 |
| Renderer / CLI | 展示、精确控制命令与结果对账 | 从错误通知猜生命周期，或绕过 Host接纳 |

各 owner通过 canonical failure、RuntimeEvent、RunHandle、checkpoint和正式控制命令协作。新建全局恢复 manager、把 Provider与持久化塞进同一目录，或让 UI决定重试资格，都会扩大耦合。

当前还有一处必须明确的职责细分：[execution-settlement](../../src/app-hosts/linnya/adapters/flow/execution-settlement/README.md) 结算正常返回、等待交互以及 `failed / cancelled`；durable执行异常到 `paused`的保留路径仍由 AgentRunner编排。不能把前者的“唯一结算入口”泛化为已覆盖所有暂停路径。是否进一步收口这段编排，应以重复规则、生命周期缺陷或新增用例为依据，不以目录距离为依据。

## 6. 修改与验证地图

| 要修改什么 | 先读 / 修改 owner | 相关业务验证 |
| --- | --- | --- |
| 某个错误能否自动重试 | [failure-projection](../../packages/linnkit-provider-ai-sdk/src/features/failure-projection/README.md)、[Inference Adapter](../../src/app-hosts/linnya/adapters/inference/README.md) | 真实 SDK错误形状 → canonical failure → caller次数与取消 |
| 默认次数与等待策略 | [Runtime Assembly](../../src/app-hosts/linnya/adapters/runtime-assembly/README.md)；通用算法在正式 Linnkit | `defaultLlmCaller.retry.integration.test.ts` |
| 异常后暂停、终态与清理 | [execution-settlement](../../src/app-hosts/linnya/adapters/flow/execution-settlement/README.md)、[AgentRunner](../../src/app-hosts/linnya/adapters/flow/flow.agent-runner.service.ts) | `flow.protocol-fuse-settlement.integration.test.ts`、终态资源释放测试 |
| 原任务恢复、工具/child复用 | [run-resumption](../../src/app-hosts/linnya/application/run-resumption/README.md) | SQLite持久继续、崩溃、取消与未知副作用测试 |
| 按钮或 CLI恢复行为 | [interactive-run](../../apps/renderer/domains/conversation/features/interactive-run/README.md)、[conversation-control](../../src/app-hosts/linnya/application/conversation-control/README.md) | 按钮状态、exact fence、恢复与新发送互斥 |

不以 README快照代替业务测试。只改文档时检查事实、链接和公共边界；改变执行行为时，再按 owner运行对应的最小真实门禁。框架修改遵循独立发布与产品升级流程，不从相邻源码 checkout直接接入。
