# Research 产品职责与交接边界

目标是充分调查、准确解释、深入浅出的长文章。前端入口仍为“研究”，身份仍为
`research_v1`。主 Agent 使用正常 Conversation、TaskState、通用 `subagent`
与 Workspace 文件工具；Host 不自动推进研究阶段，不另建 Workflow。Default
Agent 与正式 deep-research Skill
1.4 保持不变。工程闭环不等于已经证明跨题稳定的质量优势。

## 职责与材料交接

父 Agent 持续负责调查、解释、调查记录、文章初稿和一次修订。专项调查与成文前调查复核按实际缺口选用；父提示要求最终交付前取得同一初稿的论证复核、来源与数字复核。四种专项角色继承父模型，默认不继承父会话历史，最多 800
Graph 步，不再委派其他 Agent。它们作为普通已注册子类型供父 Agent 选择，没有研究专属的 caller 白名单，也不增加前端菜单。

通用 `subagent`
只有 description、prompt 和可选 subagent_type。研究父 Agent 在 prompt 中明确原问题、读者、用户约束、唯一
`Review target`
稿件路径、核查材料路径、可补查范围、具体缺口和独立输出路径。不能把近完整文章复制给子 Agent 重写，也不能假定子 Agent 自动知道父会话或 TaskState。调用沿现有 runner 串行执行，真实轨迹进入标准子任务卡和详情。

评审按指定路径读取和检索，不搜索项目根来发现同伴意见，不读取另一份成稿评审；获准的成文前调查复核可以作为共同背景。意外取得同伴意见须报告暴露，不能据此宣称评审独立。这些是系统提示和任务请求中的职责要求，**不是同项目文件权限或运行时隔离保证**。实验必须核查实际工具调用及返回，串读样本保留并标为受污染。

## 文档保存与最终交付

父子角色用普通 `write_file`、`edit_file` 保存 Markdown，按工具结果使用
`read_file` 核对真实保存稿。Markdown 编译、Citation、pending
revision、写入冲突等沿用各自 owner 的通用合同。子任务产物由现有成功写入事件提取为 Workspace
inode，不引入研究回调。

调查记录、初稿、每份原始评审和修订稿使用不同路径。父 Agent 读取初稿及两份原始意见，回到来源和计算接受、缩小或拒绝重要意见，亲自完成一次修订并回读；最终回答链接已保存文章与原始评审，说明关键未解决问题。保存成功、子任务完成与内容正确是不同事实。不通过追加评审循环追求“通过”，不把研究日志混入面向读者的正文。

保存旧稿、不在两评审之间改初稿、检查修订传播和核对版本仍是父子任务责任。当前不再提供研究阶段 create-only 提交、输入版本锁定、原子产物接纳或双评审齐备认证。普通文件工具的能力不等于这些已撤回的研究保证。材料变化后需要重新判断受影响的评审；预算或证据不足时如实交代，不能把 TaskState 勾选或 child 成功当作全文交付。

## 接纳与恢复

项目会话选择“研究”或 CLI
`send --agent research_v1`，普通请求以开放调查接纳。原请求、正式历史与编辑器上下文各走既有通道；无项目或本轮图片附件在接纳前拒绝。

CLI `--research-scope-json`
声明 question、reader、open/fixed/update、Workspace 材料和时间范围；接纳后随请求冻结为 researchScope。显式范围拒绝未绑定的历史、附件和编辑器上下文；fixed/update 要有正式材料。fixed 禁止外部查找的要求进入父系统提示，父再明确交给每个子任务；不再通过 Web/Knowledge
decorator 或文件工具实施研究特判。Shell 权限沿通用设置执行，真实任务越界仍需审计。

新研究和普通子任务复用持久 child
admission、RunSupervisor、EventStore、Audit 与通用工具恢复。TaskState 只记录计划，不是运行真源。旧
`research_run`、 `submit_research_document` 和 `complete_research`
已退出后端执行注册；不保留特殊旧配置来绕过恢复兼容性检查。依赖旧研究配置的暂停任务明确拒绝续跑，应保留文档并从新会话开始。历史事件、工具展示合同和已保存文档保留；既有旧回执表不删除，也不再新建或写入。曾带 input_documents 的历史 subagent 卡通过只读展示 schema 解析；新的调用不接受该参数。旧普通 pending 调用若仍携带该参数，会按新严格参数校验失败，不会偷偷启用旧交接协议。

## 方法与验证

研究方法继续从唯一正式 Skill 1.4 及资源加载。父/子角色 system
prompt 确定职责，具体委派 prompt 给出本题问题与材料；没有自动阶段 system
reminder。角色与方法维护位置见
[Agent Registry](../../agent-registry/README.md)。不新增 Judge、图谱、评分或专用评审工具。

工程验收覆盖普通文件读写、父写稿与子评审、模型继承、实际子任务输入、取消恢复、产物提取及实时/历史投影。质量实验另外分别报告相对改善、全文质量、完成率和成本；本次通用合同回撤不作为任何方法有效性的证据。
