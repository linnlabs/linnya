# 子图剪贴板

复制同时写入 `web application/x-linnya-canvas+json` 与普通 Markdown。使用 Chromium 正式 [web custom formats](https://developer.chrome.com/blog/web-custom-formats-for-the-async-clipboard-api)，不借助 Host store 或原生进程接口。Markdown 与 JSON 子图均由 Backend 同一最新快照返回，不能把界面缓存的旧结构与新正文混在一起。

剪切先等系统剪贴板写入成功，再删除已复制元素的精确修订。写入失败、视图关闭或源修订冲突不能删除新内容。复制子图保留内部连线，粘贴为新元素及新的行内引用出现位置，受管图片仍沿用资产身份并由共同提交登记新文档归属。普通粘贴以指针或视口中心放置整个子图。
