# CLI 原始响应验收外壳

此开发入口只装饰公开 `PluginBackendContribution.pluginCli`，为隔离的真实验收任务保存被 Shell 管道过滤前的原始 Backend CLI 响应。不进入生产源码或正式插件制品，不修改 Core bridge，不补写历史成功，不再次调用 CLI、Worker 或读取 ops 载荷。原始 stdout/stderr 可能包含验收文档内容，只能在专用验收 profile 使用；证据目录独占创建为0700，原件文件0600，不公开上传。

`observeCanvasPluginCli` 只替换 contribution 的 pluginCli。原 prepare 与 plan.execute 各调用一次，分别保留原 this、输入对象、Host context、signal、access 引用、execute返回的Promise、result 对象与同步/异步异常对象；其余 contribution（包括 runtimeEffects）逐引用相同。prepare completed 没有冻结执行身份，明确保存为 unattributed；execute 只记录公开 context 的 conversationId、agentRunId、projectId，缺字段保持 null，不从配置或 argv 推测。输入身份只保留 invocationId、已知 Canvas 子命令、workspace 定位与会话根内的 ops 相对路径；不保留搜索词、未知参数、外部路径、凭据、hostContext、环境或文件内容。相对路径只证明本次 argv 的词法位置，不证明载荷字节或历史文件内容。

apply/arrange 另外记录明确的 requestId 与 dryRun 参数事实。requestId 支持独立token与等号形式并保原字符串；重复、缺值、可能被前一选项消费或带值的dry-run均标ambiguous，不从领域parser错误或响应倒推输入，也不trim/normalize。`--`后不是选项，其他命令为not-applicable；无dry-run选项只说明该输入没有此标记，不自行证明命令通过校验。专属Canvas外壳缺pluginCli会明确拒绝开发预装载，安装资格必须通过实际Host CPU加载证明；打包成功不等于装载资格成功，不回退到无观测原贡献。

响应保留完整 exitCode/stdout/stderr 原字符串，用 JSON 可逆编码，不解析或重新生成 CLI JSON。异常只记发生阶段，不复制异常消息或栈；业务仍抛出原对象。同步独占写不引入新队列或生命周期 owner；观测 I/O 失败只使 session partial，不能改变原业务返回或异常。同步 I/O 会占用 AppServer/eventloop，可能延迟 SSE 与 commit→draw，因此必须标记“带观测外壳的实际任务、保守延迟”，不能作为无观测 Native10/40 性能基线。

wrapper 只注册一次 process exit 同步 seal。session 的 PID 必须对应本次实际 Backend，不能取旧进程证据。seal 必须存在、exitCode 为0、writeFailed=false、无 pending，且其列出的文件/字节/哈希齐全，才有完整 session 资格；硬 kill、缺 seal、未执行 ready plan、在途执行或写失败均不能宣完整。Host 拒绝权限后不执行 plan 的结果不在此公开合同内，外壳保留 awaiting-execute，不猜测权限门禁结论。seal 不是业务保存回执，也不证明模型实际看过响应；实际模型 run/工具轨迹与 UI 事实仍另行核对。

`run.ts REQUEST.json` 仅 CPU 准备独立开发制品。request 提供 productionPluginDirectory、outputDirectory、evidenceDirectory、productionSourceRevision、observationSourceRevision；目录必须 fresh，evidenceDirectory 为绝对路径且父目录已存在。两个 revision 是操作者提供的编译来源，必须另附原官方 build 日志/冻结源码证明，不能单靠输入字符串当来源证据。入口为 `pnpm exec tsx --tsconfig packages/plugins/canvas/dev/agent-evaluation/cli-observation/tsconfig.json packages/plugins/canvas/dev/agent-evaluation/cli-observation/run.ts REQUEST.json`。

构建复制 plugin.json、完整 dist 和 resources，逐文件记录原件/目标路径、字节与 SHA256。原 index.cjs 字节不变改名为同目录 index.production.cjs，避免生产模块的 __dirname 与 Worker/资源路径漂移；wrapper 的 typed 原源入口由唯一 esbuild resolve 规则外置到此 CJS，不重复 bundle 生产 backend。其他模块导出由 export-star 保留，包括原 createCanvasBackendPlugin 工厂。实际 Host disk loader 优先选择 named backendPlugin，不调用工厂。build manifest 保存 wrapper SHA、原 Backend SHA、原件映射 SHA 与 metafile；compiled payload 映射全部复核，不把外壳 index 冒充原 index 未变。

