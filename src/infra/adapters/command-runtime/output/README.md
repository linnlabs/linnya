# Command Runtime Output

## 处理链

该层负责从平台 stream 接收 byte，分别维护 stdout/stderr decoder、sequence 和计数，再生成稳定 logical line、raw artifact 输入和 PTY screen 输入。它不拥有进程、不写最终存储、不决定权限。

```text
stdout / stderr / tty
 → independent decoder
 → bounded ANSI parser
 → CR/line projection
 → raw + text + screen consumers
```

## 关键不变量

- stdout 与 stderr 永远独立解码；不能拼接后再解析。
- decoder EOF 残片仍必须进入 parser；跨 chunk CRLF 要合并。
- OSC/DCS payload 不无限缓存，解析器只保留必要状态。
- 每个切点走 Unicode surrogate 边界函数，head/tail 预算不能切断字符。
- `observedBytes` 与 source sequence 对账，迟到/重复 chunk 不重复计数。

## 背压和失败

accept/offer 只同步入队；慢的 artifact/text sink 在异步阶段处理。队列、preview、事件和单次输出都有上限；sink 熔断后不无限重试。原始 byte 失败、文本失败、屏幕失败分别标记，不能互相改写进程终因。

## 测试门禁

覆盖 Unicode/CRLF/ANSI 分块、二进制、空输出、超限、慢 sink、磁盘失败、已保存前缀恢复、terminal 后 drain 和 PTY 屏幕 projection。不要写一个总字符串 helper 来绕过分层。
