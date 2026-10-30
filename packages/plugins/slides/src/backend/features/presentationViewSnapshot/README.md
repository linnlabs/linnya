# Presentation view snapshots

本 feature 拥有 Renderer 只读快照的内容寻址、分页与短期缓存。文稿写入、源码编译、布局和资产生命周期仍由各自 owner 负责。`PresentationQueryRuntime` 从 persistence 一次关联读取的 source/build-state 派生 preview 和 RenderModel，再调用本 feature；后续批次禁止重新读取 current。

`functions/viewTransfer` 计算页面内容/定位 hash、清单和传输批次，`orchestration/PresentationViewSnapshotRuntime` 只协调捕获、缓存和读取。共享 wire 合同与页面 codec 见 [presentationViewSnapshot](../../../shared/presentationViewSnapshot/README.md)。

每次新读取仍生成完整 RenderModel 并比较最终内容，不假设源码中页面互不依赖。内容未变化时不发送新块；复制页复用内容，独立发送其编辑身份、sourceSpan 和布局定位。布局证据中的尺寸/约束属于内容，节点 ID/label 和源码位置属于定位。

页面 `layoutReplay` 同样无损传输：归一化布局输入属于内容，节点 ID 属于 binding。插入或复制造成页码变更时不重传布局内容；缩略图键仍只消费最终视觉字段，不包含该编辑事实。

缓存按序列化字节限制为 64 MiB；30 秒失效在下一次访问时清理，不代表进程堆内存硬上限。批次目标为 256 KiB，同时限制值节点量，为 Core 的 20 万节点准入留出空间。单个大块可以独占一批并走 mailbox，超过节点/快照预算则明确失败。后续请求必须携带原 snapshotId、游标和同一组已持有 hash；快照过期返回 `SLIDES_VIEW_SNAPSHOT_EXPIRED`，不能用新修订补旧批次。页序和头只在首批发送。

不持久化缓存，不改变修订或资产引用；删除页面只改变清单，共享块仍可被其他出现位置引用。后续布局、字体或资源事实变化会重新产生内容 hash，不能仅以 compiled revision 永久复用模型。

`presentationViewSnapshot.integration.test.ts` 经 JSON 边界连接正式 Backend runtime 和 Renderer 读取：验证无损恢复、零新块刷新、复制的独立身份、100 页冷加载中途再次保存、缺块拒绝。SQLite current/draft 捕获由 persistence 集成测试覆盖。
