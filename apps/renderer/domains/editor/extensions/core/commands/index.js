/**
 * 命令索引文件
 * 
 * 导出所有命令，方便统一导入
 */

// 导入命令模块
import * as SplitCommands from './SplitCommands';
import * as MergeCommands from './MergeCommands';
import * as ConversionCommands from './ConversionCommands';
import * as MoveCommands from './MoveCommands';
import * as InsertCommands from './InsertCommands';
import * as RemoveCommands from './RemoveCommands';
import * as HorizontalRuleCommands from './HorizontalRuleCommands';
import * as ReplaceCommands from './ReplaceCommands';
import * as RevisionCommands from './RevisionCommands';
import BlockQueryCommands from './BlockQueryCommands';


// 导出所有命令
export {
  SplitCommands,
  MergeCommands,
  ConversionCommands,
  MoveCommands,
  InsertCommands,
  RemoveCommands,
  BlockQueryCommands,
  HorizontalRuleCommands,
  ReplaceCommands,
  RevisionCommands,
};

// 默认导出所有命令的集合
export default {
  ...SplitCommands,
  ...MergeCommands,
  ...ConversionCommands,
  ...MoveCommands,
  ...InsertCommands,
  ...RemoveCommands,
  ...BlockQueryCommands,
  ...HorizontalRuleCommands,
  ...ReplaceCommands,
  ...RevisionCommands,
}; 