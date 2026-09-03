# 16 · 测试、验收与守卫

> 适用场景：新插件上线前的验收；配置边界守卫；防止架构回潮。

## 新插件最小验收

新增官方插件时，至少需要证明：

- `plugin.json` 能通过 `parsePluginManifest`；包内 shared meta、backend contribution meta、插件
  `package.json` 与 manifest 不漂移，Host 不持有第二份业务 meta。
- backend/renderer entry 产物存在且可由 loader 加载。
- 含 Vue renderer 的插件必须把 `vue-tsc --noEmit -p tsconfig.json` 纳入插件
  `typecheck`；`tsc` 不检查 `.vue` 模板和 `<script setup>`
  绑定，不能单独作为 renderer 类型验收。
- 商店列表可见的插件必须有详情链路验收：active artifact 正常时读取 active
  manifest；missing 时读取 bundled manifest；`enabled` / `disabled` 但 active
  artifact 暂缺时回退 bundled manifest，且
  `details`、`releaseNotes`、`skills`、`agents`
  等展示字段不退化成只有版本和开发者。
- 启用时贡献的 tool、agent、document type、IPC 正常工作；插件私有工具的
  `toolClasses`、decorator `toolNames`、agent `availableTools`
  有契约测试防漂移；agent 的 `config.skill.requiredSkills`
  必须能在插件随包 skill 资源中找到。
- **停用/卸载后**：创建、写入、打开入口正确收缩；工具/agent/skill 从模型可见面消失；已有文件不丢失、read/grep 走快照可读。
- `read_file(view="document")` / 普通 read/grep/VFS / workspace
  metadata 至少用一个 fake plugin doc
  type 验证：Host 不在 hook 前用核心类型白名单拦截。
- renderer contribution 必须有失败回滚测试：注册中途失败不留半注册 document
  type/tool card/workflow；`activate()` 抛错不留 CSS 和贡献残影；`deactivate()`
  清理 port/cache。
- `plugin:invoke` 必须覆盖 typed
  diagnostic：missing、disabled、permission_denied、missing_handler、crash、validation。
- 如有数据库表：plugin migration 严格递增、升级失败回滚、`ownedTables`
  与真实 DDL 一致；官方插件必须进入 `official-plugin-db-contract` 契约测试。
- 如有独立 artifact 升级：覆盖 active 写失败、backend 加载失败回滚、启动 reconciliation，断言
  `installed_plugins`、`plugin_active_versions`、`active.json` 三者事实一致。
- artifact 上传前后能校验 manifest、sha512、entry、renderer 浏览器产物、Vue
  contribution 图标、manifest 声明的展示资源，以及有序 renderer stylesheet 清单与 disk/zip/checksum
  中 CSS 文件集合完全一致。
- R2 smoke 或等价外部安装测试覆盖真实下载、解包、激活、迁移和状态写回。

## 守卫与 smoke（命名约定）

Renderer UI 相关变更先运行 `pnpm run test:renderer-ui-package-gate`：它覆盖 package 独立
typecheck/行为测试/style audit/真实 tarball consumer、旧 shared 引用永久锁零、官方插件 peer/manifest range、
兼容 minor/不兼容 major、Host external 和 stylesheet/loader 对账。插件新增 package 公开入口消费后，还必须运行对应
renderer build 和 `smoke:plugin:<id>:artifact`，证明最终 JS 已改写到 `plugin://host/renderer-ui/*`，artifact 没有复制
package CSS、token 或 Vue runtime。版本发布遵循 Renderer UI
[发布检查表](../../../packages/renderer-ui/docs/release-checklist.md)。

进入默认发布面的官方插件，build/package/smoke/upload 脚本必须与
`scripts/release/plugin-release-targets.mjs` 同步，避免某个插件只有源码包、没有进入 artifact/seed 生命周期。公共目标由该文件静态声明；下游组合根通过插件 owner 的发行元数据发现额外目标，Core 不保存其 ID。边界守卫使用单一入口表达“官方插件边界必须整体一致”；artifact
smoke 仍保留单插件入口，便于定位发布形态问题。

- `guard:agent-boundary` — 全仓 Agent 与插件包边界守卫（包内不 import
  host 内部、包外不 deep import 插件内部）。
- `smoke:plugin:<id>:artifact`
  — 本地 artifact 冒烟，必须包含 package、一次性 bundled root 准备、
  `verify-plugin-artifact.mjs <id> --extra-resources --require-renderer-assets`
  和真实磁盘 backend entry 加载。
- `smoke:plugins:official:r2` — 公网安装冒烟，默认跳过外网，显式设置
  `LINNYA_R2_SMOKE=1` 后按 release target 清单覆盖所有官方插件。

