# Skills

Skill 为已有 Agent 提供按需加载的研究方法、工作流程和文档操作指引。它是普通文件指引，不是新的 Agent runtime，也不改变工具白名单或核验状态。内置与插件资源随各自发布；用户目录只保存当前内容，不维护历史或回退。

## 发现、加载与资源

`discovery.ts` 合并三个来源，优先级为 builtin > plugin > user；同名低优先级项被忽略。`catalog.ts` 统一查询可用性、读取正文及资源，`availability.ts` 接收 Host 注册的只读可用性规则。

| 来源 | 位置与生命周期 |
| --- | --- |
| 内置 | `builtin/skills/<name>/SKILL.md`，随 Host 发布 |
| 插件 | enabled 插件的 `resources/skills` 或 inline contribution 的 `skillResourceRoots`；启停与升级刷新缓存 |
| 用户 | `getSkillsPath()` 指定的 AppData skills 目录；不是 Workspace 文档目录 |

`builtin/index.ts` 先检查项目根的源码目录，再检查 `dist/builtin-skills`、`dist_build/dist/builtin-skills` 与 Electron resources 下的产物。构建由 `scripts/build/copy-files.js` 复制内置资源。新增目录不需要改注册表，也不能把插件 Skill 复制进 builtin 目录。

开发模式 `LINNYA_DEV_MODE=true` 不缓存发现结果；其他模式内置/插件元数据缓存 5 分钟，用户来源每次重新解析以接纳外部编辑，`invalidateSkillCache()` 可主动失效。目录查询对支持文件只做 readdir/lstat 检查（类型、数量、深度、单文件大小，见 `inspectSkillFiles`），不读取内容，代价与 Skill 体积无关；只有入口文件会被读取和解析。运行兼容性摘要对支持文件使用宽松解码（`readSkillTextLossy`，合法 UTF-8 与严格解码逐字符一致，既有摘要不变），非法字节的支持文件不会让新运行无法接纳。正文和资源在调用时读取。新名称在已有会话上下文中不保证立即可见，验证发现能力应使用新会话。

Agent 定义通过 `config.skill.enabled` 开启目录披露，且必须具备 `skill` 工具。`agentSkillExposure.ts` 由 `GenericAgentTask` 调用，统一追加目录；不要手改每个 Agent 的系统提示词嵌入 Skill 正文。Agent prompt 点名必需 Skill 时，另声明 `requiredSkills` 并走现有配置校验。

`requiredSkills` 可依赖随 Host 分发的内置 Skill 或当前插件随包资源；不能由用户目录或其他插件碰巧存在的同名 Skill 满足。此依赖校验不执行激活或资源读取。Default 与研究父子职责读取同一份正式内置 `deep-research`，通过普通 Workspace 工具自行保存和回读；Host 不自动推进研究阶段，也不代替作者检查正文。

模型可见的三个层次：

1. 目录只包含名称和描述，供模型判断是否使用。
2. `skill` 的 `activate` 动作返回正文和资源清单，作为普通工具输出进入历史。
3. `skill(action="read_resource", skill_name="...", resource_path="...")` 按相对路径及可选的 1-based 行窗口读取补充资料；`skill` 的 `list_resources` 动作可重新查询资源。这里的动作名不是独立工具名，资源指引应保留完整 `skill` 调用形式。

动作、参数与输出由 [Skill schema](../../../packages/schemas/src/tools/skill.ts) 拥有；[SkillTool](../../tools/skill/SkillTool.ts) 只做接纳、编排和格式化，不自行遍历文件。Skill 资源不通过 VFS 或旧 `resource_read` 读取。

## 内置能力边界

| Skill | 用途 |
| --- | --- |
| [deep-research](./builtin/skills/deep-research/SKILL.md) | 深入研究、证据检验与面向读者的长文；也支持固定材料编辑和研究更新 |
| [mckinsey-research](./builtin/skills/mckinsey-research/SKILL.md) | 既有咨询式商业战略流程；不作为一般深度文章的必经入口 |
| [linnya-markdown](./builtin/skills/linnya-markdown/SKILL.md) | Linnya Annotation、图片与 `linnya-chart` 图表围栏的操作指引；语法事实仍归 Markdown domain |

