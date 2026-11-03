# DOM 卡片光栅化

本 capability 接受正式正文 renderer 给出的 HTMLElement，不理解 Tiptap JSON，不复制正文 schema。`measure` 与 `rasterize` 使用同宽 DOM、产品 CSS 与字体；后者只画指定的可见框，支持纵向 offset，最大纹理边默认 4096，长卡由调用方分块。

DOM 安装后等待 fonts 和图片 decode。图片必须经内容 provider 从受管字节转成 blob/data URL；不放宽媒体协议 CORS。普通隐藏窗口可能成功触发 paint 却输出透明图，后台提供者必须选择已验证的 offscreen Host 能力。实验 API 不可用、paint 超时或中断时返回错误，由文档类型决定身份牌反馈，不伪造出图成功。

`createLatestRasterQueue` 串行使用 staging DOM，默认至多一个运行任务和 64 个待处理项。同一 key 的旧任务被替换；已完成的旧结果也会释放。调用方取消离屏请求，并对 dropped 结果按当前可见需求重新调度，不保留无限积压。

`cardRasterKey` 覆盖正文修订、主题、DPR、材质、LOD、字体和界面缩放；业务应按实际影响区分正文与外框，材质只影响外框时复用正文。光栅器销毁后不再安装 DOM，返回的 bitmap 由接收者或队列释放。
