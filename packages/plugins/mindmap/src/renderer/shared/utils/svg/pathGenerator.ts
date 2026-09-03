/**
 * SVG Path Generator Utilities
 * 专门用于生成各种风格的连线路径
 */

interface SmoothManhattanOptions {
    /** 第一段直线的长度 (把手长度) */
    stump: number
    /** 拐角半径 (默认 12) */
    r?: number
    /** 
     * 贝塞尔张力系数 (0.552=标准圆, 0.75=Apple风格Squircle)
     * 系数越高，拐角越贴近直角但保持平滑
     */
    k?: number
  }
  
  /**
   * 生成 G2/G3 连续曲率的正交折线 (XMind/Apple 风格)
   * 视觉上类似：直线 -> 平滑过渡 -> 垂直线 -> 平滑过渡 -> 直线
   * 
   * @param x1 起点 X
   * @param y1 起点 Y
   * @param x2 终点 X
   * @param y2 终点 Y
   * @param direction 布局方向 'lhs'(左侧) | 'rhs'(右侧)
   * @param options 配置项
   */
  export function drawSmoothManhattan(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    direction: 'lhs' | 'rhs',
    options: SmoothManhattanOptions
  ): string {
    const { stump, r = 12, k = 0.75 } = options
    const dy = Math.abs(y2 - y1)
  
    // 1. 容错：垂直距离太小，直接画直线
    if (dy < 1) {
      return `M ${x1} ${y1} L ${x2} ${y2}`
    }
  
    // 2. 计算基础方向向量
    const dirX = direction === 'lhs' ? -1 : 1
    const dirY = y2 > y1 ? 1 : -1
  
    // 3. 计算关键拐折线的 X 轴坐标
    const verticalLineX = x1 + (stump * dirX)
  
    // 4. 空间容错检查
    // 如果水平间距不足以容纳两个拐角 (例如拖拽导致节点重叠)，回退到简单的 S 曲线
    const totalDistX = Math.abs(x2 - x1)
    const spaceNeeded = Math.abs(verticalLineX - x1) + Math.abs(x2 - verticalLineX)
    
    if (spaceNeeded < totalDistX && totalDistX < r * 3) {
      const cp1x = x1 + (x2 - x1) / 2
      return `M ${x1} ${y1} C ${cp1x} ${y1} ${cp1x} ${y2} ${x2} ${y2}`
    }
  
    // 5. 构建路径
    let path = `M ${x1} ${y1}`

    // === 情况 A: 垂直空间足够 ===
    // 可以画出标准的：直 -> 弯 -> 竖 -> 弯 -> 直
    if (dy >= 2 * r) {
        // --- 第一段：水平短线 ---
        // 终点 = 垂直线X - 拐角半径
        const h1_endX = verticalLineX - (r * dirX)
        path += ` L ${h1_endX} ${y1}`
    
        // --- 拐角 1 (水平 -> 垂直) ---
        const c1_cp1x = h1_endX + (k * r * dirX)
        const c1_cp1y = y1
        const c1_endX = verticalLineX
        const c1_endY = y1 + (r * dirY)
        const c1_cp2x = c1_endX
        const c1_cp2y = c1_endY - (k * r * dirY)
    
        path += ` C ${c1_cp1x} ${c1_cp1y} ${c1_cp2x} ${c1_cp2y} ${c1_endX} ${c1_endY}`
    
        // --- 第二段：垂直长线 ---
        const v_endY = y2 - (r * dirY)
        path += ` L ${verticalLineX} ${v_endY}`
    
        // --- 拐角 2 (垂直 -> 水平) ---
        const c2_cp1x = verticalLineX
        const c2_cp1y = v_endY + (k * r * dirY)
        const c2_endX = verticalLineX + (r * dirX)
        const c2_endY = y2
        const c2_cp2x = c2_endX - (k * r * dirX)
        const c2_cp2y = c2_endY
    
        path += ` C ${c2_cp1x} ${c2_cp1y} ${c2_cp2x} ${c2_cp2y} ${c2_endX} ${c2_endY}`
    } 
    // === 情况 B: 垂直空间不足 ===
    // 无法画出两个完整的 90 度弯，需要用两个圆弧片段平滑对接
    // 保持半径 r 不变，但只截取圆弧的一部分，形成平滑的 S 形
    else {
        // 计算圆弧截取的水平跨度 (几何推导: 1 - cos = dy/2r)
        // cos(theta) = 1 - dy / (2r)
        // sin(theta) = sqrt(1 - cos^2)
        // w = 2 * r * sin(theta)
        // 简化公式: half_w = sqrt(2rh - h^2) where h = dy/2
        const h = dy / 2
        const half_w = Math.sqrt(2 * r * h - h * h)
        
        const arcStartX = verticalLineX - (half_w * dirX)
        const midY = (y1 + y2) / 2
        const arcEndX = verticalLineX + (half_w * dirX)

        path += ` L ${arcStartX} ${y1}`

        // SVG Arc 命令: A rx ry x-axis-rotation large-arc-flag sweep-flag x y
        // Arc 1: 水平 -> 倾斜
        // 总是顺时针或总是逆时针取决于方向
        // 如果 LHS (dirX=-1), y2>y1 (dirY=1): Left -> Down. Counter-Clockwise? No.
        // (0,0) -> (-1, 1). Tangent (-1,0). Needs turn Left. CCW. sweep=0.
        // 如果 RHS (dirX=1), y2>y1 (dirY=1): Right -> Down. CW. sweep=1.
        const sweep1 = direction === 'rhs' ? 1 : 0
        
        // Arc 2: 倾斜 -> 水平
        // RHS: Down -> Right. CCW. sweep=0.
        // LHS: Down -> Left. CW. sweep=1.
        const sweep2 = direction === 'rhs' ? 0 : 1

        // 注意：如果是 y2 < y1 (向上)，dirY=-1.
        // RHS (Right -> Up): CCW. sweep=0.
        // LHS (Left -> Up): CW. sweep=1.
        // 看起来 sweep1 与 dirY 有关。
        
        const finalSweep1 = (direction === 'rhs' ? 1 : 0) ^ (y2 > y1 ? 0 : 1)
        const finalSweep2 = (direction === 'rhs' ? 0 : 1) ^ (y2 > y1 ? 0 : 1)

        path += ` A ${r} ${r} 0 0 ${finalSweep1} ${verticalLineX} ${midY}`
        path += ` A ${r} ${r} 0 0 ${finalSweep2} ${arcEndX} ${y2}`
    }
  
    // --- 第三段：连到终点 ---
    path += ` L ${x2} ${y2}`
  
    return path
  }
