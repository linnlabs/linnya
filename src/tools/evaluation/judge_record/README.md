# Judge Record

`judge_record` 是内部文档评委的结构化评价提交工具，仅由 `internal_judge` 显式暴露。
它不调用模型、不取网页、不读写文档、不增加评审数据库。正式 ToolNode 把参数与结果写入
既有 Conversation EventStore；工具成功表示记录已接纳，不表示事实正确。

## 合同

- 输入：目标 Markdown locator、允许的 Markdown 材料列表、评价标准、计划评审输出 locator、逐项评价。
- 评价：`supported / revision_needed / unverified` 是模型提交的判断。前两种必须给具体引文；
  缺失信息可引用相关上下文，无法确定则标未验证，不能伪造缺失内容的引文。
- 所有路径复用 Workspace 正式 locator schema；证据地址须属于声明输入，输出不能与输入重合。
  这只是记录内部一致性，不是文件访问权限、内容冻结、真实性或读取轨迹证明。
- 回执：目标、计划输出、三个计数，以及 `assessment_origin=model_reported`、
  `semantic_validation=not_performed`、`document_delivery=not_checked`。
- 输入错误抛出正式 parser 错误，由通用工具链结算 error；不返回假成功。

文档交付仍走 `write_file` 和 `read_file`，不要让这个工具成为第二套 Workspace 写入实现。
原文、允许材料、评价标准和版本身份应写入评审文档；新对话本身不冻结输入、不自动匿名。
工具不检查引用是否真的出现或支持判断，也不证明受评文章完整覆盖了检查集合。

## 展示与验证

`packages/schemas/src/judge` 是前后端共同 strict 合同。Renderer 的
`conversation/ui/tools/judge` 使用同一 success parser，并核对回执与参数一致；
loading/error 不要求尚未接纳的完整参数。完整卡片与紧凑步骤通过 platform 注册，
实时与历史使用同一 projector，卡片不显示“事实核验通过”。

相邻业务测试覆盖缺证据、越界引文、输出冲突、严格错误和回执；Renderer 测试用真实工具结果
验证 live/reload 等价。实际模型是否遵守评审范围，仍需要独立运行轨迹检查。