`deep-research` 服务报道、财经、时政、评论、学术综述、投研和预测文章。深入研究回答问题、比较解释并交付可追溯的文章；决策支持还需要决策者的目标、约束、备选行动与代价，两者共享证据与建模方法，但不能要求每份研究都填写行动收益表。研究请求不会自动触发决策流程。

该 Skill 复用 Default Agent 的 Web、Knowledge、Workspace 与 Shell 工具，不恢复旧 Deep Research beta，不要求固定多 Agent 编排。入口保留共同研究纪律；文体差异与建模选择按需读取 resources。它不强制统一章节、假设数量、概率分数或资料数量，也不宣称系统已经机械验证推论。

当前正式版本为 1.10.2，版本覆盖 `SKILL.md` 与同目录资源的完整包，不覆盖独立的 Agent 系统提示词。入口保持界定任务、探索资料、检验解释、成文和交付五段循环；涉及原因或机制时实际核查关键竞争解释，描述、概念辨析和作品阐释不强凑因果。研究记录在调查中保存，缺口必须约束成稿。未来观察只在有依据时给数值阈值，不以形式完整诱导假精确。委派需显式交接材料、访问与产物边界，不能假设子任务继承父会话全部约束；这仍是行为指引，不是权限强制。入口不承诺因果识别已被工具保证，也不强制延长运行时间。

写作资料是 Skill 的组成部分，不是额外 Agent 或独立注入模块。成文前先读 [交付目的与写作入口](./builtin/skills/deep-research/references/article-craft.md)，再读 [通用手艺与六种文体目录](./builtin/skills/deep-research/references/writing/index.md) 及适用卡片；不把全部卡片默认塞进上下文。选择取决于调查后的材料、证据、读者与用途；报告式、结论先行与叙事式均为选项。必要背景须在首次依赖它判断前出现，段落以内容推进，避免无增量重讲；示范不是其他题目的来源或统一开结尾模板。激活与读取仍由 Agent 实际调用，不是确定性加载或文笔保证。

资料包细化背景随问题进入、连续段落推进、产业解释中的执行阻力、叙事与作品评论的不同走法，以及按用途收尾；仍保留六卡，不增加选卡工具、必读全卡或固定结尾。自写对照按需读取，不包含订阅全文，也不依赖外部资料库。1.9 针对数字与概念密集的开头：解释卡增加入口写法和第二个虚构示范，报告卡与索引补充口径放置与概念引入时机。资源接入验证不等于已证明成稿质量增益，质量变化需另做真实使用观察。

1.10 补齐图文交付的发现入口，新增 `references/images.md`，按取得与查看、插入与说明、另存与回读三个步骤处理图片；跨文档另存沿用原会话文件重新导入，不复制原文档图片身份。图片语法只在 `linnya-markdown/references/image.md` 维护。1.10.1 明确成文时按题材、内容、证据和用途选择媒体：单用图片、单用图表、二者结合或纯文字均可完整交付，选用后实际嵌入并回读。两版均保留六张写作卡和既有研究方法；能力入口扩展不等于已证明文章质量增益，按需加载也不保证每篇都会配图。

1.10.2 只澄清资源读取调用：使用 `skill(action="read_resource", skill_name="...", resource_path="...")`，图表/图片资源给出可直接调用的完整字段。`read_resource` 继续是 Skill action，不新增、恢复或更名工具；研究方法、写作资源1.9及 Agent 系统提示词不变。这是入口歧义修正，不宣称新的研究质量收益。

反馈修订方法实验与写作资源升级分别维护。[Benchmark fixture](../../../apps/linnya-benchmark/fixtures/research-feedback-revision-v1.json) 保留其原有基线与候选差异，不随当前正式版本重写历史对照；本次写作升级不采纳其中的反馈修订候选。新实验须冻结完整副本并核对实际加载，不将用户请求中的同义要求重复塞给各组而抹去被测差异。

