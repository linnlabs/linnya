# Workspace Document Lifecycle

本 feature 拥有 Workspace 文档的创建与复制用例：规范化类型和名称、生成同级唯一名称、确认源节点身份，再调用 Host 注入的文档生命周期 provider。它不读取或写入任何具体文档类型的卫星表。

Host resolver 组合两类实现：

- 永久内建 Markdown provider 自己开启同步 SQLite 事务，原子创建节点与初始版本、或复制节点与正文。
- 插件 provider 适配 `createDocument` / `duplicateDocument` hook，插件拥有节点和内容的原子性。

两类 provider 共享动作合同，不共享事务实现。禁止在 `better-sqlite3` 同步事务回调中 `await` 插件 hook；那会在 Promise 完成前提交事务，形成伪原子写入。
