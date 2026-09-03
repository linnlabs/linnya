# Command Permission Settings

## 1. 这是什么

这个 feature 定义全局命令权限设置，并在一次 Agent 根 run 启动时把设置冻结成不可变快照。Renderer 只能通过 Electron Main 的窄 RPC gateway 读写设置；真正决定当前会话事实的是 App Server 内存 authority，而不是 renderer store 或磁盘文件。

这样做的原因很实际：命令运行几十秒甚至几分钟时，外部程序可能改写设置文件，用户也可能在另一个窗口切换档位。如果 run 中途重新读取，审计、审批和实际进程会出现两套权限事实。

## 2. 代码树

```text
permission-settings/
├── definitions/
│   └── commandPermissionSettings.ts
├── functions/
│   ├── serializeCommandPermissionSettings.ts
│   └── validateCommandPermissionSettings.ts
├── orchestration/
│   ├── readCommandPermissionSettings.ts
│   ├── updateCommandPermissionSettings.ts
│   └── snapshotCommandPermissionSettingsForRun.ts
└── index.ts
```

跨进程 schema 在 `packages/schemas/src/commands/commandPermissionSettings.ts`；不要在 Electron 或 Vue 目录重新定义同名 DTO。

## 3. 持久化字段

`CommandPermissionSettingsV1` 是完整文档：

| 字段 | 当前语义 |
| --- | --- |
| `schema_version` | 当前为 `1`，用于拒绝未知格式 |
| `kind` | 固定为 `command_permission_settings` |
| `revision` | 每次成功更新递增，解决并发更新和旧页面提交 |
| `permission_level` | `read_only`、`standard`、`full_access` |
| `internal_data_access` | `allowed` 或 `denied`，独立开关 |
| `gui_control` | 固定 `denied`；不随权限档或审批开放 |
| `local_ipc_control` | 当前固定 `denied` |
| `process_lifecycle` | 当前固定 `terminate_with_run` |

用户可以修改的只有档位和内部数据开关。固定字段必须原样回写，不能因为某个平台暂时不使用就删除。

## 4. 初始化、更新和异常

### 首次启动

没有初始化 marker 时，读取默认 `standard`、`internal_data_access = denied`，写入完整设置和 marker。默认开启命令工具，但普通命令仍受标准风险规则约束。

### 已初始化后的读取

marker 存在后，文件缺失、JSON 损坏、schema 不匹配或读取失败都返回 `invalid_config`/`read_failed`，关闭新的命令执行。禁止“文件没了就回到 standard”，否则删除配置文件就会变成提权手段。

### 更新

Renderer 提交 `expected_revision`。App Server authority 校验修改字段，原子替换文件，成功后更新内存 revision 并返回完整设置。revision 不一致时返回最新后端值，Renderer 只能让用户重新确认，不能拿旧草稿自动覆盖。

## 5. 运行快照

`CommandRunPermissionSnapshotV1` 至少包含：

```text
protocol_version
kind = command_run_permission_snapshot
root_agent_run_id
settings_revision
captured_at_ms
permission_level
internal_data_access
gui_control = denied
local_ipc_control = denied
process_lifecycle = terminate_with_run
```

根 run 建立后，所有 child tool call 继承同一 snapshot。命令 proposal 再把它投影成绑定 `execution identity` 的 `CommandPermissionSnapshotV1`，不能混用两个生命周期的 DTO。

## 6. 与界面的关系

权限档位在全局设置页选择后立即生效，不需要保存按钮。切换到 `standard` 或 `full_access` 时由 UI 展示风险说明和确认动作，但风险文案不是授权事实；App Server authority 仍按 schema 校验。

Renderer 不传路径、revision 以外的内部字段，不直接读文件，不决定“是否已写入”。页面刷新后以 Main 返回的 settings 为准。

## 7. 安全和维护风险

- 内存 authority 是会话内唯一事实源；任何命令前重新读文件都是错误。
- 文件原子替换成功、marker 写入失败时，必须保留失败结果并记录上下文，不能报告成功。
- 设置文件路径由 Desktop Host 在 bootstrap 中冻结，App Host adapter 负责原子持久化；domain 不假定具体 appData 目录。
- `full_access` 只是“不再询问”，不是 OS 文件沙箱；产品页面必须明确网络、外部 CLI、系统设置和数据泄露风险。
- `full_access` 不能改变 `gui_control = denied`。GUI 禁止需要平台执行边界与直接/间接 launch fixture 共同证明，不能只依赖设置字段或命令词法扫描。

## 8. 测试门禁

`commandPermissionSettings.integration.test.ts` 覆盖默认初始化、完整字段、坏配置和 run snapshot；App Host authority 集成测试覆盖原子写入、revision 冲突和外部改写不影响当前 session，Main IPC 边界测试覆盖 sender 校验与 RPC gateway。GUI control 还必须由 macOS/Windows production execution E2E 覆盖直接调用、解释器间接调用和自定义二进制，设置 schema 测试不能替代平台 enforcement。新增设置字段时必须同时更新 schema、序列化、RPC port 和设置页读取投影。

## 9. 相关文档

- [授权规则](../command-authorization/README.md)
- [App Host authority](../../../../app-hosts/linnya/adapters/commands/permission-settings-authority/README.md)
- [Renderer UI 使用指南](../../../../../packages/renderer-ui/docs/usage-guide.md)
- [命令执行总览](../../../../../docs/command-execution/README.md)
