# Disposable Command Runner Runtime

## 1. 责任

该 adapter 负责一次 command execution 的 prepared runtime、Electron Utility transport 和 host lifecycle。它将 Main 的 runner port 接到 Utility 内的 disposable runner，再由公共 local-process runtime 管理真实 Shell/PTY 进程树。

它不决定权限、不解析 Shell、不保存长期 registry，也不把 Utility child 的 `'exit'` 直接当成执行完成。

## 2. 组成

```text
runner-runtime/
├── definitions/
│   ├── disposablePipeCommandPreparedRuntime.ts
│   └── disposablePtyCommandPreparedRuntime.ts
├── orchestration/
│   ├── createDisposablePipeCommandPreparedRuntime.ts
│   └── createDisposablePtyCommandPreparedRuntime.ts
└── shared/disposableRunnerHostLifecycle.ts
```

主线是 `prepare → start → observe → request stop → close → release`。prepare 阶段只能建立内存合同和身份，不得打开平台进程或监听长期资源。

## 3. 身份和消息

每次运行有 execution identity、runner generation 和 interaction id。所有 `started`、stdout/stderr、PTY screen、terminal、close/ack 消息都先校验 identity、generation、sequence，再交给 output/owner。

迟到、重复、错误 generation 的消息必须丢弃，不得因为内容看起来合理就接受。ACK pending、输出队列和观察计数必须有界。

## 4. 五事实终态

执行最终结果至少由以下事实共同组成：

1. process exit：根进程退出原因和退出码。
2. output drain：stdout/stderr/PTY 已读完，或明确超时/失败。
3. tree cleanup：整棵进程树已经不存在。
4. resource release：PGID/Job/PTY/Utility/native 资源已释放。
5. durable settlement：审计、卡片和 output manifest 已写入或标记 incomplete。

任何一个事实尚未确定，都不能返回“已完成”。terminal cause 一旦确定，迟到的 hard timeout、close 或 owner end 不能改写它；只能补充 cleanup failure。

## 5. 期限和取消

initial handshake、hard timeout、close deadline、drain deadline、owner end 各有语义，不能使用一个模糊 timer。收到 `started` 后再计算运行期限；收到 terminal 后由 close/drain deadline 负责收尾。取消是请求停止，不是立即报告成功。

## 6. 资源释放

正常完成、取消、超时、通信断开、Helper 启动失败和 App 退出都必须走同一 lifecycle。禁止引入 `taskkill`、`pkill` 等不带 owner 语义的兜底；平台整树清理由 local-process runtime 提供。

## 7. 测试门禁

覆盖握手慢、ACK 丢失、terminal/close 乱序、hard timeout、cancel、Utility 崩溃、root exit 但孙进程存活、输出未读完、结果缺失和重复消息。fake child 只能验证状态机；至少一条 packaged Electron Utility 冒烟测试验证真实组合。
