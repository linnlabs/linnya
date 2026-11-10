# 正文引用索引与可信恢复

索引以 `(sourceDocumentId, referenceId)` 标识出现位置，targetDocumentId 永不因同名路径改变。`replace` 加入调用方已有同步事务；普通新引用要求活动、同项目目标，既有引用可以暂时不可访问。

`retainedReferences` 是窄的可信恢复输入，只接受正式历史/撤回记录中仍可达的 `referenceId + targetDocumentId` 对。它允许恢复已从当前索引移除、后来被删或越界的原身份；新出现位置、改目标或仅提供相同 target ID 都不能借此越界。来源文档仍必须活动。

调用方只能从自己真实保留的版本、用户撤销或改动组提取此集合，不能从 Renderer/CLI 请求、模型声明或批准布尔值接纳。Core 不为此创建永久墓碑；关闭或裁剪记录时由记录 owner 释放恢复依据。字节、版本和撤回记录生命周期不属于本索引。
