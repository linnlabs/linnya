# 12 · 风险与冻结区

> **What** · 当前未关闭的风险、需要单独立项的演进和冻结热路径。已关闭问题由 Git history 保留，不在现行规范中继续维护。
> **When to read** · 排期时、想动冻结区之前、接手不熟悉的子系统之前。
> **Related** · [00 不变量](./00-invariants.md) · [11 测试门禁](./11-testing-gates.md)

---

## 1. 当前技术风险

| ID | 风险 | 等级 | 现状与把守方式 |
|---|---|---|---|
| R-10 | **双投影实现漂移**：后端 durable projector 与前端 `reduceEvent` 变更时可能只改一边 | 低（原为中） | parity fixture 同 PR 强制（[INV-52](./00-invariants.md#inv-52--parity-fixture-同-pr-锁一致)）；AST 覆盖门要求每个正式 RuntimeEvent 进入 fixture 或登记非 UI owner 与理由。两套实现仍故意独立以避免共享 bug，因此风险降低但不归零 |
| R-11 | **window / reload 或业务编排绕过正式投影边界写入 `conversation.messages`** | 低（原为高） | [INV-01](./00-invariants.md#inv-01--runtimeevent-是唯一事实源) 规定 MessageProjection reducer 工作区与 projection commit 是仅有合法边界。直接属性写入已由 `guard:conversation-messages-write` AST 静态拦截；别名与跨函数传递仍需评审把守（见 §5） |
| R-12 | **Markdown 扩展层边界**：`ConversationMarkdownRenderer.ts` 中的 legacy reference 与宽 AST 回退 | 中 | 必须继续使用统一流式 parser（[INV-22](./00-invariants.md#inv-22--markdown-只有一个解析入口)）。位于冻结热路径，需可复现问题驱动才能单独定性 |
| R-13 | **`types/` → `definitions/` 迁移未完成**：`types/index.ts` 仍是过宽出口 | 中（扩张面已关闭） | AST 棘轮锁定现有公开符号集合，只允许随 domain/feature 迁移而减少，新增、改名与 `export *` 立即失败；存量仍需按职责迁移并最终删除该出口。**不保留为永久中转层** |
| R-14 | **Annotation 跨域入口**：`AnnotationPanel → assistantStore.executeAnnotationRun → annotationRunOrchestrator` 仍经过 Conversation store | 低 | 执行态已按 conversation 收窄。应以 app-level orchestration 或窄 port 收敛，**不复制第二条入口** |
| R-18 | **存量注释型空 catch**：部分是合法可忽略解析，部分缺乏可观察性 | 低 | 不按数量做全仓清零；按 domain 失败语义治理。优先删除仅服务 debug 二次解析的分支；新增 catch 必须写明为何可忽略 |
| R-25 | **历史 `#ref` 与 Markdown 批注语法仍带有 Markdown 特殊化** | 中 | 本期文件 locator 链接不依赖它。历史回答继续只读兼容；新批注语法、`#ref` 退役和上下文说明清理必须单独设计，不能迁移成 node URI 或夹带进文件导航 |
| R-26 | **MindMap 研究/假设/evidence 专用链仍待整体退役** | 中 | MindMap 后续回归纯文本思维导图，按产品专项成组删除；引用整份文件已使用 `workspace:/path`，不建设 `node_uri` 过渡层 |
| R-27 | **普通 Web/未知协议仍使用旧 Markdown 外链分支** | 中 | 文件链接 feature 只接管三类正式 locator。`http/https` 的受控系统浏览器打开与危险/未知协议禁用需要独立安全改造和真机门禁，不扩成万能 URI router |
| R-28 | **Workspace node type 类型联合与插件注册事实仍可能漂移** | 低 | 文件链接运行时由插件 registry 判定 opener，未注册或停用类型明确 unavailable；共享 `WorkspaceVfsNodeType` 未完整表达所有插件贡献的存量问题应由插件合同专项收敛，不能在 Conversation 中硬编码后缀 |
| R-29 | **`openFileByPath` 只有 Renderer 类型声明，没有 preload/main 实现** | 低 | 本期没有消费这条 ghost API，而是新增 locator-scoped reveal 并限定为文件管理器定位。后续应单独删除无实现声明；若产品确实需要启动默认程序，必须重新定义文件类型与权限合同，不能复活 raw-path 入口 |
| R-31 | **压缩摘要承载不可信历史的提示注入残余风险** | 中 | 压缩请求禁用工具，使用固定 system 指令和带 `trust="untrusted-memory"` 的固定格式；输出必须通过结构校验，摘要事实保留替换来源 ID。第一版统一使用 system-role 摘要，不按 Provider 分叉；这能降低但不能消除模型把网页/工具输出中的恶意指令带入摘要的风险。需要继续用真实长任务与审计观察，不得用正则过滤冒充安全边界 |
| R-32 | **压缩后长 run 更容易耗尽单一 `maxSteps`** | 中 | 旧 checkpoint 工具曾隐式重置步数预算，现已成组删除；上下文容量与步数预算重新分离。compaction 让 run 能在同一上下文窗口内继续更久，因此可能更接近 `maxSteps`。只通过 run 终态的 `steps used / max steps + terminal reason` 观测；是否调整 `maxSteps` 必须基于真实任务数据另行决策，不能让 compaction 顺带放宽 |

### R-33：启动 read model 重建失败尚无用户可见的失败状态

`src/electron-main/services/conversation/conversation-maintenance.ts` 当前只重建 missing/pending 会话。
某个会话重建抛错时，外层 catch 记录日志并结束本轮循环，后续候选不会继续处理；失败会话也没有
可供历史窗口查询的结构化失败状态，因此可能持续显示准备中。严格事件 codec 和 UI row 校验仍然有效，
但不等于启动维护失败已经被用户界面完整接纳。

后续治理应围绕单会话重建的失败隔离、可查询状态和用户重试流程设计，使用真实坏事实与多个待重建会话验证。
不通过吞掉非法事件、伪造空历史或增加启动期全库扫描来替代这条失败状态链路。

---

## 2. 冻结区

**三档规则：除非有可复现 bug + 真机验证，否则不动。**

| 文件 | 为什么冻结 |
|---|---|
| `ui/conversationView/utils/contentHeightEstimator.ts` | 虚拟化估高热路径。含跨包深引（属结构债），但位于尺寸估算热路径 |
| `ui/conversationView/logic/ConversationMarkdownRenderer.ts` 的 `renderNode` 与流式节流 watch | 渲染主路径 |
| `features/timeline/` 的滚动 / 定位链路（`navigateToTimelineVisualTurn` / `waitForTimelineVisualTurnMounted`） | 逻辑清晰，**只允许增加错误上报** |
| `shared/virtualization/vueVirtualizerScrollBridge.ts` | 虚拟化桥接热路径 |

改动规则：

```text
无可复现 bug → 不改
有可复现 bug → 单变量修改 + Electron 真机门禁
```

> 教训 3：只换引擎不换 UI——headless 库负责滚动数学，宿主几何归集成方，这一分工必须被尊重。
>
> 教训 6：库的扩展点语义要读源码核实（如 TanStack 的 `shouldAdjustScrollPositionOnItemSizeChange` 是实例属性，options 传入会被静默忽略）。

---

## 3. 需单独立项的架构演进

以下方向**需要单独设计、单独验收，不在日常修改中夹带**：

| 立项 | 收编范围 | 约束 |
|---|---|---|
| 状态与职责所有权收敛 | store 中的异步编排、多写入方、双事实源，以及仍需从 SFC / composable 下沉的业务规则 | 按业务流程逐项立项，先建立唯一所有者与端到端门禁 |
| `types/` → `definitions/` 迁移（R-13） | 过宽出口及其调用方 | 禁止新增定义；按职责迁移后删除 |
| Evidence Agent facade 退出评估 | 真实研究任务中的引用正确率、全文可达性和跨 subrun 成功率 | Workspace/Citation/ToolOutput 迁移已完成；仅按 [Evidence owner 文档](../../src/domains/evidence/README.md) 的退出条件决定是否删除 `evidence_resolve` |
| Markdown `#ref` / 批注协议退役 | 历史只读兼容、上下文投影、新批注表达和 Skill 说明 | 不迁移成 node URI；等批注真实用例与历史兼容边界确定后单独实施 |
| MindMap 研究链退役 | 研究、假设、evidence、专用 subrun 与节点工具 | 成组删除并回归纯思维导图，不为待删除能力建设过渡协议 |
| 冻结热路径优化 | 见 §3 | 无可复现 bug 不改；单变量 + 真机门禁 |
| `store/executionState.ts` 归属收敛 | 尚未迁移的 application contributed use case 执行态 | 正文禁止写入；迁移后删除 |

---

## 4. 维护原则

以下原则是判断当前决策是否走错方向的检测器，不记录其形成过程。

### 4.1 关于修补形状

1. **逐层补时序的修补形状（修一层显一层）本身就是"应换成熟方案"的信号**，应更早识别。
2. **同一路径失败两次后不要继续微调**——诊断根因，换方案。

### 4.2 关于测试与放行

3. **合成 gate 全绿 ≠ 生产可用**（见 [11 §1.1](./11-testing-gates.md) 的真实反例）。
4. **测试装配不能拥有另一套协议**：旁路可用不能证明生产主链正确。
5. **提交纪律**：每工单绿灯立即提交，避免堆积未提交改动放大回退成本。

### 4.3 关于身份与作用域

6. **局部消息为空不代表新会话**：历史窗口与 live 投影物理分槽，任何"第一条 live 消息"判断都不能承担会话生命周期语义。
7. **局部 ID 不能提升为 conversation 身份**：两个并发 run 可以出现相同 `turn_id / tool_call_id`；`answer_id` 全局唯一，但答案状态仍必须携带完整运行归属。
8. **command identity 不是乐观消息**：预分配 ID 只为跨边界关联，不授权本地创建同 ID 的事实。
9. **committed fact 不能由客户端补造**。

### 4.4 关于生命周期所有权

10. **可见页面不是运行态 owner**：用侧栏切换 / loading 壳 / 虚拟列表重建 cleanup reducer，会把正确身份变成"只剩 seal、没有 chunk 前缀"的**假协议错误**；修复应保留 owner 状态，**不能放宽 seal 校验**。
11. **store 常驻不能推导出组件常驻**：后台事件需要保留的是按 conversation 分区的 reducer 与 pending commit，**不是隐藏的 Host DOM**。
12. **死代码不能"继续调参"**：退役即成组删除，不留"仍被消费"的错觉。
13. **移动代码 ≠ 解耦**：以 import 边界 + 单一状态源为准，不以文件位置为准。

### 4.5 关于启发式与静默失败

14. **依赖"列表形态变化"反推"用户意图"的启发式在窗口化数据源下必然误判**（如"末条是 user 就回底"）——产品意图必须由动作编排显式声明。
15. **空 `catch {}` 静默吞异常是掩盖 bug 的元凶**：捕获处必须打真实错误上下文。
16. **metadata 不是控制面**：删除它不得改变事件归属、答案拼接、run 终态或写入目标。

---

## 5. 自动化防护仍有缺口的面

诚实记录：以下不变量尚未被 guard 或测试完整覆盖。

| 不变量 | 缺口 |
|---|---|
| [INV-01](./00-invariants.md#inv-01--runtimeevent-是唯一事实源) 禁止绕过正式投影边界写 `conversation.messages` | **部分自动化**：直接属性写入由 `guard:conversation-messages-write` 拦截；别名与跨函数传递仍需评审（见 [11 §2.4](./11-testing-gates.md)） |
| [INV-16](./00-invariants.md#inv-16--metadata-不是控制面) metadata 不作控制面 | **部分自动化**：`guard:conversation-agent-control-plane` 已拦 `metadata.promptKey` 与 agent-choice contribution `promptKey`；未来其它 metadata 字段是否构成控制面仍需按 owner schema 与业务语义评审 |
| [INV-09](./00-invariants.md#inv-09--答案消息身份从首块起固定) / [INV-10](./00-invariants.md#inv-10--局部-id-必须带-scope) / [INV-11](./00-invariants.md#inv-11--tool-ui-身份不属于单个事件) 身份不可混用 | **部分自动化**：`RunId + ToolCallId` 已 brand 化且 assertion guard 禁止断言逃逸；尚未 brand 的身份继续依赖 strict schema、派生函数与业务测试，按 [INV-58](./00-invariants.md#inv-58--runtime-身份在-admission-后必须保持名义类型) 的风险停止点推进 |
| [INV-17](./00-invariants.md#inv-17--strict-schema-必须在真实边界执行) 协议失败不能破坏 Renderer | 工具与非工具消息均已把 admission 移出 Vue reactive effect；AST guard 覆盖 Conversation 生产 `.vue + .ts` 及同步本地调用，跨文件调用仍依赖输入类型与评审 |
| [INV-56](./00-invariants.md#inv-56--工具展示派生只有三个-admission-入口) 工具展示只在 live/reload/Subrun admission 派生 | **自动化覆盖已知注册面**：baseline 内实体卡与 header-only 注册项由 `guard:conversation-tool-presentation` 锁住；Subrun 额外用业务测试锁定 detached snapshot 原子接纳。新增工具仍须显式加入清单，未知插件工具由 registry 集成评审把守 |
| [INV-51](./00-invariants.md#inv-51--导航时序回归必须真机) 真机门禁必跑 | 依赖人工执行，未接入 CI 强制 |
| 冻结区改动纪律 | 无 CODEOWNERS 级拦截 |

**R-11 的改进已落地**：`scripts/guards/conversation-messages-write-guard.ts` 用 TypeScript AST（非正则）检测生产代码对 `conversation.messages` 的赋值、变异方法与 `length` 截断。允许范围只有 `services/messageProjection/**` 的隔离 reducer 工作区与 `services/orchestration/projectionCommitPipeline.ts` 的 Vue live-slot commit，由 `conversation-messages-write-allowlist.ts` 按语义维护；测试夹具整体排除，不接受把业务文件加入零散白名单。

因此 R-11 的风险等级由**高**降为**低**。残余风险是：guard 只覆盖 Conversation 域内的直接属性写入，无法判定先取出数组别名或经函数参数继续传递后的间接写入；该限制不依赖 `any`，即使类型完整也存在。

**R-10 的改进已落地**：`uiProjectionParityCoverage.test.ts` 维护 Linnya 对 npm 包公共 `RuntimeEvent` 类型的完整接纳清单；Linnkit 增删事件后，TypeScript 类型检查会要求同步更新清单，语义测试再要求每个已接纳事件进入 fixture 或登记为非 UI 事件。它不再读取 Linnkit 仓内未发布的 TypeScript 源文件。残余风险是当前仓库的全量类型检查仍有既存错误，因而升级 Linnkit 时必须先单独确认该文件通过类型检查；两套投影在 fixture 未表达的业务分支上也仍可能产生差异，必须继续维护业务场景，不能退化为字段快照。
