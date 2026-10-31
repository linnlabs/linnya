# Windows command account isolation

本 adapter 拥有受限 Shell 的 Windows 执行身份及其生命周期；审批规则仍属于 Commands，内部路径由 App Host 冻结。Windows 10 22H2 x64 是最低支持平台，不依赖新版 Windows 11 的 ProcessContainer 接口。

正式 TypeScript platform launcher 将 1/2 档交给独立账户 native owner，完全访问继续走普通用户 Job owner。两个分支共用进程观察、输出、终端和整树回收合同；受限路径无法初始化时失败，不自动降为完全访问。

## 边界

- 只读、标准执行使用独立账户 SID。不同并发执行不共享账户，批准内部读取的身份也不交给其他调用。
- 首次由 Desktop 引导一次管理员初始化。特权组件只管理隔离账户租约；命令和插件 CLI 始终以受限普通账户运行。
- 完全访问不初始化、不连接账户组件，继续使用普通用户的现有进程 owner。
- 账户密码只经过本机受保护管道和原生内存，不放入 argv、环境、业务凭据文件、诊断或模型结果。
- 权限授予由真实用户执行，不让特权组件接受任意文件路径并以 SYSTEM 身份修改 ACL。
- 普通用户目录的基础读取权在首次初始化授予专用账户组；内部存储仍按每次执行 SID 拒绝，批准不修改共享组。不能每次执行都递归修改整个人员目录。
- 普通 CLI、Node 子进程和本地插件连接必须正常工作。AppContainer 的文件测试通过不能替代这些兼容性测试。

## 生命周期

账户租约绑定 worker Job 和 command Job。Secondary Logon 的进程已有系统 Job，而 Windows 禁止带 UI 限制的嵌套 Job，见 [AssignProcessToJobObject 合同](https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-assignprocesstojobobject)。因此 worker 允许脱离其控制 Job，但真实命令通过 `PROC_THREAD_ATTRIBUTE_JOB_LIST` 在创建时原子加入不允许脱离的 command Job；不能先裸启动再补归属。

worker 交付仍暂停的真实命令 process/thread 句柄，Host 复制后继续使用现有 observer-ready、恢复、根退出和整树回收合同。命令开始前建立文件权限及进程归属，整树结束后撤销权限并删除账户/profile。初始化失败和取消不能改为裸执行。Host 崩溃时，账户组件先结束并观察两个 Job，再回收账户；不能只等待 wrapper PID。

Windows 的 profile 卸载晚于进程退出。服务把实测的 sharing violation 表达为 `ProfileUnloading`，保留恢复记录并继续服务其他租约；完成后才确认释放成功。其他读取/身份/删除错误仍报告失败，不能把错误当成“已经清理”。

文件权限按独立账户 SID 授予；不同执行不会修改或借用对方的 SID。父目录的继承拒绝会被子文件已有的显式 Users 读取许可覆盖，因此保护树逐项应用规则，对当前对话/已批准目录逐项开口。只改根目录 ACL 不能通过验收。Host 用每用户命名 mutex 保护 ACL 更新和恢复日志提交，命令执行期间不持有锁。

ACL 修改意图先写入真实用户的 HKCU 日志，不含账户密码和业务凭据。正常回收先确认命令树与 worker 结束，再撤权并删除账户；Host 崩溃后，服务先销毁执行身份，后续准备清除日志中已删除 SID 的残余 ACL。恢复时只移除对应 SID，不能用旧 DACL 快照覆盖其他并发执行的许可。日志损坏会阻止准备，不当成空状态。

保护根须已存在。Host 在首次创建执行 scope 时建立自己的运行目录；CLI 连接文件按专用父目录保护，保证原子替换的新对象继承限制。当前对话中的 junction/symlink 不沿目标授予权限，真实目标仍遵守自身边界；未声明的内部原始存储 reparse point 拒绝准备，须先明确其实际保护根。

