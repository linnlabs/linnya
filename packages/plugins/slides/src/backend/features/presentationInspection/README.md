# Presentation Inspection

`presentationInspection` 是 Slides backend 的共享只读检查能力。它让 Agent 工具和人/CI CLI 从同一份 presentation 版本快照派生 finding 事实，不在不同入口重复页选择、quality 或 geometry 规则。

Slides 只有三个用户可理解的观察面：`read_file` 读取当前 `deck.js` 原文和页面组织；`inspect` 说明哪些最终布局事实值得复核；`render` 展示最终像素。inspection 不复制源码，也不以机器规则替代视觉判断。

## 目录职责

```text
presentationInspection/
├── definitions/     # inspection 结果与完整 finding feedback 合同
├── functions/       # 页选择、截断和 deck.js source location 映射
└── orchestration/   # 版本快照、feedback 构建与结果编排
```

## 数据流

```text
PptCoordinator.inspectPresentation
  -> presentationQueryRuntime.getRenderModelSnapshot
  -> 页选择与可选数量上限
  -> generated deck source location
  -> tools/inspectFeedback 的 buildStatus + findings + 可选源码聚焦关系
  -> PresentationInspectionResult
```

`versionId` 必须取自 snapshot 中的真实 repository version ID，不能用数字版次 `renderModel.version` 代替。数字版次只适合展示和排序，不能承担 artifact 身份。

## Agent 投影与工具结果

inspect 先按完整 evidence 去重，再生成两种有证据的根因组：quality 明确提供的约束 `rootCauseKey`；以及至少两个 finding 指向完全相同作者源码范围的 `shared_source` 组。后者表示同一作者控制点可以一次修复多处后果，不会用“同页、同父节点、同 code”或相似文案猜根因；页级与不可用位置也不参与共享源码归组。

源码定位只有一个概念：**作者应修改的 `deck.js` 位置**。`DiagnosticSourceRef.kind` 只说明该位置与最终节点的关系，不再同时暴露“工厂位置”和“实例位置”：

| kind | 含义 |
| --- | --- |
| `direct_creation` | 该范围在完整文稿快照中只创建当前一个最终节点 |
| `shared_creation` | 该范围由循环或复用逻辑创建多个最终节点；`generatedNodeCount` 给出数量 |
| `slide` | 只能可靠定位到当前页的创建范围 |
| `unavailable` | 当前 source kind 或身份无法提供 `deck.js` 位置 |

`focus` 是已有 inspection 的窄查询，不是第二套诊断器。调用方最多提供四个 1-based、闭区间源码范围；inspection 以 source span 相交选择最终节点，并且每页、每对范围只返回最近的一对节点。关系分别报告横向与纵向的 `gap` 或 `overlap` 英寸值，不生成全页距离矩阵，也不猜测设计上“应该”相距多少。Agent 用 `ppt_inspect.focus`，CLI 使用可重复的 `--source-range start:end`，二者消费同一结果事实。

observation 对节点与源码建立本地 handle，同一源码控制点只声明一次；finding 再按统一派生的 P0/P1/P2 排序。P0 是高置信且明确需要修复的问题，P1 先复核 fidelity，P2 结合 render 判断设计意图。每个唯一 finding 仍保留 code、置信度、证据、行动目标和复验方式；不会按页静默截取前几条，也不会打印完整内部 JSON。完整问题合同与分级规则由 [quality definitions](../../engine/quality/definitions/README.md) 拥有。

图表检查也遵守同一合同：`chart_identity_missing` 与 `chart_label_capacity_exceeded` 只投影图表节点、类别/系列数量、可见标签通道和容量比，不输出 series values。它们属于 P1，Agent 应先看 render 再调整图例、标签、尺寸或字号；inspection 不根据标题猜图表是否构成真正的价值桥、瀑布或其他业务语义。

文本检查同样只消费 backend finalized layout。`text_single_glyph_last_line` 只在非显式换行的段落被自动断行、且末行只剩一个字素时产生 P1；`text_decoration_collision` 只在细装饰 Shape 穿过最终文字行的真实占位区域时产生，不拿整个文本框冒充文字区域。表格通过 `cell=rows[row][column]` 定位到源码数组。inspection 不重测字宽，不把规则升级成溢出，也不修改原文。

