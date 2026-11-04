# CLI 原始响应验收外壳

此开发入口只装饰公开 `PluginBackendContribution.pluginCli`，为隔离的真实验收任务保存被 Shell 管道过滤前的原始 Backend CLI 响应。不进入生产源码或正式插件制品，不修改 Core bridge，不补写历史成功，不再次调用 CLI、Worker 或读取 ops 载荷。原始 stdout/stderr 可能包含验收文档内容，只能在专用验收 profile 使用；证据目录独占创建为0700，原件文件0600，不公开上传。

`observeCanvasPluginCli` 只替换 contribution 的 pluginCli。原 prepare 与 plan.execute 各调用一次，分别保留原 this、输入对象、Host context、signal、access 引用、execute返回的Promise、result 对象与同步/异步异常对象；其余 contribution（包括 runtimeEffects）逐引用相同。prepare completed 没有冻结执行身份，明确保存为 unattributed；execute 只记录公开 context 的 conversationId、agentRunId、projectId，缺字段保持 null，不从配置或 argv 推测。输入身份只保留 invocationId、已知 Canvas 子命令、workspace 定位与会话根内的 ops 相对路径；不保留搜索词、未知参数、外部路径、凭据、hostContext、环境或文件内容。相对路径只证明本次 argv 的词法位置，不证明载荷字节或历史文件内容。

响应保留完整 exitCode/stdout/stderr 原字符串，用 JSON 可逆编码，不解析或重新生成 CLI JSON。异常只记发生阶段，不复制异常消息或栈；业务仍抛出原对象。同步独占写不引入新队列或生命周期 owner；观测 I/O 失败只使 session partial，不能改变原业务返回或异常。同步 I/O 会占用 AppServer/eventloop，可能延迟 SSE 与 commit→draw，因此必须标记“带观测外壳的实际任务、保守延迟”，不能作为无观测 Native10/40 性能基线。

wrapper 只注册一次 process exit 同步 seal。session 的 PID 必须对应本次实际 Backend，不能取旧进程证据。seal 必须存在、exitCode 为0、writeFailed=false、无 pending，且其列出的文件/字节/哈希齐全，才有完整 session 资格；硬 kill、缺 seal、未执行 ready plan、在途执行或写失败均不能宣完整。Host 拒绝权限后不执行 plan 的结果不在此公开合同内，外壳保留 awaiting-execute，不猜测权限门禁结论。seal 不是业务保存回执，也不证明模型实际看过响应；实际模型 run/工具轨迹与 UI 事实仍另行核对。

`run.ts REQUEST.json` 仅 CPU 准备独立开发制品。request 提供 productionPluginDirectory、outputDirectory、evidenceDirectory、productionSourceRevision、observationSourceRevision；目录必须 fresh，evidenceDirectory 为绝对路径且父目录已存在。两个 revision 是操作者提供的编译来源，必须另附原官方 build 日志/冻结源码证明，不能单靠输入字符串当来源证据。入口为 `pnpm exec tsx --tsconfig packages/plugins/canvas/dev/agent-evaluation/cli-observation/tsconfig.json packages/plugins/canvas/dev/agent-evaluation/cli-observation/run.ts REQUEST.json`。

构建复制 plugin.json、完整 dist 和 resources，逐文件记录原件/目标路径、字节与 SHA256。原 index.cjs 字节不变改名为同目录 index.production.cjs，避免生产模块的 __dirname 与 Worker/资源路径漂移；wrapper 的 typed 原源入口由唯一 esbuild resolve 规则外置到此 CJS，不重复 bundle 生产 backend。其他模块导出由 export-star 保留，包括原 createCanvasBackendPlugin 工厂。实际 Host disk loader 优先选择 named backendPlugin，不调用工厂。build manifest 保存 wrapper SHA、原 Backend SHA、原件映射 SHA 与 metafile；compiled payload 映射全部复核，不把外壳 index 冒充原 index 未变。

安装必须在专用 App 正常退出后另行明确授权。先核实际安装目录、原 index 和完整编译载荷哈希/来源，保存原件及安装清单；只将已审 wrapper 与 byte-exact index.production.cjs 放入原 backend 目录，其他载荷不动。启动后核实际 Host 已选择该 named contribution、原 Backend SHA、session 身份与其余入口/资源路径。结束任务后正常退出取得 seal，再核全部原件哈希；回滚只恢复原 index 字节并移除本次独占 sidecar，核其余文件哈希与原清单一致。没有独立安装授权不得操作运行中的 Editor 或现有插件目录，不能以开发包复制代替用户验收。
