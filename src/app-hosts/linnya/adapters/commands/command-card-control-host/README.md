# Command Card Control Host

## 责任

control host 是 App Server 中命令卡片的用户控制入口，负责取消和受保护 PTY 输入。它只验证 host 签发的 opaque ticket，再转发给唯一 command owner；它不是第二个 process manager。Electron Main 只验证真实 Renderer sender 并转发稳定 DTO。

## Ticket 合同

ticket 绑定 conversation、execution、允许动作和有效期/消费状态。Renderer 不传 PID、owner generation、Job、PGID 或 native handle。一次性动作消费后不能重复使用，重复请求返回稳定 rejection。

## 结果语义

IPC handler 返回“动作已被 owner 接受/拒绝”，不把 IPC 成功误报成进程已经停止。真正的 stopped/completed 仍来自 owner 的五事实终态。受保护输入使用独立 ticket，消费后不能重放秘密正文；其他 PTY control 继续由现有 Process runtime 合同处理。

## 关闭收口

App owner end、页面销毁和 conversation deletion 会停止接收新动作、清理 listener、drain 已接受控制请求并清除 ticket。任何 listener 都必须在成功、失败、owner end 三条路径通过 `finally` 清理。

## 测试

`commandCardControlHost.integration.test.ts` 和 SQLite E2E 覆盖 ticket、重复消费、取消竞态、受保护 PTY 输入、页面销毁、owner end 和持久卡片状态。断言 owner 终态，而不是只断言按钮回调被调用。
