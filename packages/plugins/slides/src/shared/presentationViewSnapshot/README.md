# Presentation view snapshot contract

`slides:view-snapshot` 是 Renderer 的正式文稿读取入口。请求包含文稿 ID 与客户端实际持有的 hash；续读再携带 snapshotId/offset。响应以 formatVersion 2 返回同一修订的 build state、导航摘要、渲染头、完整页序清单及缺失块。后续批次只返回块和游标。

compiled revision ID/number、source hash 来自同一次数据库读取。draftSourceHash 与错误状态参与快照身份；同一 compiled base 下的草稿变化不能按版本号相等过滤。draft 分支没有 ready preview/model。导航保留作者摘要、元素身份、颜色和字体；图表主题的正式使用者继续读取原 preview 合同，Renderer 导航不消费 chart theme。

页面内容块保留样式、几何、文字排版、资产和编辑值；定位块保留元素/作者身份、editableTarget、源码行号及布局追踪定位，并引用对应 contentHash。清单的出现位置与页内容 hash 不同：相同画面的两页可共享内容，但编辑身份独立。切分同时覆盖 Group.children 和 Shape.innerText，不递归删掉任意业务对象的 id。

页面 layoutReplay 的节点样式、父子关系、布局顺序和测量输入进入内容块，节点身份进入定位块；插入或复制改变页码时复用布局内容。没有该字段的历史修订保持可读。

规范化使用固定键序、原数组顺序及有限 JSON 值，只省略可选 undefined。Backend 以 SHA-256 寻址；协议语义变化必须升级 formatVersion。新增 RenderNode 字段须明确其归属。Renderer 先解析 wire，再完整恢复并通过原 SlideRenderModel guard；缺失/错配数据不得用旧页或空页补齐。

协议仅降低数据搬运，不替代完整编译和最终 RenderModel 构建。Backend 分批和缓存 owner 见 [presentationViewSnapshot](../../backend/features/presentationViewSnapshot/README.md)，前端安装和完整帧边界见 [documentRuntime](../../renderer/features/documentRuntime/README.md)。

版本 2 在 preview warnings 中传输 `manual_edit_suspended`，用于展示当前未应用或被移除的人工记录。身份能力、诊断及源码定位仍是修订派生事实，不改变页面视觉内容的定义。
