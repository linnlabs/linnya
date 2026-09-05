# Slides 历史只读预览

由文档类型的 historyPreviewComponent 贡献接入 Core 历史面板，不复用当前文稿 store，不提供编辑或保存操作。
私有 IPC 返回 [source history](../../../backend/features/presentationSourceHistory/README.md) 重建的单份 RenderModel；
选中页复用 slideRasterization，在 900×600 以内按真实比例生成预览。

只保留选中版本和一张 bitmap，不缓存相邻版本。切页中断上一栅格请求，迟到 bitmap 立即 close；
卸载时取消栅格化、关闭 bitmap、清空 canvas 与 model。IPC 已开始的后端编译不强行终止，响应不再被消费。
不会写入当前预览、缩略图或截图缓存。错误只显示在历史面板中，不改变当前文稿渲染状态。

交互与反馈文本通过 Host localization 注册，布局 CSS 随插件样式贡献加载。
