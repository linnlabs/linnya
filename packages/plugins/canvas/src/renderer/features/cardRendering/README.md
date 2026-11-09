# 正文卡片投影

`content.ts` 暴露受管图片和文档标签的 DOM hydrate，前台与后台只消费已授权的资产/当前标题事实。标签复用 markdown-document-core 的固定 icon/label 槽与 CSS，图标由公开 RendererUI DocumentIcon 生成一次后克隆；不在纯正文包加入 Vue，不查 Workspace 或递归预览。

批量正文装配按正式 DOM 排版，独立报告单卡内容准备失败；一张不可访问图片不阻塞同批文字卡。长卡依据完整排版高度显示裁切状态，切片保持完整正文排版宽度。实际绘制经 textRasterization capability 的一次 paint atlas，再裁出独立像素所有权的 ImageBitmap，不让小碎片持有整页 backing。

Renderer 组合层调度只补当前世界可见片段中尚无纹理的部分；同一正文版本的片段可合并。移动不使正文失效，染纸会改变同色深墨，颜色须参与正文键。元数据通过 readContentKey 精确失效，旧异步结果不能覆盖新的授权标题/状态。失败在当前键下保留错误，显式 retry 后重试，不无限热循环。

`shared/appearance` 是纸面、标题、正文、辅助墨色的唯一色板。`content` 公开的 `installCanvasCardInk` 由编辑器、Renderer与离屏正文共同消费，同源CSS提供标题/辅助层级和长卡底部淡出；作者显式行内颜色保留。前后台共同调用 `createCanvasCardRasterBatch` 的批量测高/裁切/paint流程。

`resolveCanvasDisplayImages(assets, signal)` 为前台与隐藏 worker 生成长边不超过 2048 的受管显示源，原资产字节和正文 assetId/src 不改。先在 bitmap 层缩小再创建 DOM 图片；原图与派生 bitmap 在成功和失败时均关闭，同时只解码一张原图，避免绕过纹理预算。异步准备与缓存归orchestration；受管assetId对应不可变字节，显示源缓存按assetId计入32MiB上限，命中时不解码或散列原图，取消后不开始后续图片；插件停用调用 clearCanvasDisplayImageCache。查看原图继续走 Host 原资产。

墨色样式是公开资源 `styles/canvasCardInk.css`；正式 Renderer contribution 显式声明其 URL，隐藏 worker 与探针各自显式导入同一文件。函数入口不隐式注入样式，也不复制 fade 规则。

短纯文字的合批按实际输出片段像素与DOM内容成本判断：额外扩展到64张时，累计不超过1Mi像素、512个普通段落/文字节点和16Ki字符；移动时容量与工作量减半。复杂正文、图片解码、公式和标签保持原32/16批次，不改变采样质量、单页4096边长、64任务容量或位图预算。这样小卡不必为每32张串行等待一次paint，也不会把64张复杂卡当作同一份轻量工作。

文档卡由 `createCanvasDocumentSurface` 生成：顶部一行小标签（文档类型图标加文件名，图标经 `readDocumentPreviewTypeIcon` 取 Host 文件树的同一组件，后台出图拿不到时用通用文件图标），下面直接排文档正文，文档自己的大标题就是卡片标题。正文取预览结果的 `detail`，按 `canvasDocumentPreviewBody` 截在段落边界，用与 Host 只读详情相同的 Markdown 解析与渲染；内容方声明缩略图优先（`overview: 'thumbnail'`，如演示文稿）时改用封面图。选中后的只读详情复用同一标签和正文排版（`canvasMediaContent.css`），所以选中只多一圈描边；打开文档走选中浮条与双击。
