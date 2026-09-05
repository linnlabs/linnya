# 文档历史

Core 拥有统一的历史选择、保留规则与文档类型分发；不读取插件版本载荷，不执行插件表的删除。
公共身份合同在 `@app/schemas` 的 `document-history`，包含 versionId、严格递增的 order、实际提交时间、isCurrent。
非空查询按 order 降序且以唯一 current 开头；数字允许有空洞。时间不作为版本身份。

## 展示与物理保留

两者是独立规则，不能用 UI 返回的几条版本执行数据库删除。

| 用途 | 规则 |
| --- | --- |
| 默认列表 | 最近五条，及当前成功版本约 30 分钟、2 小时、1 天前的最新版本；去重后最多八条 |
| 展开更早 | 额外提供约 7 天、30 天前的版本；最多两条 |
| 物理保留 | 最近五条＋最近两小时每五分钟一条＋两小时至两天每小时一条＋两天至三十天每天一条＋更早最新一条＋最早一条 |

物理规则同时保留当次列表选中的版本。时间桶固定按 UTC 对齐，桶内按提交顺序选择最新版本。
所有时间距离以当前成功版本为基准，长时间未编辑不会因打开列表而移动锚点。
锚点选择不晚于目标时刻的最新实际时间，时间相同以提交顺序决定；UI 必须显示真实时间。
这是一组 V1 工程默认值，不是对用户偏好的统计结论。保留数量受时间桶约束，不是十条。

纯函数接受已由 DocumentVersionListSchema 验证的快照。插件合并 current、draft base 等结构依赖，
先重建、校验全部保留载荷，再在事务内重新核对 current 并原子重链；Core 不了解 diff/checkpoint。
成功保存与后续维护分开，维护失败不能回滚保存。资产只能通过 Host ownership 合同释放，不能由插件删 Host 表或物理文件。

## 实施边界

后端通过 document type hook 的可选 `history` 能力分发 `document-history:list/restore`。
list 只返回选中的元数据；restore 携带 expectedCurrentVersionId，插件负责在编译前和提交事务中校验。
停用、缺失和版本冲突使用标准错误码，不能转发到其他文档类型或覆盖新版本。

插件通过 `@plugin/backend/documentHistory` 消费纯保留计划，通过 `@plugin/backend/documentAssetOwnership`
精确释放文档资产归属。Markdown、Mindmap 已迁移到统一规则和各自的 SQL 删除；原表名式 pruneVersionTable 已移除。
Slides 重链维护及前端面板接入仍在实施，不能把后端合同完成理解为全部验收。

相关 owner： [文档类型](../../../docs/plugins/guides/05-document-types.md)、
[数据库](../../../docs/plugins/guides/06-database.md)、[资产](../assets/README.md)。
