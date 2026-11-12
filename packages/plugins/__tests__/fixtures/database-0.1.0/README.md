# Desktop 0.1.0 升级夹具

`workspace.sqlite` 来自公开源码提交 `9c8186a8` 的真实 DatabaseService、schema providers 和
Slides plugin migrations，Host 版本为 v68。0.1.0 正式随包插件集合只有 Slides；Decision 不属于此发行基线。
此夹具被冻结用于后续升级，不能拿当前结构重新生成来掩盖升级差异。

数据全部为合成内容：一个项目、Markdown 文档版本和 update Pending、一条 Conversation 的 run/event 和
child trace，以及 Slides 全部十张自有表中的文稿、两条源码 revision、草稿、模板、图片/SVG 绑定、
revision context/asset、待释放资产和人工编辑回执。PPTX BLOB 故意为空，不用于导出或视觉验收；
资产身份是虚构值，不指向实际文件。无凭据、API Key、真实用户内容或本机路径。生成后检查外键并 VACUUM，体积小于 2 MiB。

从仓库根运行 `node packages/plugins/__tests__/fixtures/database-0.1.0/generate.mjs` 重建。
需要 Git 中保留上述提交、Node 24、仓库锁定 pnpm 和原生模块编译环境。脚本在系统临时目录建立 detached
worktree，安装该提交自己的冻结依赖，把 `seed.ts.txt` 作为临时测试运行，再复制 SQLite；成功或失败都会用
`git worktree remove` 回收。不会创建分支、链接其他 checkout 的依赖，也不会启动 Electron 或 Office。

验证入口：`pnpm exec vitest run packages/plugins/__tests__/databaseUpgrade.sqlite.integration.test.ts --maxWorkers=4`。
测试只升级临时副本，通过正式 Host 和插件 runner 与当前新建库逐对象比较；SQL 比较忽略注释、空白和标识符引号，
保留约束及字符串字面量，同时检查 SQLite 列、外键和索引元数据。失败信息带对象类型与名称。
