/**
 * position/index.js
 * 
 * 表格位置工具函数集中导出。
 * 这个文件将所有相关的表格工具函数导出，方便引用。
 */

// 基础位置工具
export * from './tablePositionUtils';

// 表格映射工具
export * from './tableMapUtils';

// 选区相关工具
export * from './tableSelectionUtils';

// 导航相关工具
export * from './tableNavigationUtils';

// 坐标系统工具
export * from './tableCoordinateUtils';


// 版本信息
export const TABLE_UTILS_VERSION = '1.0.0';

/**
 * 表格工具函数版本历史：
 * 1.0.0 - 初始版本，拆分位置工具函数，添加坐标系统和AI工具
 */ 