`references/modeling.md` 将材料立场、参与者利益、竞争解释与间接线索连接到具体查找任务：先说明候选机制会留下什么可观察记录，再查相关主体、时间线、资金/实物流和制度条件，并保留反证、基准解释与未解环节。立场不等于真假，相关不等于因果；这是一套行为指引，不是已验证的自动发现能力。

深度研究默认交付当前项目的 Markdown 文档，聊天只给摘要与 canonical Workspace 链接；用户明确只要聊天回答时例外。正文与必要的研究记录分开，独立评价在同项目新会话读取指定版本、允许材料和评价标准，另写评审文档，不修改原稿。新会话只隔离对话历史，不自动隐藏同项目文件或实现盲评；正式比较仍需冻结输入、匿名化与 Judge 校准。

`references/business-analysis.md` 吸收旧咨询流程中仍适用的双路径估算、驱动量建模、可比性与综合方法；只在商业任务需要时加载。正文、研究记录和评审之间使用实际 locator 关联，不引入第二套持久化或报告发布通道。

资料取得状态、正文支持程度与计算执行分开记录。引用接纳由 [Citation](../../domains/citation/README.md) 拥有，网页取得状态由 [Web](../../tools/web/README.md) 拥有，写入结果由 [Workspace 工具](../../tools/workspace/README.md) 拥有；Skill 不复制校验器或将自述变成通过状态。

图表语法只有一个 owner：`linnya-markdown` 的 [references/chart.md](./builtin/skills/linnya-markdown/references/chart.md)（字段与规则、九套色板与顺序取色、八种 canonical 示例及常用柱图变体、回读与修复），由测试对照真实准入与解析器防止漂移。`deep-research` 的 [references/charts.md](./builtin/skills/deep-research/references/charts.md) 只给“画不画、画哪种、怎样选择色系与维护实体色序、怎样不画错”的研究纪律，不复制 schema 或示例；这是行为指引，不是已验证的作图质量保证。

## 编写与维护

- `SKILL.md` 的 YAML 必须有 `name`、`description`。其余字段宽松加载：YAML 以 failsafe schema 解析，所有标量保持原文（`version: 1.0` 不会变成数字），`allowed-tools` 可写成空格分隔字符串或列表，格式不对的可选字段只被忽略，不会让整个 Skill 失效。名称须与目录名一致，为 1—64 字符的小写字母、数字、单连字符；不能以连字符开头或结尾。解析以 `frontmatter.ts` 和 `types.ts` 为准。
- 描述写清触发任务；正文只放改变行动的指引。相关条件细节用 `references/`，不把所有资源默认塞进上下文。
- `allowed-tools` 当前只解析保存，不执行权限变更；`disable-model-invocation` 只影响目录披露，不是访问控制。不要声明未实现的 fork 或脚本执行协议。
- 资源相对路径限制在 Skill 目录，读取上限 512 KB；资源枚举最多 50 个、深度最多 3 层。保持资源精简，超限行为以 `catalog.ts` 为准。
- 自动发现不保证模型激活；加载成功不证明研究质量。更新需分别验证发现/加载、实际工具行为及成稿质量。 版本对照逐条核对作者实际收到的正文与所需资源；历史基线也要复核。未激活、读取失败或只加载部分资源时，保留该运行并标明实际处理范围，不能仅凭发送时的磁盘版本将结果归因于该版本。
- `mckinsey-research` 仍有过期的 `task`、固定十二项分析及批次安排，且其输入清洗可能删除有效网址和材料。它拟退役；保留可用方法，不整体迁移旧执行协议。合法 inode-only 读取本身仍受 Workspace 支持，不应与过期工具混为一谈。

## 验证

现有接入测试：`pnpm exec vitest run src/features/skills/__tests__/agentSkillExposure.test.ts src/features/skills/__tests__/pluginSkillSources.test.ts`。