安装必须在专用 App 正常退出后另行明确授权。先核实际安装目录、原 index 和完整编译载荷哈希/来源，保存原件及安装清单；只将已审 wrapper 与 byte-exact index.production.cjs 放入原 backend 目录，其他载荷不动。启动后核实际 Host 已选择该 named contribution、原 Backend SHA、session 身份与其余入口/资源路径；Host有自己的失败版本回滚，App启动成功不能代替本次外壳装载资格。结束任务后正常退出取得 seal，再核全部原件哈希；回滚只恢复原 index 字节并移除本次独占 sidecar，核其余文件哈希与原清单一致。没有独立安装授权不得操作运行中的 Editor 或现有插件目录，不能以开发包复制代替用户验收。

`readSealedCanvasCliObservation` 是此 owner 的只读封存入口。它接受目录与可信安装 activationFile，不接受模型提供的身份或性能数值。activation 必须来自实际正常启动后的 Host 装载核对，绑定 Backend PID、原编译 Backend/外壳/全载荷映射 SHA、准备包与证据目录、正式生产 build 见证及其 SHA。build 见证包含真实命令、成功退出、日志文件/SHA、干净源版本、对应原编译 Backend SHA，以及已归档的 producer 源文件目录；这些由可信构建/安装 runner 采集，不能手填配置字符串冒证明。

读取器重新核验全部 seal 文件字节与 SHA，解析同一份已验字节，要求调用阶段、事件编号、时钟、终态和完整计数闭合；再核原编译模块、wrapper、全部原载荷映射、正式 build 日志与六个已审 producer 源文件指纹。当前固定源与指纹在 `definitions/sealedObservation.ts`；未知新源不会自动放行。公开 DTO 留在 `definitions.ts`，没有 SQL、ops 载荷读取、业务重放或 Worker 调用。

在这一强源合同下，executeCanvasCliWrite 的完整 committed 响应只有明确 replayed=false 且 computation=null 才能证明本次没有 prepared.arrange：其有 arrange 分支必 await 正式 Worker，Worker response schema 强制非 null computation，即使布局 unchanged 也保留计时。该 iff 只适用于已核原 producer 和真实编译 SHA；缺字段、receipt、重放、dry-run、pending、失败或未知响应不能套用。后续源必须另审与已核 producer 的字节关系，不能扩大成任意版本 null 的默认语义。

App级 [N0 装载验收入口](../../../../../../scripts/e2e/canvas-cli-observation/run.ts) 只提供固定 prepare/launch 两步。prepare 的请求合同见其相邻 definitions；它核对已有正式 source61 build 成功原件、完整编译哈希、干净冻结源码及六份 producer，复制独立制品和无旧桥标签的既有生产 Renderer，再通过真实 Host disk loader 核 compiled-module 引用。CPU预装载与实际App使用不同外壳和证据目录，不能消耗后复用同一路径。新的产物目录必须不存在，不触碰原编译包、运行数据或已配置模型。

只有拿到独立原生窗口时才运行 launch。它沿用 parallel-desktop gate 的正式 Main、instanceRoot 与进程归属观察机制，使用 fresh profile 和 direct artifact；不挂画布、不调用模型或 CLI、不制造执行context。实际 loader 日志、Backend PID及session闭合后写 activation，等待真实 CmdQ；正常退出、完整 seal 和所有后代退出后才调用读取器，要求 invocations=0，随后仅恢复安装副本的原index并移除自己的sidecar，逐项复核原载荷。只读封存用的 prepared artifact 保留完整原外壳，不随安装副本回滚。

此N0仅证明实际装载、封存和回滚，不能证明CLI execute、模型run归属或T13性能。正式build证书保留原日志明确打印的build子命令；原成功见证文件的mtime只是完成时间的保守上界，原见证另行完整保留。启动失败或信号退出保留partial，不生成通过结论；不将程序关停代替原生正常退出。