日常 inline/source 启动与 artifact smoke 的来源必须分离：开发启动不扫描仓库
`extraResources/plugins`；单插件 smoke 每次创建只含目标插件的临时 bundled root，
并把该显式 root 同时交给 verifier 和真实磁盘 backend loader。测试应保留“开发态候选为空、
显式 root 可发现、打包态可发现随包目录”三条来源合同，并验证默认随包根与 official release
targets 精确一致，避免非目标插件因本机陈旧目录重新进入默认运行面。

版本内容唯一性必须覆盖三个边界：R2 上传拒绝覆盖同版本不同 sha512，预置 seed
拒绝接受同一版本但 `SHA512SUMS` 不同的既有版本目录，远程安装也只能在下载校验后复用身份一致的 staged 目录。seed 冲突是硬失败，不得降级成 optional 插件 warning；安装冲突必须保留原目录与 active 指针。

重型 backend 还必须在自身 build 内提供确定性制品门禁：entry 与 backend 总 raw
budget、metafile 依赖类别、初始 contribution 加载、首次延迟 runtime 调用、以及派生资源的精确闭包都要验证。只检查最终 zip 大小会被压缩率掩盖；只检查动态 import 则可能把依赖挪到另一个文件却没有缩小 artifact。标准库、语言数据等闭包应从制品内容重新推导并与 manifest/checksum/zip/extraResources 对账，禁止用“至少 N 个文件”代替完整性。

现有官方插件统一使用
`guard:agent-boundary`、`guard:plugin-runtime-dist`、`smoke:plugins:official:artifact`，并保留
`smoke:plugin:<id>:artifact` 作为单插件 artifact 定位入口。包边界守卫扫描完整工作区，
不再为单个插件保留伪隔离或兼容脚本。

## 守卫要随迁移进度收紧

- 每删一个过渡入口（legacy
  bridge、旧 re-export、旧目录），立刻把对应守卫从「允许过渡」升级为「禁止复活」（路径不得存在 / 任何 import 一律违规）。
- 通用守卫入口：`pnpm run guard:agent-boundary`（全局 Agent 与插件包边界）、`pnpm run guard:plugin-runtime-dist`（运行时产物）。
- 新增公开入口/门面必须同步
  `scripts/guards/agent-package-boundary-guard.rules.ts`。

## 防回潮检查点（来自审计的教训）

写测试/守卫时优先覆盖这些历史踩坑模式：

1. **同名双实现**：同一个导出名出现在两个文件（守卫可按符号名扫描重复定义）。
2. **裸 spread ToolContext / workspaceService 兜底**：host 工具 `{ ...context`
   与 `context.workspaceService ?? new WorkspaceService(...)` 模式由
   `PLUGIN-GUARD-03/04` 拦截；workspace/resource 工具必须走
   `ensureWorkspaceServiceToolContext()`。
3. **host import 插件**：通用 host 生产代码编译期 import `@plugin/<id>/*`。
4. **模块单例存运行态**：插件 enabled 相关的模块级可变量。
5. **清单漂移**：工具名三处清单、版本四处拷贝、IPC 声明↔实际注册、agent
   `requiredSkills` ↔ 随包 skill 资源——一律加契约测试。官方插件禁止再用旧
   `ipcChannels` / `ipcRegistrars` 双字段，`PLUGIN-GUARD-05` 会拦截。
6. **Host 旧白名单**：workspace/read/create/reference/pageContext 里出现
   `document/mindmap/sheet` 这类封闭插件文档集合时，优先写 fake
   plugin 回归测试证明新增 docType 无需改 Host。
7. **插件 ID 特判**：商店图标、默认名称、AI
   fence、workspace 引用、工具卡显示不能出现 `pluginId === 'slides'/'mindmap'`
   的业务特判。已有图标 fallback 走 manifest/meta，文档 UI 走 document type
   registry。

## 历史回归与平台测试

- 启停收缩有现成样例：`enabled-runtime` 相关测试（工具 schema 收缩）、builtin
  manifest 一致性测试。
- 升级/回滚/卸载语义测试参考各插件 `db-ownership` / 升级回滚测试；`ownedTables`
  声明缺表必须 fail-fast，不能在备份层静默跳过。
- 生命周期 active 指针测试参考
  `activatePluginVersionWithMigrations.test.ts`、`reconcilePluginActiveVersions.test.ts`、`diskPluginLoader.test.ts`。重点不是“能安装一次”，而是崩溃/写失败/加载失败后还能恢复到单一事实。
- 平台级缺口（in-flight run 启停、安装并发互斥等）进入
  [README · 已知限制与 Backlog](../README.md#已知限制与-backlog)
  或对应领域设计文档，修复时同步补平台测试。
