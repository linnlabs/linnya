# 媒体插入策略（嵌入图片 / 媒体存储音视频）

> 状态：图片嵌入切片已落地（Step A，2026-06-24）；音视频媒体存储仍待后续批次。产品概念现以 [`product-model-overview.md`](../product-model-overview.md) 为准；旧“资源库”底座 proposal 只保留历史研究价值，本文以当前 Markdown 私有媒体边界为准。
> 范围：编辑器图片/音频/（未来）视频的插入、持久化与重启稳定性
> 关联代码：`src/features/workspace/assets/`、`src/features/workspace/vfs/`、`src/electron-main/protocols/`（media://）、`src/electron-main/ipc/handlers/system/`（媒体读权限）
>
> **词汇表对齐（重要）**：底座把"嵌入/联动/资源库"锁成三个正交概念（"联动 (linkage)"= 文档间实时内联 / transclusion，**不叫"引用"**——"引用/Citation"在本项目专指标注出处）。本文媒体只涉及前两条里的"位置 + 嵌入"，**不涉及底座的"联动(linkage=文档间 transclusion)"**：
> - 图片 → **嵌入（embed）**：复制成文档私有副本，`content_json` 只记**内部定位指针**（纯内部管道，**不是"联动"**）。
> - 音视频 → **媒体存储**：太大不复制，记文件路径 + 登记 asset 作持久读授权。**这也不是"联动"。**

---

## 0. 一句话

编辑器的媒体插入目前有**三条互不一致的路径**，其中"菜单选图"存在**重启即断的 bug（须尽快修）**。长期方向（按媒体类型统一、与来源无关）：

- **图片 → 嵌入（复制）**：字节复制进受控内部根（文档私有副本），`content_json` 只记内部定位指针，不再 base64 内联，也不再指向外部原图。删外部原图无影响。
- **音视频 → 媒体存储（指文件、不复制）**：登记 workspace asset 作持久读授权，文件被删/移走则按降级显示占位。

两者都**不进用户可见的"资源库"文件夹**（那是 AI 产出等项目级资源的默认目录），也都**不是底座意义上的"联动"**。

> 方向修订史：早期草案写过"复制 → 登记 `project_asset_links` → 进资源库"（会污染资源库），后改"文档私有副本"；又一度把图片的内部指针误称"轻引用"、把音视频称"引用"——经讨论澄清，**这些都不是联动**，已统一为"嵌入 / 媒体存储"；同时文档间 transclusion 也已定名"联动"，与"引用/Citation（出处）"切割。

---

## 1. 必须尽快修的 Bug：菜单插入图片重启即断

- 严重等级：中（功能性 bug，用户可感知"图片丢失"）
- 类型：数据生命周期 / UX
- 状态：已在 Step A 修复。菜单与斜杠菜单改走 `media:pick-and-embed-image`，主进程内选择并复制到 `DocumentMedia/<documentNodeId>/`，正文保存 `media://load/doc-image/<relative locator>`，不再依赖会话 grant。

### 复现

1. 编辑器顶栏「插入图片」→ 选一张电脑里（非应用内部目录）的图片。
2. 图片正常显示。
3. 重启应用，重新打开该文档 → 图片裂掉，无法加载。

### 根因（已定位，非猜测）

菜单插图走的是**外部路径 + 会话级读授权**，授权不持久：

- `apps/renderer/domains/editor/ui/MenuBar.vue` L446-464：dialog 选到外部 `filePath` → `window.linnyaMedia.buildImageUrl(filePath)` 生成 `media://load/image/<base64url(filePath)>` 作为 `<img src>`。
- dialog 选完会签一个**会话读 grant**：`select-image` handler 调 `issueReadGrantsFromDialogResult`（`src/electron-main/ipc/handlers/system/media-ipc.ts` L107）。
- 但 grant 存在**进程内存 Set**：`src/electron-main/ipc/handlers/system/file-read-grants.ts` L3（`grantedReadRealPaths`），**重启即清空**。
- 重启后访问 `media://` 时，handler 调 `assertReadablePath` 判定：外部路径既不在受控根白名单（例如 conversation 工作目录、`DocumentMedia`、`AudioRecordings`、`Documents` 等），又没有 grant → 抛 `MediaPathNotAllowedError` → 图裂。

对比：拖拽/粘贴图片不裂，是因为它走的是 base64 嵌入 content_json（见第 2 节），自包含、不依赖外部路径——但那是另一类问题（文档体积膨胀）。

### 修复方向（统一到图片嵌入逻辑）

菜单选图不再单独修，而是**和拖拽/粘贴一起收敛到同一套"嵌入（复制私有副本）"逻辑**（第 4 节）。落到这次 bug 上即：

