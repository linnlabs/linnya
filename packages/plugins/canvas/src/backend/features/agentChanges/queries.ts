/** 人/CI只读进程使用的窄入口，不装配提交、审批或历史运行态。 */
export {
  readCanvasAgentRequestStatus,
  projectCanvasAgentReceiptQuery,
} from './persistence/readCanvasAgentReceipts';
