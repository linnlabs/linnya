# Brush Artwork Generation

该 feature 是 p5.brush 的浏览器执行 adapter。隐藏 Renderer 只负责接收 Host 请求；每个真实生成任务都会
新建一个 job-scoped Dedicated Worker，完成、失败或取消后立即销毁，避免上游模块级 target/compositor
状态跨任务泄漏。

输入是严格、自包含的 Brush render request，输出是不透明 PNG 字节。这里不访问数据库、Workspace、网络
或 presentation ownership；Host 侧 `presentationImageOwnership` 是唯一的持久资产 owner。

解释器按 layer 清空全部 stroke/fill/wash/mass/hatch/field 状态，再把 0–100 局部坐标投影为目标像素。
公开 mark 只映射到 pinned p5.brush 的固定原语；这里不接收 recipe、raw JS、自定义笔刷或 field 回调。

生产 bundle 固定 p5.brush 上游 commit `fc37da3da3fa07e58edf880fb2788c5529a51ebe`。MIT 许可证随
插件资源分发于 `resources/third-party/p5.brush-LICENSE.md`，升级上游时必须同步复核并更新该文件。
