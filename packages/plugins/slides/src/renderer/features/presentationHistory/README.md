# Slides 历史只读预览

由文档类型的 historyPreviewComponent 贡献接入 Core 历史面板，不复用当前文稿 store，不提供编辑或保存操作。
私有 IPC 返回 [source history](../../../backend/features/presentationSourceHistory/README.md) 重建的单份 RenderModel；
选中页复用 slideRasterization，在 900×600 以内按真实比例生成预览。取消页面下拉框，
幻灯片在预览区内垂直居中，悬浮的上一页／页码／下一页导航固定在预览区底部；左右方向键只在预览区域内生效，不影响历史列表和确认框。
首尾不循环，单页禁用两端；无页时显示空状态。不显示或生成页面缩略图。

只保留选中版本和当前页的一张 bitmap，不预渲染其他页面，不缓存相邻版本。
切页中断上一栅格请求，迟到 bitmap 立即 close；
卸载时取消栅格化、关闭 bitmap、清空 canvas 与 model。IPC 已开始的后端编译不强行终止，响应不再被消费。
不会写入当前预览、缩略图或截图缓存。错误只显示在历史面板中，不改变当前文稿渲染状态。
已加载的自包含 RenderModel 不随时间变化；尚未加载的历史可能已被后续保存清理，失败时引导刷新历史列表。
打开历史不产生后台定时渲染或新的持久图片。切换版本重新加载其页面，不猜测已删除页的对应关系。

交互与反馈文本通过 Host localization 注册，布局 CSS 随插件样式贡献加载。
