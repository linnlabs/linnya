# 正文卡片投影

`content.ts` 暴露受管图片和文档标签的 DOM hydrate，前台与后台只消费已授权的资产/当前标题事实。标签复用 markdown-document-core 的固定 icon/label 槽与 CSS，图标由公开 RendererUI DocumentIcon 生成一次后克隆；不在纯正文包加入 Vue，不查 Workspace 或递归预览。

批量正文装配按正式 DOM 排版，独立报告单卡内容准备失败；一张不可访问图片不阻塞同批文字卡。长卡依据完整排版高度显示裁切状态，切片保持完整正文排版宽度。实际绘制经 textRasterization capability 的一次 paint atlas，再裁出独立像素所有权的 ImageBitmap，不让小碎片持有整页 backing。

Renderer 组合层调度只补当前世界可见片段中尚无纹理的部分；同一正文版本的片段可合并。移动不使正文失效，染纸会改变同色深墨，颜色须参与正文键。元数据通过 readContentKey 精确失效，旧异步结果不能覆盖新的授权标题/状态。失败在当前键下保留错误，显式 retry 后重试，不无限热循环。

`shared/appearance` 是纸面、标题、正文、辅助墨色的唯一色板。`content` 公开的 `installCanvasCardInk` 由编辑器、Renderer与离屏正文共同消费，同源CSS提供标题/辅助层级和长卡底部淡出；作者显式行内颜色保留。前后台共同调用 `createCanvasCardRasterBatch` 的批量测高/裁切/paint流程。

`resolveCanvasDisplayImages(assets, signal)` 为前台与隐藏 worker 生成长边不超过 2048 的受管显示源，原资产字节和正文 assetId/src 不改。先在 bitmap 层缩小再创建 DOM 图片；原图与派生 bitmap 在成功和失败时均关闭，同时只解码一张原图，避免绕过纹理预算。显示源缓存按 assetId 与内容 SHA-256 身份计入 32MiB 上限，取消后不开始后续图片；插件停用调用 clearCanvasDisplayImageCache。查看原图继续走 Host 原资产。

墨色样式是公开资源 `styles/canvasCardInk.css`；正式 Renderer contribution 显式声明其 URL，隐藏 worker 与探针各自显式导入同一文件。函数入口不隐式注入样式，也不复制 fade 规则。
