# Brush Artwork

Brush Artwork 是 deck.js 的受控声明式绘制合同。作者保存 seed、纯色背景、质量档和有序 layers；每层
用 stroke、watercolor/wash/mass、hatch、内置 field 与 marks 组合画面。局部坐标统一为 0–100，普通
deck.js 循环可构造 marks；Worker 不执行作者 JavaScript。像素尺寸由最终 Image 盒子派生，WebGL、GPU、
上游版本和缓存均不进入作者事实。

shared strict codec 是 allowlist、默认值和预算的唯一 owner：最多 24 层、512 个 mark、4096 个显式点。
旧 recipe 不属于当前合同，也不保留兼容入口。

当前 p5.brush standalone 不保留透明通道，因此正式合同只生成不透明 PNG。`backgroundColor` 必填；
资产应覆盖完整纯色区域，不能当作透明贴图叠在照片、渐变或纹理上。上游未来支持透明输出时，可以新增
显式 background mode，但不能改变已有 intent 的含义。

生成完成后，PNG 必须由 `presentationImageOwnership` 接管；预览和 PPTX 继续消费普通 Image，不新增
Brush RenderNode，也不在两条渲染链重复生成。
