# Command Output Adapter

## 1. 输出为什么分开

同一批字节同时服务三个不同读者：raw artifact 要保留证据，Agent 要得到有限且稳定的文本，Renderer 要得到可扫描的卡片或 PTY 屏幕。如果把它们合成一个 `output: string`，就会在截断、ANSI、慢磁盘或敏感数据处理时互相污染。

## 2. 代码树

```text
output/
├── definitions/
│   ├── pipeCommandOutputSession.ts
│   ├── pipeCommandTextSink.ts
│   ├── ptyCommandOutputSession.ts
│   └── ptyCommandTextSink.ts
├── functions/
│   ├── createPipeCommandRuntimeTerminal.ts
│   ├── projectCommandSettledTextOutput.ts
│   ├── validatePipeCommandRunnerTerminal.ts
│   └── validatePtyCommandRunnerTerminal.ts
└── orchestration/
    ├── createPipeCommandOutputSession.ts
    ├── createPipeCommandTextSink.ts
    ├── createPtyCommandOutputSession.ts
    ├── createPtyCommandTextSink.ts
    └── preparePtyCommandOutput.ts
```

## 3. 三个消费者

### Raw artifact

按 stdout/stderr 或 PTY 来源保留原始 byte、序号、观察计数和完整性状态。写入使用临时文件 + manifest-last/原子 rename，manifest 未提交时读取端只能看到 incomplete，不得把半文件当完整输出。

### Agent text

文本 sink 使用独立 decoder 和 head/tail 预算，为模型提供简短首尾文本及 `tool_output://` 续读引用。Unicode 截断必须走 surrogate 边界函数；stdout 和 stderr 解码器独立，不能一条流的残片污染另一条流。

生产 Shell 的双流 inline 预算总和必须低于 Linnkit 默认 observation 治理阈值，并预留控制行和
引用说明空间。完整文本已经由本层 writer 保存时，通用 ToolNode 不应再为同一 observation 创建第二份全文 blob。

### Presentation

卡片只接收命令摘要、状态、耗时、终因和复制需要的正文。它不能读取 raw artifact 路径、PID 或 writer 对象。PTY 屏幕另有结构化 projection，含行、样式和尺寸预算。

## 4. 结算顺序

1. 校验 execution identity、stream、sequence 和 observed bytes。
2. 按流独立接收 chunk，处理跨 chunk 的 CR/LF 和 decoder EOF 残片。
3. terminal 到达后停止接收新来源，但继续 drain 已进入管道的字节。
4. 分别等待 raw artifact、text sink、PTY projection 和 presentation settlement。
5. 只有 terminal facts 与 sink 结果都已明确，才写 durable card/audit settlement。

慢 writer 不能堵住 child pipe 的 IPC handler；IPC accept/offer 只做同步入队，真正 I/O 在之后执行。sink 失败只标记对应层 incomplete，不改写 process exit、tree cleanup 或 resource release。

## 5. 容量和失败

所有层都有单流、事件、artifact 和文本预算。超过预算进入明确的 truncation/incomplete 状态，不无限重试。磁盘满、权限错误、manifest 损坏、输出顺序错误和迟到 chunk 都要有可观察原因。

## 6. 测试门禁

测试覆盖双流独立、慢 writer 背压、磁盘失败、manifest-last、前缀恢复、空输出、UTF-8 残片、ANSI/CR、PTY 屏幕预算、terminal 后 drain、复制正文和 card settlement。不要新增“把所有层拼成字符串”的快捷函数。