真实研究调用复用 [Benchmark Runner](../../../apps/linnya-benchmark/README.md) 的 `deep_research_article_v1`，必须指定项目与任务 brief。从工具轨迹确认 Skill 实际激活、所需资源成功读取，并分别核查研究证据、文章解释与交付状态。一次冒烟验证不能证明所有文体的质量增量，比较方法效果仍需同等模型、材料、预算和独立评审。


## 用户 Skill 管理

公开入口 `index.ts` 提供当前实例唯一 `skillManagement` 与窄 `SkillManagementPort`。文件实现位于 `adapters/createLocalSkillManagement.ts`，原文编辑规则在 `functions/computeSkillFileEdit.ts`，读取与管理共用 `shared/skillFiles.ts` 的文件准入。只有用户来源可写，不覆盖内置/插件目录。

管理包含安装、整包升级、卸载，以及当前文件的读取、原文替换、完整写入和支持文件删除。安装/升级接收本机绝对来源目录；先验证完整包，升级替换文件集合，旧版多余文件会消失。普通临时文件/目录仅用于完成本次写入，收尾删除；不保存修订、回收站、持久 journal 或恢复历史。需要旧内容时重新安装。

入口文件与资源都拒绝链接/特殊文件、越界相对路径与超限文本；入口文件须是合法 UTF-8，支持文件在目录发现阶段只检查类型与大小，读取时才拒绝非法 UTF-8。包最多 50 个支持文件、深度 3 层、每文件 512 KiB、总文本 5 MiB；无效候选单独诊断，不拖垮其他 Agent。直接读取也必须属于同一资源清单。frontmatter 使用运行时 YAML parser，支持块标量与 CRLF，已知字段严格验证，不能把数组当 allowed-tools。

`skill_manage` 是薄工具：能力来自 Agent 定义的工具名单（`functions/canAuthorSkills.ts`），不按 Agent 身份硬编码；standard/full_access 可写，read_only 或权限不可用拒绝写入，用户关闭内部数据访问时读取也拒绝，不新增专用审批/授权 token。已有研究评审配置复用 Default 时显式排除该工具；内置 `skill-creator` 只向持有该工具的 Agent 披露，按名读取使用同一判断。用户 Skill 继续遵循既有可见范围。

Renderer 的 `/api/v1/skills` 与外部 CLI 的 `skills` capability 调用同一 owner，分别沿用既有 App API 与本机控制桥鉴权。CLI 的本机来源路径由客户端转为绝对路径，Host 就地读取，不引入上传会话。Agent 以 `skill_manage` 直接写入，避免为普通文件管理扩张 Shell 沙箱根或向它分发全功能 CLI token。

完整写入需带刚读取的 expected_content；省略或 null 仅表示新建文件。原文改变或 edit 无法唯一匹配时报冲突。同步小包替换期间不向事件循环让出控制，应用内读取不会命中目录改名间隙；不宣称与外部编辑器完全串行，也不承诺强杀/断电的整包事务恢复。整包升级把旧目录暂存为 `.replace-<name>-<uuid>`；若上次替换被强杀，下一次列表或安装会先清理：新版本未落位时把旧版本放回，否则删除残留的 `.install-*` 与 `.replace-*` 临时目录。

新名称进入下一次 run 的目录，当前读取可见已保存文件。当前恢复摘要合同保持严格：更新/卸载任何原 run 可见的 Skill 都可能阻止旧暂停运行继续，不按“是否激活过”缩小影响，也不新增修订固定。

管理验收：`skillManagement.integration.test.ts` 覆盖真实文件与 HTTP，`skillCli.lifecycle.integration.test.ts` 覆盖 CLI 子进程→鉴权/握手→同一文件 owner，SkillManageTool 集成测试覆盖冻结权限与操作生命周期，Renderer Skills feature 测试覆盖列表分组、详情编辑与冲突保留草稿、内置只读、文件夹安装/升级/卸载的确认流程，以及窗口重新获得焦点时的静默刷新。