- 选中的外部图片**复制进受控内部根**（`media://` 放行的根之一，见第 3 节），`content_json` 的 `src` 改成指向副本的内部定位，渲染时解析成 `media://`。
- 重启后路径落在受控根白名单内，`assertReadablePath` 直接放行，**不再依赖会话 grant**，bug 根除。
- 文档自包含：复制后不怕用户移动/删除原图。

> 为什么不用"持久化 grant"修图片：grant 方案文档仍不自包含（原图被删/移走照样裂），还要一整套权限生命周期。图片是小文件、高频内容，复制更稳。**持久授权那条路留给音视频媒体存储**（第 4 节），那里复制不可行、必须靠 asset 登记做持久授权。

---

## 2. 当前四条媒体插入路径全貌（事实）

| 路径 | 实现 | 重启 | 问题 |
|---|---|---|---|
| 拖拽 / 粘贴图片 | Step A 后通过 `media:embed-image-bytes` 复制到 `DocumentMedia`，`imageBlock.src` 保存 `doc-image` locator | 稳定（自包含） | 历史 base64 文档不强制迁移 |
| 菜单 / 斜杠菜单「插入图片」 | Step A 后通过 `media:pick-and-embed-image` 在主进程内选择并复制，renderer 不接触外部绝对路径 | 稳定 | 无需会话 grant；删除/移动原图不影响文档 |
| AI 生成图 | 写入 conversation 工作区并作为对话工具结果登记 | 稳定 | 不进入项目资源库；`conversation:` locator 可由 `read_file` 或 Slides 消费 |
| Slides 插图 | 本地路径、data URI、`conversation:` 或 `file:` locator；网络图先下载 | 稳定 | 首次编译复制为 presentation-owned asset；Markdown 私有 `doc-image` 不自动跨文档复用 |

证据：
- 拖拽：`apps/renderer/domains/editor/blocks/ImageBlock/plugins/ImageDropPlugin.js` 调用 `blocks/ImageBlock/orchestration/embedAndInsertImage.ts`，不再 `readAsDataURL`。
- 菜单：见第 1 节。
- AI 生成 / Slides：`GenerateImageTool.ts`、`packages/plugins/slides/src/backend/features/presentationImageOwnership/`。

---

## 3. 复用既有能力，分清存储位置与授权

### 3.1 编辑器图片嵌入：私有副本优先

按底座 §2.2：**图片嵌入大概率不需要 `assets`/`document_asset_links` 那套**——"私有副本文件 + `content_json` 内部定位指针 + media:// 解析"就够了，副本落在受控根即可被 media:// 放行。`assets`/link 子系统是给"资源库共享产物"和"可被联动的一等实体"用的。

- 本切片**以最简实现为先**：图片嵌入只做"复制 + 内部指针 + media://"，**先不挂 asset/link**。
- 仅当需要"让某张图成为可被其他文档联动的一等资源"时，才登记 asset（那属于底座概念三的范畴，不在本切片）。
- 此简化在实现期最终确认。

Slides 与编辑器的内容结构不同：它的修订会从 deck.js 重新编译，因此另外使用 `presentation_image_bindings + document_asset_links` 固定首次接管的字节。这不改变编辑器的私有副本方案。

### 3.2 `media://` 读授权前提

副本必须落在 `getAllowedReadRoots()` 列出的受控根内（当前包含 conversation 工作目录、`DocumentMedia`、`AudioRecordings`、`ResourceLibrary`、`Uploads`、`Documents`、`Artifacts`、`WorkspaceData`）。落在根里 → 重启免 grant 放行。历史全局 `GeneratedImages/` 已退出受控根，不提供兼容读取。

> Step A 定稿：图片副本落在 Workspace Root 下的 `DocumentMedia/<documentNodeId>/`，正文只保存相对该根的 `doc-image` locator。协议解析时拒绝绝对路径和原始 `..` 段，并通过 realpath 二次确认仍在 `DocumentMedia` 子树内。

### 3.3 资源库侧边栏查询（落地 D1）

`listWorkspaceVfsNodes.ts` 的资源库查询已在 Step A 收敛为只看 `project_asset_links`，不再把 `document_asset_links` 投影到资源库侧边栏。鉴于图片嵌入本就不挂 link（§3.1），这条主要是清理历史设计，确保即使将来有 document 级 asset 也不冒进资源库。

---

## 4. 产品方向：按"类型"统一策略，与来源无关

核心原则：**用户插入媒体的策略只取决于媒体类型，与来源（拖拽 / 粘贴 / 菜单）无关；同一类型用同一份代码。** 这与 Word / Notion 一致。

