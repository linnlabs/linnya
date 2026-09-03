# AI SDK Stream Reliability

本 feature 拥有 AI SDK 流空闲策略。它直接使用 AI SDK `streamText` 的
`timeout.firstChunkMs/chunkMs`，不自行解析 SSE，也不复制 Provider package 的传输层。

- 默认连续无内容分片上限为 5 分钟；每个内容分片由 AI SDK 原生重置计时；
- timeout 产生的 SDK abort 与用户传入的 `AbortSignal` 分开投影；
- timeout/disconnect 只形成可重试 canonical transport failure，attempt budget 仍由 Linnkit 拥有；
- 本 feature 不按 Provider、URL 或模型名选择超时值，不维护厂商特例。

该默认值参考 Pi 的 5 分钟 HTTP idle timeout；本地只复用策略量级，未复制其 Undici
dispatcher 实现。本 package 使用当前已安装 AI SDK 的原生 chunk timeout，以减少自维护代码。
