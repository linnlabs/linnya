# 知识库插件

知识库拥有资料摄入、原文、检索索引、图谱和项目关联的业务规则。公共 shared 入口是 Backend 和 Renderer 共用的数据合同，不导出数据库、文件路径、模型路由或凭据。模型目录、用途配置和实际推理由 Host 提供窄端口。

## 数据合同

`src/shared/definitions` 是知识库实体、文档状态、任务与检索投影的唯一声明位置。文档的 `hasSource` 是读取时从资料仓投影的可读内容事实，不存第二个布尔字段；`KnowledgeSavedContent` 只包含文档身份、名称和完整已保存内容，不授予磁盘路径。

上传回执表示进入受管任务；是否摄入完成以任务状态为准。重建索引只重建派生向量，不替换或自动删除已保存原文。模型空间不匹配需要用户显式重建，身份未知的历史非空索引不能用当前模型配置回填。

项目摘要复用 `@app/schemas` 的只读合同。关联查询不授予跨项目资料读取权限；来源读取仍由冻结的项目身份和当前关联范围校验。历史引用证据属于 Host，停用知识库不能使已有对话中的引用证据不可读。

Backend 的旧领域入口在迁移期只重导出这些合同，不能另写一份近似 schema。Renderer 只能通过本包公开入口及 `@plugin/renderer/*` 使用 Host 能力。

## 构建与运行边界

身份和版本以 `plugin.json` 为唯一真源；代码的 builtin 标记不是应用表面授信依据，Host 只授信正式装配来源。
本包需要同批实现公共 SDK 的 Host；manifest 的版本下限不能表示旧安装包已经具备新增接口。
`pnpm --dir packages/plugins/knowledge run typecheck` 使用 vue-tsc 同时检查 TS 与 Vue 模板。
原 Renderer 的 JS 模块保留原语言与声明合同，不因迁移全面重写；TypeScript strict 规则保持不变。

### 数据库与产物

[`src/backend/database`](./src/backend/database/README.md) 拥有 8 张业务表及首次插件迁移；Host 历史 v79 仍负责已发布数据库的列升级，插件接管不改文档 ID、项目关系或原文/向量路径。

`package.json` 的 `linnya.development` 声明使开发编排发现 Backend、3 个 Node Worker 与 Renderer，无额外 Host 插件名单。`linnya.release` 使用既有官方插件打包/随包资源流程；该标记仅表示构建装配，不授权上传或开放远程安装。

`pnpm --dir packages/plugins/knowledge run package:artifact` 构建 CJS Backend/Worker 与 ESM Renderer，生成 ZIP、SHA512SUMS 和现有内容许可清单。`guard:artifact` 复用正式插件校验，再验证 3 个 Worker 的实际构建图与 ZIP 内容；构建图留在 `dist/.metadata`，不进入发行包。

Node Worker 没有 Backend 的模块加载钩子，数据库、推理和解析 Worker SDK 由正式构建别名内联。原生 SQLite、PDF.js、Canvas、Jieba 与 Sharp 使用 Desktop 已有运行依赖；PDF.js 保留完整包的 `cmaps`、`iccs`、`standard_fonts` 和 `wasm`，不另复制一份解析资源。Audio Worker 继续属于 Host。
