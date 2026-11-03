# Canvas

Canvas 是自由画布文档插件。后端逐元素保存当前事实，Renderer 的 scene、缩略图与编辑器均是它的投影。Markdown 是 Agent 阅读与 CLI 正文写入的交换格式，不是可整份覆盖的画布文件。

## 边界与入口

- `shared/model` 拥有卡片、连线、正文及提交快照合同；类型来自唯一 schema。
- `backend/features/canvasCommit` 拥有当前内容的提交，跨 feature 步骤由 backend orchestration 装配。
- `renderer/kernel` 只处理绘制与交互意图；Host 能力由适配器注入。
- 包外只消费 shared/backend/renderer 与测试专用 backend-test-support 入口，不 deep import。
- 文档引用、图片资产、历史保留、正文编辑器与 Conversation 权限仍由各 Host owner 通过窄门面提供。

## 数据规则

卡片 ID 为画布内稳定的 `cN`，线为 `eN`；ID 永不复用。元素 revision、画布 sequence 与历史版本身份独立。相机和选择不进入文档内容。每个写请求必须有稳定请求 ID，重试复用，不能靠相同内容猜测重试。

没有任务级文件锁。并发冲突按字段及实体依赖判断；当前编辑字段受保护。Agent 改动按对话与画布归组，用户撤销与组撤回分开；选择性撤回保留其他来源的后续修改。

## 验证

插件自身提供 typecheck、test、lint、build 入口。测试覆盖真实提交/重开、失败回滚、并发/撤回与插件生命周期；技术探针放在 `dev/probes`，本地结果不成为构建依赖。插件不属于默认官方发行目标。