| 媒体类型 | 策略（拖拽 / 粘贴 / 菜单，**同一份代码**） | 落地方式 |
|---|---|---|
| 图片（高频、小） | **嵌入（复制）** | 复制进受控内部根的文档私有目录 → `content_json.src` 存内部定位指针 → 渲染解析成 `media://`；不挂 asset/link（§3.1）、不 base64 |
| 音频 / 视频（低频、大） | **媒体存储（指文件、不复制）** | `content_json` 记文件路径 + 登记 workspace asset（`local_path`=文件路径）作持久读授权 → `media://` 以"是否已登记 asset"放行，重启不断、用户无感、无需 grant UI |

理由：
- **图片 → 嵌入**：文档高频内容，要自包含、可分享导出；图片小，复制成本低。相比 base64 内联：①不再随 `document_versions` 按 ~16× 膨胀（保留策略 `keepRecent:15 + keepFirst`，base64 会被每版本各存一份）；②`content_json` 回归"轻量结构骨架"原设计。
- **音视频 → 媒体存储**：低频且大（视频可达 GB），复制不现实；保持"指向文件"。授权靠 asset 登记自动持久化，**用户无感、无需授权 UI、重启不断**（替代会话 grant 的"重启即断"）。
- 前端已有 AudioBlock（`apps/renderer/domains/editor/blocks/AudioBlock/`），音视频逻辑收敛以它为基础；实现时需核实其当前解析路径是否就是这条 asset 授权链（疑似存在"找不到资源"的现状问题，待实现阶段确认）。

实现层面的收敛点：
- **图片三条插入路径收敛成一个嵌入函数**。现状两套：拖拽/粘贴走 `ImageDropPlugin`（base64），菜单走 `MenuBar`（`media://` + 会话 grant）。统一后无论入口，都调同一个"嵌入图片 = 复制私有副本 + 内部定位指针"逻辑。
- **音视频收敛成一个媒体存储函数**：指文件 + asset 登记授权。即使前端目前没有视频 block，也应在设计阶段把视频纳入这条逻辑，避免返工。

---

## 5. 产品决策（已定）

第 4 节原则已定：图片一律嵌入、音视频一律媒体存储，与来源无关。其余决策定稿：

1. **历史 base64 文档迁移**：**不强制迁移**。新插入走嵌入；老 base64 文档保持原样（仍能正常显示）。如有需要，后续做"打开时懒迁移"或手动触发，不阻塞本期。
2. **媒体文件失效降级**：原文件被删除/移动时，**显示占位 + 明确提示，不静默裂、不崩溃**。主要针对音视频媒体存储（图片嵌入已自包含，一般不失效）。
3. **孤儿与 GC**：**本期不做联动计数与自动删除**（不 GC），避免误删；留到将来资源管理面板再评估。删媒体块只摘块、不删底层副本文件（宁可孤儿不要死链）。
4. **音视频读授权 UI**：**不做 UI、用户无感**。授权靠"插入即登记 asset"自动持久化（见第 4 节），不引入独立 grant store，也不做撤销面板。
5. **普通编辑器图片中的 svg 安全**：本条只约束用户通过 Markdown 图片链路插入、并经 `<img src>` 展示的文件；不得把 SVG 内联进 DOM（`innerHTML` / `v-html` / inline `<svg>`）。它不授权 Agent 生成的 SVG 绕过业务准入。Slides 的 SvgGraphic 是独立矢量对象，必须按 [`Slides SVG Graphic 共享合同`](../../packages/plugins/slides/src/shared/svgGraphic/README.md)走唯一 backend admission，拒绝脚本、事件、外部资源、CSS 和未登记结构，不能复用“普通图片无需审查”的结论。
6. **图片副本存储位置**：落在 `media://` 受控根内（§3.2）；建议受控根下按 `documentNodeId` 开文档私有子目录。实现阶段定稿。

> 落地顺序：①图片插入收敛成"嵌入（复制私有副本）"单一逻辑（既修第 1 节 bug、又消灭 base64 膨胀）；②音视频收敛成"媒体存储 + asset 授权"单一逻辑（顺带修外部音视频重启断 + 核实 AudioBlock"找不到资源"现状）；③落地 D1 查询；④历史 base64 迁移单独评估。

---

## 6. 与既有审计结论的关系

- 本文对应审计 F4-01 备注里"长期更稳的方向是导入时复制"的展开，落点为"复制成文档私有副本（不进资源库）"；且**菜单重启即断是 bug（须尽快修），不是可选的产品方向**。
- 第 4 节"音视频媒体存储 + asset 授权"对应 SEC-01 当年挂账的持久授权诉求，但**不再新建独立持久 grant store**：授权直接复用 asset 登记（已落库），比单独 grant 表更省、更不易漂移。
- 安全边界不变：无论嵌入还是媒体存储，文件读取仍由 `assertReadablePath`（受控根白名单 + 授权）统一把关，本方向不放宽边界。
