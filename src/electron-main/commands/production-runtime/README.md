# Electron Command Production Adapter

## 1. Desktop Host 适配层

本目录不再拥有 Commands 组合根。唯一业务组合根位于
[`src/app-hosts/linnya/adapters/commands/production-runtime`](../../../app-hosts/linnya/adapters/commands/production-runtime/README.md)。
这里是旧 Electron Utility 物理 adapter 的集成测试装配，不属于当前 Desktop App production 启动链。
真实生产由 headless App Server 注入 Node runner、审批/卡片 owner、Shell 环境事实、Plugin CLI 路径和
construction policy。保留本装配只用于平台 transport 对照门禁，不能新增业务能力或重新接回 App lifecycle。

组合根只做依赖注入和生命周期顺序，不能把授权规则、cwd 校验、终态计算或 Renderer 文案塞进来。

## 2. 生产 scope 内容

```text
construction policy
permission settings authority
approval/control hosts
conversation directory/admission ports
command execution owner
runner process port
pipe/PTY output sessions and text sinks
audit writer
shell/process tool runtime
agent command projection
```

App Host scope 必须只创建一个 command owner、一个 permission authority 和一套 ToolOutputStore。重复创建会造成同一个 handle 被两个 owner 解释、审批事实分裂或输出重复写入。

headless App Server 已是唯一 production composition；Electron 与 App Server 不得同时创建 owner。

## 3. 构造策略

平台、可执行入口、Utility 路径、native loader、容量和 timeout 由 construction policy 冻结。route、renderer payload 或单次 tool call 不能覆盖这些生产约束。构造失败要在工具注册前暴露，避免 UI 看见可调用工具但第一次执行才崩溃。

## 4. App 生命周期

创建 scope 后注册 command tools；App end 时先让 owner 停止活动 execution，再 drain approval、audit、output 和 runner transport。窗口关闭确认不应直接操作 scope 内部对象。

## 5. 测试门禁

`createElectronCommandProductionScope.integration.test.ts` 要验证真实工具注册、root/child Agent 共享 owner、权限 authority 注入、approval/control 接线、App end 和 conversation deletion。新增 adapter 必须在 App Host 组合测试确认没有第二套进程或输出体系。
