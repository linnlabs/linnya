# Skills

Skill 为已有 Agent 提供按需加载的研究方法、工作流程和文档操作指引。它是版本化资源，不是新的 Agent runtime，也不改变工具白名单、权限或核验状态。

## 发现、加载与资源

`discovery.ts` 合并三个来源，优先级为 builtin > plugin > user；同名低优先级项被忽略。`catalog.ts` 统一查询可用性、读取正文及资源，`availability.ts` 接收 Host 注册的只读可用性规则。

| 来源 | 位置与生命周期 |
| --- | --- |
| 内置 | `builtin/skills/<name>/SKILL.md`，随 Host 发布 |
| 插件 | enabled 插件的 `resources/skills` 或 inline contribution 的 `skillResourceRoots`；启停与升级刷新缓存 |
| 用户 | `getSkillsPath()` 指定的 AppData skills 目录；不是 Workspace 文档目录 |

`builtin/index.ts` 先检查项目根的源码目录，再检查 `dist/builtin-skills`、`dist_build/dist/builtin-skills` 与 Electron resources 下的产物。构建由 `scripts/build/copy-files.js` 复制内置资源。新增目录不需要改注册表，也不能把插件 Skill 复制进 builtin 目录。

开发模式 `LINNYA_DEV_MODE=true` 不缓存发现结果；其他模式元数据缓存 5 分钟，`invalidateSkillCache()` 可主动失效。正文和资源在调用时读取。新名称在已有会话上下文中不保证立即可见，验证发现能力应使用新会话。

Agent 定义通过 `config.skill.enabled` 开启目录披露，且必须具备 `skill` 工具。`agentSkillExposure.ts` 由 `GenericAgentTask` 调用，统一追加目录；不要手改每个 Agent 的系统提示词嵌入 Skill 正文。Agent prompt 点名必需 Skill 时，另声明 `requiredSkills` 并走现有配置校验。

`requiredSkills` 可依赖随 Host 分发的内置 Skill 或当前插件随包资源；不能由用户目录或其他插件碰巧存在的同名 Skill 满足。此依赖校验不执行激活或资源读取。Default 与研究父子职责读取同一份正式内置 `deep-research`，通过普通 Workspace 工具自行保存和回读；Host 不自动推进研究阶段，也不代替作者检查正文。

模型可见的三个层次：

1. 目录只包含名称和描述，供模型判断是否使用。
2. `skill` 的 `activate` 动作返回正文和资源清单，作为普通工具输出进入历史。
3. `read_resource` 按相对路径及可选的 1-based 行窗口读取补充资料；`list_resources` 可重新查询资源。

动作、参数与输出由 [Skill schema](../../../packages/schemas/src/tools/skill.ts) 拥有；[SkillTool](../../tools/skill/SkillTool.ts) 只做接纳、编排和格式化，不自行遍历文件。Skill 资源不通过 VFS 或旧 `resource_read` 读取。

## 内置能力边界

| Skill | 用途 |
| --- | --- |
| [deep-research](./builtin/skills/deep-research/SKILL.md) | 深入研究、证据检验与面向读者的长文；也支持固定材料编辑和研究更新 |
| [mckinsey-research](./builtin/skills/mckinsey-research/SKILL.md) | 既有咨询式商业战略流程；不作为一般深度文章的必经入口 |
| [linnya-markdown](./builtin/skills/linnya-markdown/SKILL.md) | Linnya Annotation 与 `linnya-chart` 图表围栏的操作指引；语法事实仍归 Markdown domain |

`deep-research` 服务报道、财经、时政、评论、学术综述、投研和预测文章。深入研究回答问题、比较解释并交付可追溯的文章；决策支持还需要决策者的目标、约束、备选行动与代价，两者共享证据与建模方法，但不能要求每份研究都填写行动收益表。研究请求不会自动触发决策流程。

该 Skill 复用 Default Agent 的 Web、Knowledge、Workspace 与 Shell 工具，不恢复旧 Deep Research beta，不要求固定多 Agent 编排。入口保留共同研究纪律；文体差异与建模选择按需读取 resources。它不强制统一章节、假设数量、概率分数或资料数量，也不宣称系统已经机械验证推论。

当前正式版本为 1.9，版本覆盖 `SKILL.md` 与同目录资源的完整包。入口保持界定任务、探索资料、检验解释、成文和交付五段循环；涉及原因或机制时实际核查关键竞争解释，描述、概念辨析和作品阐释不强凑因果。研究记录在调查中保存，缺口必须约束成稿。未来观察只在有依据时给数值阈值，不以形式完整诱导假精确。委派需显式交接材料、访问与产物边界，不能假设子任务继承父会话全部约束；这仍是行为指引，不是权限强制。入口不承诺因果识别已被工具保证，也不强制延长运行时间。

写作资料是 Skill 的组成部分，不是额外 Agent 或独立注入模块。成文前先读 [交付目的与写作入口](./builtin/skills/deep-research/references/article-craft.md)，再读 [通用手艺与六种文体目录](./builtin/skills/deep-research/references/writing/index.md) 及适用卡片；不把全部卡片默认塞进上下文。选择取决于调查后的材料、证据、读者与用途；报告式、结论先行与叙事式均为选项。必要背景须在首次依赖它判断前出现，段落以内容推进，避免无增量重讲；示范不是其他题目的来源或统一开结尾模板。激活与读取仍由 Agent 实际调用，不是确定性加载或文笔保证。

