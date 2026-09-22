# Internal Judge

通过 CLI 的既有 `send --agent internal_judge --project <id> --model <id>` 发起一份文档的
独立评审。模型由调用方明确选择；不绑定某个供应商，不引入独立模型调用或第二套运行时。

Agent 已注册到正式 platform 定义清单，但不贡献 Renderer `conversationAgentChoices`。
因此前端不提供发起菜单，会话与工具卡仍按普通 Conversation 显示。这是入口发现约定，
不是拒绝手工构造 Renderer API 请求的权限边界；也不注册为可委派 subagent。

## 每次新对话的输入

- 当前项目中待审的 `workspace:/...md`。
- 允许读取的材料 Markdown 路径，明确没有材料也可。
- 本次标准、读者与文体；比较任务明确输入和顺序。
- 一个尚不存在的独立评审 Markdown 输出路径。

`list_files` 只用于输出目录的名称冲突检查；不阅读其他评委意见。不提供 Web、Shell 或
subagent 工具；没有实际计算执行证据时不能声称机械复算通过。需要外部核查时在文档中
标未验证并建议下一步，而不是借预训练记忆补齐材料。

## 输出闭环

读取指定正文与允许材料 → `judge_record` 提交带引文的评价/未验证项 →
`write_file` 保存独立 Markdown 评审 → `read_file` 回读 → 聊天短摘要和文档链接。

写入前检查目标名称；冲突时选新名称并说明，不覆盖原稿或旧评审。所有输入只读由提示合同
约束，现有文件工具仍可操作本项目，不能把本 Agent 描述成权限沙箱。也不要将独立会话称为
自动盲评或已校准；校准材料、随机顺序、重复评审及评价者独立性由实验设计负责。

本能力简化交接和评价记录，不把模型判断升级为客观真值。具体工具合同见
[Judge Record](../../../../../tools/evaluation/judge_record/README.md)。