Windows ACL 附着于文件对象：[重命名和移动不会重新分配安全描述符](https://learn.microsoft.com/en-us/windows/win32/fileio/file-security-and-access-rights)。Host 新增内容须在受保护 staging 内创建/复制，再在同一保护范围内发布；禁止直接移动或 hard link 外部对象入库。当前凭据原子写、受管资产、插件安装和 Skill 安装遵守此约束。它不拦截用户或已授权完全访问进程主动改写 ACL，不能把 ACL 边界描述成对所有外部文件系统操作的拦截器。

账户服务不接纳命令文本、可执行文件路径或文件授权列表。调用者须是该实例注册的真实用户，本机管道拒绝远程连接；服务通过内核取得调用者 PID 并核验 token，不能相信请求中的用户名。

pipe 与 PTY 共享账户及文件边界。PTY 保留真实 ConPTY 的输入、缩放、EOF 和进程树语义；不能用普通管道模拟一个已验收的终端。

WinSta 与会话命名对象的基础授权使用专用组 SID，按上游原语保留至 Windows 会话注销。卸载删除该组及所有执行账户后，不再有身份可以使用此 SID；不能把文件 ACL 已清理表述成会话内核对象的 ACE 也已立即移除。

## 初始化、更新和卸载

Desktop 的 typed RPC 只暴露 `ensureReady`。多个首次调用共享一次“启用/取消”提示和 UAC，完成后各命令并行。helper 固定提升自己并在提升前记录原用户 SID；管理员使用其他账户确认时不会错绑用户。

`.node` 与独立 `.exe` 各有版本、架构、哈希及签名清单。helper 静态链接 CRT，因为服务副本位于 Program Files，不能依赖 Electron 目录的 VC runtime。已安装副本不匹配当前版本时重新初始化。

NSIS 覆盖更新保留账户组件；真正卸载调用 helper `disable`。提升阶段先停止进程树、回收账户/profile、撤销注册用户目录的组授权，再删除服务和组。原用户随后恢复 HKCU 中遗留的 SID 授权，SYSTEM 不读取用户可写日志并修改任意路径。取消或清理失败阻止删除应用文件，保留恢复入口；未启用过的用户无 UAC。

卸载前先把 helper 复制到 NSIS 的临时目录再运行，避免已启动的可执行文件影响安装目录删除。普通用户的 NSIS 回归必须包含真实 helper，覆盖首次安装、覆盖更新和未初始化时的完整卸载；已初始化服务及账户的清理另由原生生命周期矩阵覆盖。

## 实现分工

`native` 是不依赖 Node/Electron 的账户协议、特权支持组件与非特权 worker。现有 `windows/native` 继续拥有命令观察、pipe、ConPTY 和 N-API 资源释放；两者只通过账户租约和明确的原生合同协作。服务不会成为通用管理员命令执行器。

原生业务探针位于 `native/examples/account_leases.rs` 与 `native/examples/worker_pipe.rs`，只使用合成凭据。前者覆盖并行身份和显式/断开回收，后者经过实际服务、Secondary Logon、受限 token 和命令 Job，并支持 `pty` 模式检查终端、输入和缩放；这些探针不代替正式 native owner、PTY、初始化 UI 和安装包门禁。

正式 native owner 的合成数据矩阵位于 `scripts/e2e/shell-tool/fixtures/windows-command-isolation/native-owner.mjs`，覆盖两档文件权限、显式子项 ACL、Node 子进程、并行授权隔离、ConPTY 和完整访问。现有 Windows pipe/PTY owner 回归须同时保持通过。
同目录 `platform-launcher.ts` 经过正式 TS 路由、manifest 校验和 PowerShell wrapper；native 矩阵还覆盖取消、Host 崩溃、创建失败、动态写入与恢复。`--raw-move-negative` 是明确预期失败的权限负对照，不计作支持直接外部移动。

Windows 的 SID/token/desktop 原语参考并复用固定版本的开源 sandbox-runtime；不使用它的共享账户与持久读取授权作为并行隔离边界。上游参考为 [sandbox-runtime](https://github.com/anthropics/sandbox-runtime)。

最终验收须包括：两档拒绝/批准/后续未批准、跨会话并发、Host/peer 进程访问、Node 管道、PowerShell、ConPTY、CLI bridge、取消与崩溃回收、完整访问绕过初始化。测试记录须标明实际系统与架构；Windows 10 兼容实现不代表已在 Windows 10 实机验证。
