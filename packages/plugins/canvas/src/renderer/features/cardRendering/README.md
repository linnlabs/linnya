# 正文卡片投影

`content.ts` 暴露受管图片和文档标签的 DOM hydrate，前台与后台只消费已授权的资产/当前标题事实。标签复用 markdown-document-core 的固定 icon/label 槽与 CSS，图标由公开 RendererUI DocumentIcon 生成一次后克隆；不在纯正文包加入 Vue，不查 Workspace 或递归预览。

批量正文装配按正式 DOM 排版，独立报告单卡内容准备失败；一张不可访问图片不阻塞同批文字卡。长卡依据完整排版高度显示裁切状态，切片保持完整正文排版宽度。实际绘制经 textRasterization capability 的一次 paint atlas，再裁出独立像素所有权的 ImageBitmap，不让小碎片持有整页 backing。

Renderer 组合层调度只补当前世界可见片段中尚无纹理的部分；同一正文版本的片段可合并。移动/颜色不使正文失效，元数据通过 readContentKey 精确失效，旧异步结果不能覆盖新的授权标题/状态。失败在当前键下保留错误，显式 retry 后重试，不无限热循环。