最终文本布局的 finding 还投影 `advance=harfbuzz/pretext/heuristic`，便于识别测量来源。`text_overflow_risk` 的置信度由 quality 按该来源决定：真实字体测量为 P0，启发式为 P1；Agent 与 CLI 共用这一分级，不能仅因 `basis=finalized` 就提升置信度。只有旧 imported 盒估算的 finding 不提供 advance 来源。

reference frame 只报告在当前文稿物理尺寸下仍为正面积的事实。`slide` 始终存在；固定物理边距推导出的
`safe_area` 或 `content_area` 在 1 英寸等极端合法画布上失效时直接省略，不能输出零/负尺寸，也不能为了凑齐字段伪造相对边距。

`PptInspectTool` 的成功结果与 Conversation 工具消息结果都由
[Slides shared strict contract](../../../shared/pptInspectToolContract.ts) 约束：

- `data` 只保存 artifact/version、文稿名称、页选择、轻量卡片页摘要、`ready` 状态和 raw/unique/root/P0/P1/P2 计数；不保存 finding、scene graph、背景明细、editable target 明细或源码；
- `observation` 是唯一模型可见的完整检查正文；
- `observationPreviewMeta` 只命名文稿并标记 `slides/inspection`，由 ToolNode 交给超长输出预览端口消费；
- backend producer parse 执行期 `PptInspectToolResultSchema`；Conversation 持久化后只保留 `data + observation`，Renderer projector parse 同一 owner 中的 `PptInspectToolMessageResultSchema`；两者复用完全相同的 data/observation schema，不维护兼容读取分支。

当 observation 超过通用字符或行预算时，ToolNode 把全文交给 ToolOutputStore，模型收到可续读预览。blob 身份只属于通用 `tool_output.metadata.observationTruncation`；Slides data 不复制 blob、cursor 或截断正文。通用执行规则见 [Linnkit Tool 开发规范](https://github.com/linnlabs/linnkit/blob/main/docs/integration/tool-development-guide.md)。

## 边界

- 该 feature 只编排已有事实，不定义新的视觉诊断规则。
- `PptInspectTool` 只负责严格参数 admission、Agent observation 和最小 UI data 投影；CLI 只负责参数与机器输出合同。
- `presentation_id / locator / inode` 必须且只能提供一个非空值。未知字段、空 selector、非法页范围和非法 `focus` 在 ToolNode 执行开始前拒绝；`focus` 最多四个正整数闭区间，`heuristics` 可直接作为 inspect 的 Tier-2 开关；开发环境不保留旧字段兼容。
- 成功取得同一版本的 RenderModel 后 `buildStatus.state = ready`；visual findings 不得把它改成失败。未解决 draft 或无法构建的情况在进入 inspection 前由稳定 build-failure code 返回。
- CLI inspect 必须原样保留 Agent inspection finding 的置信度、意图上下文、源码位置、空间关系和建议，禁止另建降维诊断 DTO。
- Agent 与 CLI 必须复用同一个 diagnostic projection；CLI 的 `priority`、`findingSummary` 和 `rootGroups` 只是该投影的机器序列化，不能另写分级或归组规则。
- generated deck 的 source location 来自 codegen structure；imported/patched deck 没有 `deck.js` 位置。
- legacy generated deck 没有可用 source 时不伪造位置；其他 codegen 错误继续抛出。
- 页选择允许得到空结果，保持 inspect 查询语义；截图 render 的越界失败规则归 `presentationScreenshot`。
- CLI 的完整机器报告与 Agent 的低 token observation 都投影同一份 finding；边界见 [presentationCli](../presentationCli/README.md)。

## 测试

- 共享编排：`orchestration/PresentationInspectionRuntime.test.ts`
- Agent 工具适配：`backend/tools/presentationTools.test.ts`
- 参数/result contract：`shared/pptInspectToolContract.test.ts`
- ToolNode admission：`backend/tools/PptInspectTool.toolNode.test.ts`
- 超长 observation 续读：`backend/tools/PptInspectTool.toolOutputStore.integration.test.ts`
- observation 格式：`functions/buildInspectionObservation.test.ts`
- 源码聚焦与紧凑几何：`backend/tools/inspectFeedback/focusedInspection.test.ts`
