# 17 · 重型插件开发进阶

本指南面向「依赖宿主重型基础设施」的插件（隐藏窗口、子进程 sandbox、CPU 密集编译、大体积引擎、自有重型 renderer）。标准插件开发流程按 [章节指南](../README.md#章节导航开发啥看啥) 走；本指南只补充重型场景特有的设计模式与踩坑清单。

> 参考实现（仅供对照，规则本身与具体插件无关）：
> - **轻型插件样例**：引擎在 renderer、JSON 持久化、无主进程重型设施的最小实现。
> - **重型插件样例**：backend 重引擎 + 主进程沙箱 + 自有预览的完整实现。
> - **重型插件实施案例**：现行实现与边界参考 [Slides 插件说明](../../../packages/plugins/slides/README.md)；旧的分阶段执行归档不在仓库内。

---

## 0. 轻型插件 vs 重型插件

- **轻型插件**：业务逻辑在 renderer、持久化是结构化数据读写、只走 IPC、不碰主进程重型基础设施。标准章节指南基本够用。
- **重型插件**：依赖主进程的危险/重型运行时（隐藏 BrowserWindow、子进程沙箱、重编译引擎、大体积资源）。标准章节的契约都成立，但还需要本指南的能力归属、传输层、平台门面、执行适配器等模式，否则容易把危险运行时塞进插件包、把进度误判成「搬目录」。

---

## 1. 核心原则：危险通用运行时留 host，专属载荷进插件

重型插件最容易踩的坑，是把「危险且通用的运行时」也塞进插件包，导致：

- 插件要自己管 BrowserWindow / 子进程生命周期 → 极易泄漏、难释放。
- 每个重型插件各写一套，不可复用。
- 构建产物巨大、热加载风险高。

**正确切法**——按这张表判断每个依赖该放哪：

| 依赖性质 | 归属 | 例子 |
|---|---|---|
| 通用、危险（持有 OS 资源/进程/窗口）、可被多个插件复用 | **host 平台能力 + port** | 代码沙箱运行时、隐藏 renderer worker 托管、通用文本测量 |
| 插件专属的业务载荷 | **插件包内，经 port 注入** | 插件专属 sandbox profile、专属测量输入/prewarm、业务引擎 |
| 已有现成插件平台设施 | **直接复用** | DocumentTypeHook、ownedFileTypes、pluginRuntimeState、文本快照、IPC 通道、migration 框架 |

判断口诀：**「这东西换个插件还会要吗？它持有危险资源吗？」**——两者皆是 → host 通用能力；否则 → 进插件包。

---

## 2. 传输层：什么时候用 IPC，什么时候 push 事件

- **请求-响应**（绝大多数）：用 `plugin:invoke(pluginId, channel, payload)`（`src/plugin-sdk/renderer/pluginIpcClient.ts` + `pluginIpcRuntime.ts`）。主进程自动校验「已安装且启用」，顺带拿到卸载门禁。
- **二进制**（上传/导出）：IPC 结构化克隆原生支持 `ArrayBuffer`/`Buffer`，前端 `File.arrayBuffer()` 进、后端 `Buffer` 出，无需 multipart。**记得加体积上限**。
- **增量/流式推送**（边算边推进度）：`invoke` 做不到，用 `webContents.send(channel, payload)` + 前端 `ipcRenderer.on`（仓库内既有先例：`transcription:progress`、`task-status-update`、`kb-graph-progress-updated`）。channel 要进 preload 白名单 `src/electron-main/preload/valid-channels.ts`。
- **真 token 级长流**（如对话 SSE）：目前仍走 localhost HTTP SSE（`flow.router.ts`），不是 IPC。绝大多数插件用不到。

### 关于「IPC 会不会堵」的事实

- 在 App Server cutover 完成前，插件 backend 与 host Express **仍跑在 Electron Main 同一事件循环**。换 IPC 不会比 HTTP 更堵，瓶颈是同步 CPU 重活所在的事件循环，与传输层名字无关。
- 大 payload 一次性结构化克隆 vs `JSON.stringify` 量级相当，KB–MB 级不是瓶颈。
- 物理搬包 **≠ 进程隔离**：插件 backend 被加载到哪个业务 owner，才决定它占用哪个事件循环。目标态只加载到 headless App Server；同步 CPU 工作还必须进入 feature-owned Worker，不能只从 Main 搬到 App Server 后继续阻塞 Agent/SSE。
- 重型插件应该把 compile / parse / export / render-model build 这类重活包在 feature-owned execution port 后面（见范式 D）。Slides 已使用有界 Node Worker；这不是新的公共插件 compute 接口。

---

## 3. host 能力接入机制（编译期 + 运行时两层）

- **编译期**：插件 `tsconfig.json` 用通配符 `paths` 把 `@plugin/backend/*` / `@plugin/renderer/*` 映射到契约真源包 `@linnya/plugin-host-contract`，让插件包能独立 typecheck/构建。**不再使用 `hostImports.d.ts` 手写桩镜像 host 类型**（这类桩已删，并有 `packages/plugins/__tests__/host-types-contract.test.ts` 守卫禁止复活）；`host-types/` 只保留 renderer 环境声明或插件自有引擎 ambient（如 sheet 的 `sheetEngine.d.ts`）。
- **运行时**：插件生产代码 import `@plugin/backend/*` / `@plugin/renderer/*`（在构建里 external），磁盘加载时由 host 的 `backendHostModuleResolver`（`src/electron-main/plugins/loader/backendHostModuleResolver.ts`）注入真实实现；SDK 门面 `src/plugin-sdk/backend/*` re-export 或薄包装 host 实现。
- **DB/workspace**：host 把服务容器注入 IPC registrar，插件内 `databaseService.getDb()` + `WorkspaceService`。`better-sqlite3` external，复用 host 已加载的原生模块。

**纪律**：插件运行时绝不直接 `import 'src/electron-main/...'`，一律走 `@plugin/*` port。新增门面的完整接入口径（五件套）见 [11 宿主平台门面](./11-host-facades.md)。

---

## 4. 新增 host 平台能力的范式

当重型插件需要 host 提供新的危险运行时，按这些范式抽 port：

### 范式 A：子进程运行时 + profile 注册

- host 持有通用运行时（`node:vm` + `child_process.fork`），runner bundle 由 host 构建分发。
- 插件通过「profile 注册 port」注入专属配置（globals、capability、回收策略）。
- 禁用插件 → profile 注销，运行时本体不受影响。

### 范式 B：隐藏 renderer worker 托管

- Desktop Host 提供「托管一个由调用方提供 bundle 路径 + IPC 协议的隐藏 BrowserWindow」的通用能力，负责 spawn / 健康检查 / 空闲回收 / 禁用与卸载时安全释放。
- Backend 插件继续只通过既有 `@plugin/backend/hiddenWorkerRuntime` 和 `hiddenWorkers` contribution 使用该能力；SDK 门面落到 `BackendHiddenWorkerRuntimePort`，不得 import `electron-main`。Backend runtime 保留 contribution、codec 与同步 registry，只把 data-only worker descriptor 和已编码 envelope 交给 `DesktopHiddenWorkerHostPort`；当前低层 adapter 由 Electron 实现，App Server cutover 后由 reverse Desktop RPC 实现这个低层 port，插件 API 与前端交互不变。RPC server 必须对 worker HTML/preload artifact 路径做 admission。
- 只有当 worker 载荷确实是插件专属时，才由插件提供专属 worker bundle（在 renderer 环境跑只能在浏览器跑的库）。通用能力（如纯文本测量）应判定为平台能力留 host，对应 worker 也留 host；`hiddenWorkers` contribution 保留给真正自带 worker 的插件。
- 生命周期红线：禁用插件后 worker 不被无谓拉起；卸载时窗口必须安全 close，不泄漏。

### 范式 C：运行态副作用挂载

- 插件需要启用时装配、禁用时释放的全局副作用（例如把 adapter 装进 host 级 facade）应声明为 backend contribution `runtimeEffects`。
- `activate` / `deactivate` 必须幂等，并且只做生命周期装配，不夹带业务计算。
- 不要把这类副作用放进 IPC registrar：registrar 只注册 channel handler，启动期可能为了建立白名单而加载所有已知插件，不能代表插件当前 enabled 状态。
- 如果副作用持有 worker、timer、cache 或全局 adapter，`deactivate` 必须释放到禁用后不可见的默认态。

### 范式 D：重型引擎执行适配器（为未来性能优化预留）

当插件有 CPU 或内存较重的业务引擎时，不要让 tools / IPC handler / workspace hook / renderer 直接调用 compiler、assembler、parser 等内部类。推荐在插件包内定义 engine execution adapter：

- 第一版 adapter 可以是 in-process，直接调用当前引擎。
- 未来如果要改成 utilityProcess / worker / 子进程，替换 adapter 实现即可。
- adapter 输入/输出必须是可序列化 DTO，不能传 DB 连接、host service、函数闭包、窗口对象或 class instance。
- 长任务字段要预留 `jobId` / `traceId` / operation name / timeout / cancel token / progress event。
- 持久化留在 orchestration：引擎计算结果，编排层保存 DB、写快照、更新 workspace 状态。
- 边界守卫要禁止插件外部 import 引擎内部类，也要禁止插件内部绕过 adapter 调重型实现。

这不是要求每个重型插件第一天就多进程化，而是让未来性能优化有路可走。

### 范式 E：插件给通用 ToolContext 挂私有运行时绑定

当插件工具需要在通用 `ToolContext` 上挂运行时对象（coordinator、lazy provider、目标解析器），不要让通用 host 工具反向 import 插件包。用平台机制：

- 插件通过 backend contribution 的 `toolContextDecorators` 贡献执行期装饰器：`decorate(context, params)` 只在 `toolNames` 列出的工具执行前调用，把私有绑定存进 `WeakMap<ToolContext, ...>` 或非枚举属性，不污染通用 `ToolContext` 公开字段。
- 关键陷阱：宿主工具常会派生 context（如 `{ ...context, workspaceService }`）。`{ ...context }` 复制不出 WeakMap / 非枚举绑定，绑定就丢了。**正确解法是平台提供「派生 context」入口**（`derivePluginAwareToolContext`）：它复制 runtime 隐藏绑定，并遍历所有 enabled 插件的 `toolContextBindingMigrators[].migrate(source, target)`，由插件自己迁移私有绑定。
- 红线：通用 host 工具（write/edit/create 等）永远不得编译期 import 某个插件包。曾出现过 host 工具因 context 被 spread 丢绑定、临时 import 插件包 helper 续命的旁路——这是被禁止的，必须由平台派生入口替代。这条对任何「需要在通用工具上下文里挂插件私有依赖」的重型插件通用。

### 范式 F：standalone CLI + Agent Shell thin client

本节是边界摘要；标准开发流程、迁移顺序和验收清单以 [21 插件 CLI 与宿主受控执行](./21-plugin-cli.md) 为准。

插件确实需要给人、CI 和 Agent 复用同一领域能力时，应让两种 adapter 复用插件 orchestration，但不能
让 Agent 通过 Shell 启动 standalone Electron CLI：

- 人和 CI 的独立 CLI 由 manifest `entry.command` 定位，拥有自己的 Electron/Node 启动、显式 DB/output 参数和 packaged smoke。
- 官方内置插件通过 backend `pluginCli` contribution 向 Agent facade 暴露 opaque argv；host 不解析业务参数，
  但严格校验 internal data、conversation write、external files、network、GUI 和 local IPC access plan。
- Agent 的 `shell` 启动极小 native client，client 通过 execution-scoped bridge 在当前 App 内复用 DB、
  coordinator、hidden worker；PID/process handle、owner 容量和停止屏障全部属于父 Shell，插件 draining
  必须取消并等待 invocation 后再卸载资源。
- Agent 产物只能写 conversation 管理目录，再用 `read_file` 读取。插件字段留在 Skill、parser 和领域实现。
- standalone 查询命令只装配只读 projection 与必要的 engine/query slice；不要因现有 coordinator 恰好暴露
  同名方法，就把作者工具链、编译器和 workspace 全量门面打进 command artifact。此类入口应同时用 raw
  byte budget 与构建依赖图守卫边界，避免动态 import 造成“启动变快但制品未减重”的假优化。

这套 bridge 也不把任意 Bash 变成受信插件调用。只有 Host 安装的 facade 能取得父 execution 的内部 token；
bridge 只寻址 enabled 官方插件，且 v1 明确拒绝外部文件、网络、GUI 和本地 IPC。不要用普通 executable、
用户环境变量或 plugin ID 特判绕开这条能力计划。

---

## 5. 重型插件落地的推荐阶段顺序

经验证的安全顺序（前轻后重、先收益后搬迁）：

1. **传输层统一**（如 HTTP→IPC）：独立、低风险、顺带拿卸载门禁。
2. **逻辑插件化**（hook + 运行态门禁 + agent/tool 收口 + 前端 enabled-aware）：用户可见收益最大。
3. **DB 归属归位**：先搞清表的真实来源和建表时机，再决定要不要收养迁移。
   - 关键判据：**谁在什么时候建表？** 已有旧库仍先执行冻结的核心历史迁移，再进入 `bootstrapBuiltinPluginLifecycle`，所以插件 migration 需要收养旧表；全新库则由当前 host schema 直接落当前版本，不重放历史迁移，插件 owned tables 只能由当前插件 lifecycle 建立。两条路径必须分别验收。
   - 真正需要收养迁移的，是表**只在插件侧建、且核心从不建**、又要接管已有真实数据的场景。
   - 无论哪种，`ownedTables` 都要声明（驱动升级备份/卸载不删表/运行态门禁）。
   - 出生在核心历史的表通常会留下胎记：建表 DDL 永久留在核心迁移历史里，物理抽包也搬不走它。这是和「天生插件原生」表的根本差异。
   - 例外窗口：如果可以证明生产库从未应用过相关核心迁移，可以在物理抽包阶段保号掏空历史迁移，并把建表移交插件，从而达成真·插件原生；一旦生产发布跨过该迁移窗口，就必须退回「留胎记」方案。
4. **平台能力补齐**（把主进程基础设施做成通用 port）：物理搬迁的前置。
5. **物理外置 + 发布**（抽包、构建、R2、边界守卫）。

**1–3 完成只是中间验收点，不是终点**：用户视角已是真插件，引擎物理上还在 host。若目标是彻底插件化，阶段 4–5 也必须完成：先把危险 host 能力抽成通用 port，再把插件专属载荷物理外置并独立发布。

---

## 6. 物理外置的进度口径（方法论）

重型功能的物理外置阶段最容易被严重低估——常误以为「前几阶段做完，剩下只是把目录 `mv` 进包」。实际工作量远超预期。复盘出几条必须先讲清的方法论，否则后续重型插件会重复误判：

1. **运行时解耦 ≠ 编译期解耦**。逻辑插件化做的是「运行时」解耦：用户看起来已是插件（启停、IPC、hook、agent 收口）。但代码里大量 `import` 仍跨 host↔plugin 边界——shared 承重契约、host 工具旁路、renderer store 耦合。编译期解耦（断这些 import、下沉 shared、删 host 旁路）几乎全压在物理外置阶段。两者是两轮工作，scoping 时必须分开估。
2. **进度按「消掉的跨边界耦合边」算，不按「搬了几个文件」算**。「包里有一份代码」不是终态；只要 host 生产路径还能 import 插件旧入口、还能 new 出插件 coordinator、还能注册插件 UI，就没完成。维护一张「剩余耦合账本」（还没删掉的入口 + 删除标准），比维护文件搬迁清单更能反映真实进度。
3. **拆分子阶段：编译期解耦 → 物理搬迁 → 构建发布守卫**。顺序硬约束：
   - **编译期解耦**：下沉 shared 承重契约，删会绕过启停/卸载语义的 host 旁路。退出标准：host 生产代码无跨边界值 import；禁用/卸载后无新建/写入插件文件、无 coordinator 注入、通用平台能力不被误卸载。
   - **物理搬迁**：把 engine/tools/IPC/agent/skill/sandbox profile/renderer 物理搬进包。先 backend runtime，再 renderer，最后才动发布。
   - **构建发布守卫**：manifest、artifact、R2、本地安装/启停/卸载/升级 smoke、root 脚本/依赖/docs、终态守卫。
4. **先拆旁路，再搬大块**。每个切片必须**删除或缩薄对应 host 旧入口**，不能只新增包内副本然后留着旧文件当真实运行入口。先消灭会绕过插件启停语义的旁路（如无条件创建 coordinator、host 工具直连插件实现），再搬 UI 和发布链路。

一句话口径：**重型功能事后插件化，成本主力不是插件机制本身，而是历史耦合债。** 这也是为什么 [00 决策章节](./00-decision.md) 强调「重型功能命中信号就第一天建包」。

---

## 7. 物理外置阶段必须补的终局审计清单

物理外置最后一公里最容易漏的不是「搬某个大目录」，而是各种会绕过插件启停/卸载/升级语义的旁路。进入物理外置阶段时，必须按下面维度做全量审计：

| 维度 | 必须确认 |
|---|---|
| backend contribution | 插件包导出真实 backend contribution，host 只保留薄 re-export；没有长期 legacy bridge。 |
| engine / coordinator | host 不再直接创建插件 engine / coordinator；重活只通过插件内 engine adapter。 |
| tools | tool classes、tool ports、tool tests 归插件；通用 `ToolContext` 不包含某个插件的专属字段。 |
| document hook | create/write/read/VFS/read/grep 只查 enabled hook 或快照；host workspace IPC 不再按插件类型硬编码分支。 |
| IPC | channel 白名单、payload parser、handler、registrar 都由插件 backend 贡献；renderer 只走 `plugin:invoke`。 |
| sandbox / worker / runtimeEffect | 通用危险运行时留 host；插件只贡献专属 profile/worker/effect。通用平台能力不能被某个插件禁用态错误控制。 |
| agent / subagent / skill | prompt、agent definition、subagent type、skill/cookbook 随插件 artifact；禁用/卸载后模型说明和 skill catalog 同步收缩。 |
| renderer | renderer contribution、surface、ports、stores、UI、CSS 都在包内；host renderer 不 deep import 插件 domain。 |
| SDK | 插件需要 host 能力时先补 `@plugin/backend/*` / `@plugin/renderer/*` 窄门面，不能把 host store、workspace gateway 或 shared UI 当内部依赖拖进包；renderer SDK 新增后必须同步 host module provider、`plugin://host` shim 和 `packages/plugins/rendererHostExternalMap.mjs`。 |
| release | manifest、package scripts、release target、extraResources seed、R2 smoke 和本地 runtime smoke 同时覆盖；源码 alias build 不等于可独立安装/升级。 |
| guard | 包边界守卫 `guard:agent-boundary`、`guard:plugin-runtime-dist`（业务符号禁入 dist，覆盖当前 workspace 插件 owner）、`guard:tsc-baseline`；每个过渡 re-export 都必须有退出条件。 |

一个实用判断：如果禁用或卸载插件后，host 仍能从任何生产路径 new 出该插件的 coordinator、调用该插件工具、注册该插件 UI、注入该插件 prompt/skill，或者新建该插件文件格式，那就还没完成物理插件化。

### 重型 renderer 引擎的类型验收分层

当插件携带大体量 renderer 引擎源码（例如 fork 的 canvas/公式/渲染引擎）时，常规 `typecheck` 可以分为两层，但必须写清楚边界：

- `typecheck` 验证插件公开 contribution、SDK 门面、document type、file handler、tool card、page context provider 等稳定接线，不应通过手写大而全的宿主/引擎 ambient 类型镜像来“补齐”历史类型债。
- `typecheck:full` 保留完整 renderer 引擎链路，用来观察和逐步偿还引擎自身类型债；它失败不能被误读为插件 contract 失败，也不能长期被隐藏。
- 分层必须有退出条件：当引擎源码可以被独立 TS/Vue 类型系统完整覆盖时，`typecheck` 应重新收敛到全量配置，删除临时排除。
- 插件包入口不要 `export *` 暴露整个 renderer domain。入口只导出 contribution 和少量稳定契约，否则会把重引擎内部类型图扩散成公共 API。

---

## 8. 物理外置阶段容易漏掉的隐性耦合

实战审计补出过一批「不在大目录里、但会挡住独立安装/卸载/升级」的点。后续重型插件必须提前查：

- **临时 bridge 不能变 SDK**：过渡期可以集中暴露旧实现，但不能长期挂在 `@plugin/backend/*` resolver 下。完成迁移后要删除 resolver 条目，并加守卫禁止再引用。
- **包内实现不要做公开子入口**：persistence 这类实现只能留在插件包内部；host 数据库生命周期通过 `ownedTables` / `pluginMigrations` contribution 协作，不能新增 `@plugin/<id>/backend-persistence` 之类入口绕过插件边界。
- **VFS / read / grep 是文档 hook 的一部分**：source、structure、outline、metadata 规则属于插件文档格式，不能散在 host workspace 工具里。
- **通用 feature 的 barrel 要清掉插件专属导出**：例如 sandbox 的 `index.ts` 如果继续 export 某插件 profile，开发者会误以为这是平台能力。
- **skill 是资源链路，不只是 manifest 字段**：要覆盖 discovery、catalog 注入、`skill(action="read_resource")`、copy/打包、cookbook/typecheck、agent prompt 里的引用和启停门禁。
- **agent 归包不等于模型能力闭环**：prompt/definition 可以先随包，但只要 prompt 里引用的 skill/resource 还在 host builtin 目录，插件升级/卸载语义仍不完整。
- **复制链也会制造资源残影**：如果 host build 仍把插件 skill 复制到 `dist/builtin-skills`，或预置资源脚本没有把插件 artifact 里的 skill 复制进 zip/extraResources，禁用/卸载/升级语义都会失真。
- **root scripts / deps 也要归属**：测试、seed、harness、专属 npm 依赖若还在根目录，就说明 host 仍以第一方业务拥有该插件。
- **docs / contracts 是开发入口**：`CONTRACTS.md`、README、showcases、harness、加字段 checklist 如果仍指向 host 旧路径，下一轮开发很容易把代码加回 host。
- **renderer glue 不应存在**：host renderer 只负责 platform contribution、宿主 port 装配和 runtime loader；具体插件 renderer entry 由 `plugins:renderer-entries` 按 manifest/启用态发现，禁止在 `apps/renderer/app/plugins/builtin/` 为某个插件留一行 re-export。
- **发布 smoke 要覆盖状态语义**：build/package 成功只证明源码能打包；必须额外证明 install、enable、disable、uninstall、reinstall、upgrade、migration rollback、旧数据复用和 missing plugin 引导。
- **测试主体随实现迁包，否则旧目录会变回流入口**：迁实现时把对应测试主体一起迁进包，测试 import 改走包公开入口，fixture 不深 import host。只迁实现、把测试留在 host 旧目录，等于给旧目录续命，下一轮开发又会往那里加代码。
- **每删一个过渡入口，同步把守卫升级为「禁止复活」**：删除旧 host 目录 / bridge / re-export 后，立刻把 boundary guard 从「允许过渡」改成「该路径不得存在 / 任何 import 一律违规」；守卫要跟着迁移进度收紧，而不是迁完才补。
- **重型 backend 不进 Desktop 或 App Server 启动壳**：`main.cjs` 与 `app-server-backend.cjs` 都不静态 import 具体插件，也不维护 `<id>.backend.absent.ts`。真实 backend 只由 App Server 的通用磁盘 loader 加载 artifact。否则启动壳膨胀、嵌入插件语义，「可独立升级」就是假的。

---

## 9. 复用清单（现成、别重造）

1. `DocumentTypeBackendHook`（create/write/read/readVfsContent）
2. `formatOwnershipCatalog` + `ownedFileTypes`（缺失态跳商店）
3. `pluginRuntimeState`（DB 三态 enabled/disabled/missing）
4. `workspace_node_text_snapshots`（卸载后 read/grep 读事实）
5. backend/renderer contribution 注册、enable/disable 收口
6. plugin migration / ownedTables / 升级回滚框架
7. R2 发布、预置 seed、release target 泛化脚本
8. `plugin:invoke` IPC 通道 + 主进程「已安装且启用」门禁
9. SDK 门面 `@plugin/backend/*` `@plugin/renderer/*` + `backendHostModuleResolver`
10. 边界守卫范式（每插件独立命名，勿复用他人测试名）
11. `toolContextDecorators` + `toolContextBindingMigrators` + `derivePluginAwareToolContext`（插件给通用工具上下文挂私有绑定，宿主派生时自动迁移）
12. 平台门面五件套接入口径（SDK 门面实现 / resolver 登记 / 契约包 `@linnya/plugin-host-contract` 新增窄类型 / tsconfig 通配 paths + rendererHostExternalMap / 守卫，见 [11 宿主平台门面](./11-host-facades.md)）
13. 重型 backend artifact 可被 direct/active/bundled 三种通用来源装载，且 Core bundle 中没有插件入口 alias
