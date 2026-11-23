/** 只告诉交互式 Agent；无人值守运行沿用相同的基础提示时省略这个入口。 */
export const SCHEDULE_MANAGEMENT_PROMPT =
  'When the user asks you to do something at a future time or on a recurring schedule, run `linnya schedules --help` for the current project’s scheduled-task commands.';
