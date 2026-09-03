// src/renderer/extensions/annotation/commands/index.js
/**
 * 批注命令索引文件
 * 导出所有批注相关命令
 */

// 导入命令模块 (修正路径大小写)
import * as StateCommands from './AnnoStateCommands';
import * as DeleteCommands from './AnnoDeleteCommands';
import * as CreateCommands from './AnnoCreateCommands';
import * as MoveCommands from './AnnoMoveCommands';

// 导出状态命令 (修正路径大小写)
export {
  AnnotationState,
  startEditingAnnotation,
  cancelEditingAnnotation,
  saveEditAnnotation,
  resolveAnnotation,
  reopenAnnotation
} from './AnnoStateCommands';

// 导出删除命令 (修正路径大小写)
export {
  deleteAnnotation,
  batchDeleteAnnotations,
  deleteBlockAnnotations
} from './AnnoDeleteCommands';

// 导出创建命令 (修正路径大小写)
export {
  startCreatingAnnotation,
  cancelCreatingAnnotation,
  confirmCreatingAnnotation,
} from './AnnoCreateCommands';

// 导出移动命令 (修正路径大小写)
export {
  updateAnnotationsPositionForMovedBlock,
  moveAnnotationToBlock
} from './AnnoMoveCommands';

// 默认导出所有命令的组合
export default {
  // 状态命令
  ...StateCommands,
  // 删除命令
  ...DeleteCommands,
  // 创建命令
  ...CreateCommands,
  // 移动命令
  ...MoveCommands
}; 