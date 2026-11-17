# 存储空间应用用例

设置页概览只展示受管存储的六类聚合占用。`readOverview` 调用物理 inventory 一次，
返回采样时间、总量和分类；不查询全量对话 catalog，不逐个对话重新计量，不返回对话详情。
物理盘点仍需扫描受管文件，这次读取不是事务快照；HTTP 返回 `Cache-Control: no-store`。
计量失败明确报错，不能用部分结果或零值冒充完整总量。

单个对话的容量展示归项目概览的 Conversation Storage owner。精准清理端点继续委托
Conversation Lifecycle 的 `requestWorkDirectoryClear`，保留运行中清理排程与身份校验；
清理工作文件不删除聊天记录。概览读取本身没有清理或其他写入副作用。

实现入口是本目录 `index.ts`，HTTP 适配在 `src/features/storage-space`，wire 合同在
`packages/schemas/src/storage-space`，物理计量在 `src/infra/adapters/storage-space/local-inventory`。
Renderer 和 Backend 随同一 Desktop 版本更新，旧逐对话 overview 字段不保留兼容分支。

验收以相邻 use-case 集成测试、HTTP router 与 backend E2E 为主；真实磁盘夹具覆盖分类统计、
精准清理后占用减少、聊天保留，以及未清理的其他目录仍被计入。
