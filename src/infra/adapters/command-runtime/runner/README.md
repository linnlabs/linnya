# Command Runner

## 责任

runner 是一次性 Utility 侧实现。它接收已经冻结的 launch snapshot，启动平台 owned process，消费 pipe/PTY 输出，并报告 `started`、output settlement、`terminal`、`close` 和 resource release 事实。

它不知道用户选择的权限档位、不写审计数据库、不保存完整模型文本，也不能自行决定“审批后是否允许”。

## 身份合同

每次 run 有 execution identity、owner binding、runner generation 和 protocol version。每条 request/event 都必须验证 identity、generation、interaction id 和 sequence；错误或迟到帧只能丢弃，不能尝试“猜测恢复”。

## 启动和结束

```text
prepared (no OS resource)
 → utility ready
 → platform owner started
 → output chunks / interaction results
 → process exit
 → output drain
 → tree empty
 → resource release
 → close
```

process exit 不是终态。若 Helper 根进程退出而孙进程仍存活，必须继续整树清理；输出尚未排空时不能丢弃已经产生的字节。

## 背压和容量

IPC handler 到 output `accept/offer` 必须同步完成入队，第一个 `await` 之后才能碰磁盘或解析器。双流、事件队列、ACK pending、head/tail 和 PTY screen 都必须有界，慢 sink 不能堵住 Utility 的 pipe。

## 测试门禁

覆盖 ACK、generation、乱序消息、双 EOF、root exit、tree empty、输出 drain、cancel、hard timeout、Utility 崩溃、resource release 失败和真实平台 owner 组合。