资料包细化背景随问题进入、连续段落推进、产业解释中的执行阻力、叙事与作品评论的不同走法，以及按用途收尾；仍保留六卡，不增加选卡工具、必读全卡或固定结尾。自写对照按需读取，不包含订阅全文，也不依赖外部资料库。1.9 针对数字与概念密集的开头：解释卡增加入口写法和第二个虚构示范，报告卡与索引补充口径放置与概念引入时机。资源接入验证不等于已证明成稿质量增益，质量变化需另做真实使用观察。

反馈修订方法实验与写作资源升级分别维护。[Benchmark fixture](../../../apps/linnya-benchmark/fixtures/research-feedback-revision-v1.json) 保留其原有基线与候选差异，不随当前正式版本重写历史对照；本次写作升级不采纳其中的反馈修订候选。新实验须冻结完整副本并核对实际加载，不将用户请求中的同义要求重复塞给各组而抹去被测差异。

`references/modeling.md` 将材料立场、参与者利益、竞争解释与间接线索连接到具体查找任务：先说明候选机制会留下什么可观察记录，再查相关主体、时间线、资金/实物流和制度条件，并保留反证、基准解释与未解环节。立场不等于真假，相关不等于因果；这是一套行为指引，不是已验证的自动发现能力。

深度研究默认交付当前项目的 Markdown 文档，聊天只给摘要与 canonical Workspace 链接；用户明确只要聊天回答时例外。正文与必要的研究记录分开，独立评价在同项目新会话读取指定版本、允许材料和评价标准，另写评审文档，不修改原稿。新会话只隔离对话历史，不自动隐藏同项目文件或实现盲评；正式比较仍需冻结输入、匿名化与 Judge 校准。

`references/business-analysis.md` 吸收旧咨询流程中仍适用的双路径估算、驱动量建模、可比性与综合方法；只在商业任务需要时加载。正文、研究记录和评审之间使用实际 locator 关联，不引入第二套持久化或报告发布通道。

资料取得状态、正文支持程度与计算执行分开记录。引用接纳由 [Citation](../../domains/citation/README.md) 拥有，网页取得状态由 [Web](../../tools/web/README.md) 拥有，写入结果由 [Workspace 工具](../../tools/workspace/README.md) 拥有；Skill 不复制校验器或将自述变成通过状态。

图表语法只有一个 owner：`linnya-markdown` 的 [references/chart.md](./builtin/skills/linnya-markdown/references/chart.md)（字段与规则、八种 canonical 示例、回读与修复），由测试对照真实准入与解析器防止漂移。`deep-research` 的 [references/charts.md](./builtin/skills/deep-research/references/charts.md) 只给“画不画、画哪种、怎样不画错”的研究纪律，不复制 schema 或示例；这是行为指引，不是已验证的作图质量保证。

## 编写与维护

- `SKILL.md` 的 YAML 必须有 `name`、`description`。名称须与目录名一致，为 1—64 字符的小写字母、数字、单连字符；不能以连字符开头或结尾。解析以 `frontmatter.ts` 和 `types.ts` 为准。
- 描述写清触发任务；正文只放改变行动的指引。相关条件细节用 `references/`，不把所有资源默认塞进上下文。
- `allowed-tools` 当前只解析保存，不执行权限变更；`disable-model-invocation` 只影响目录披露，不是访问控制。不要声明未实现的 fork 或脚本执行协议。
- 资源相对路径限制在 Skill 目录，读取上限 512 KB；资源枚举最多 50 个、深度最多 3 层。保持资源精简，超限行为以 `catalog.ts` 为准。
- 自动发现不保证模型激活；加载成功不证明研究质量。更新需分别验证发现/加载、实际工具行为及成稿质量。 版本对照逐条核对作者实际收到的正文与所需资源；历史基线也要复核。未激活、读取失败或只加载部分资源时，保留该运行并标明实际处理范围，不能仅凭发送时的磁盘版本将结果归因于该版本。
- `mckinsey-research` 仍有过期的 `task`、固定十二项分析及批次安排，且其输入清洗可能删除有效网址和材料。它拟退役；保留可用方法，不整体迁移旧执行协议。合法 inode-only 读取本身仍受 Workspace 支持，不应与过期工具混为一谈。

## 验证

现有接入测试：`pnpm exec vitest run src/features/skills/__tests__/agentSkillExposure.test.ts src/features/skills/__tests__/pluginSkillSources.test.ts`。

真实研究调用复用 [Benchmark Runner](../../../apps/linnya-benchmark/README.md) 的 `deep_research_article_v1`，必须指定项目与任务 brief。从工具轨迹确认 Skill 实际激活、所需资源成功读取，并分别核查研究证据、文章解释与交付状态。一次冒烟验证不能证明所有文体的质量增量，比较方法效果仍需同等模型、材料、预算和独立评审。
