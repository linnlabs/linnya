# 决策原型插件

本插件提供独立的 `decision_agent`、`decision-exploration` Skill 和版本化决策记录 CLI。目标是让建议可以在用户条件变化后继续更新，而不把聊天历史当作唯一状态。当前版本 0.1.0，是开发原型，尚未进入默认发行插件清单。

## 能力与边界

Agent 负责澄清、探索、调查和判断，Skill 提供方法与操作说明。程序保存项目内的版本化条件，计算已声明的四则式和数值约束；条件更新后旧建议标记为待复核。`current` 仅表示建议关联当前输入，不是质量认证。

完整 Deep Research 受管子项、通用工作流引擎、专用文档编辑器和自动对外执行不属于当前实现。原型可用普通 Web/Knowledge 查资料，重要解释通过普通 Markdown 保存。原有研究角色、系统提示词和 deep-research Skill 不受本插件修改。

## 修改地图

- `src/backend/agents/decision/`：独立角色和系统提示。
- `resources/skills/decision-exploration/`：方法入口与模型可读 CLI 格式。
- `src/shared/definitions/decisionRecord.ts`：数据合同和纯 JSON 四则表达式。
- `src/backend/features/decision-record/`：计算、更新规则和持久化。
- `src/backend/features/decision-cli/`：参数解析与 App bridge adapter。

## 持久化与操作

`decision_record_versions` 由插件 migration 创建，采用同一 decision id 的追加版本，项目删除由外键级联。记录可跨会话接续；读写的 project id 来自 Host bridge 对正式 Conversation 归属的查询，CLI 不接受项目覆盖或数据库路径。对话不属于 Workspace 文件节点，不能用文件节点查询推断其项目。禁用/卸载遵循平台合同，插件数据保留，重新安装可继续使用。

修改必须提供 expected revision，事务内检查当前版再追加。输入更新保留旧建议及其输入版本；包括偏好在内的条件变化都会要求重新判断。表达式只引用本记录输入，未知/撤回/非数字和除零明确不可用，不执行生成代码。数值检查的模型、单位、完整性与事实真实性仍需判断。

`linnya-decision create/list/read/update/recommend` 经现有 Shell → Plugin CLI bridge 调用。prepare 只解析参数；执行前由 bridge 校验 internal-data 与写权限。它只访问本插件数据表，复用已有命令生命周期，不新增 Agent 工具、审批或重试器。当前此 CLI 需要 internal-data 权限；不能把它的可用性解释成解决了整个平台的内部存储保护问题。

create/update/recommend 支持 `--input` 读取当前会话内的相对 JSON 文件，文件读取在权限校验后进行并核对真实路径归属。小载荷也可用 `--json`；现有通用 bridge 的单参数 4096 字符限制不变，不能将大型条件拆成多次版本更新当作默认用法。

## 开发与验收

从仓库根运行 `pnpm --dir packages/plugins/decision run typecheck`、`test` 和 `build:backend`。源码 Desktop 的开发发现读取本包 `linnya.development.backendLoading=disk`，通过既有 direct-dir loader 装入构建产物；Skill 由平台从本包资源发现，requiredSkills 仅保证依赖存在，实际激活要检查轨迹。

后端变动需正常重启对应开发实例。插件启停后 Agent、CLI 与 Skill 应随注册能力收缩；卸载不删决策记录。进入正式分发前，还需按插件发布合同完成制品、默认发行配置和安装包验收；Renderer 入口仅在需要专用界面时添加。开发 direct-dir 加载不是已发布。

业务测试覆盖创建、条件更新与重算、建议失效、违反硬约束拒绝、历史与项目隔离、过期版本拒绝、持久重开、偏好更新和来源撤回。真实模型冒烟另验 Skill 实际读取、CLI 实际执行、最终建议与计算是否一致，不以测试通过证明模型判断正确。
