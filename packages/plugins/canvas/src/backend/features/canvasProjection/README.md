# Canvas 文本投影

公开入口为本feature的index.ts。正文只从canonical结构化内容生成；文档卡与内联标签只消费调用方提供的当前同项目路径，越界或删除目标输出不可访问说明，不泄漏稳定目标ID、路径或标题。

`projectCanvasCardBody` 拥有卡片正文与标签的Markdown投影；`groupCanvasProjectionRegions` 只生成九宫格阅读分片；`projectCanvasDocument` 组织全文/大画布摘要与连线；`projectCanvasSearchText` 生成有UTF-8字节上限的检索快照。正文序列化不依赖前台编辑器。

`projectCanvasSelection({snapshot,elementIds,path,context,format?})` 基于一次已提交快照冻结选择内容，支持有预算的对话上下文和Markdown复制。默认上下文正文预算8000字符，卡片放不下时保留摘要及继续读取方法，不扩选区。发送前刷新由调用方的通用provider协调，不由投影函数追赶并发写入。
