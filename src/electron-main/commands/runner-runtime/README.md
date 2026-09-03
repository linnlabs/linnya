# Electron Command Runner Runtime

## 1. 主进程边界

这里把 Electron Main 的 `utilityProcess` 封装成 Commands domain 能理解的 `CommandRunnerProcessPort`，仅用于历史平台 transport fixture。当前 Desktop App production 不导入本 adapter；App Server 直接使用固定 headless Node 创建一次性 runner，避免 Main 进入命令高频数据面。

## 2. 真实生命周期

```text
Main create utilityProcess
  → attach message/exit/error observers
  → send prepare/start with identity
  → wait for started
  → forward output/control events
  → receive terminal
  → wait for close/ack and tree cleanup
  → dispose transport and release utility
```

Utility 的 `exit` 只说明 Utility 进程退出；如果没有合法 terminal、close 和资源事实，host 必须返回 runtime failure，并继续由 owner/watchdog 观察残留树。

## 3. 安全和打包要求

- 生产入口必须使用打包后的 Utility 入口和公共 loader；不能回到 `fork + ELECTRON_RUN_AS_NODE`。
- 每个 Utility 只服务一个 execution，不能通过隐式全局 registry 接收另一条命令。
- fixture owner 关闭时先停止发送新动作，排空已接受消息，再结束 transport。
- packaged App、Utility、mailbox 和 native loader 必须使用同一发布身份策略；开发环境的 fake child 不能替代发布验证。

## 4. 测试门禁

`electronCommandRunnerProcessPort.integration.test.ts` 和 `utilityProcessTransport.integration.test.ts` 覆盖握手、ACK、terminal/close 分离、迟到消息、进程退出和 cancel。发布前还需要真实 packaged Utility 冒烟，验证入口路径、资源查找、签名和 Windows VC runtime。
