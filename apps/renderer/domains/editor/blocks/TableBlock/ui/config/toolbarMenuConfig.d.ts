export interface ToolbarMenuOption {
  value: string;
  text: string;
  icon?: string;
}

export type ToolbarMenuOptionType = 'insert' | 'delete' | 'ai' | 'align' | 'debug' | 'cell';

export const insertOptions: ToolbarMenuOption[];
export const deleteOptions: ToolbarMenuOption[];
export const aiOptions: ToolbarMenuOption[];
export const alignOptions: ToolbarMenuOption[];
export const debugOptions: ToolbarMenuOption[];
export const cellOptions: ToolbarMenuOption[];

export function getMenuOptions(optionType: ToolbarMenuOptionType): ToolbarMenuOption[];

declare const toolbarMenuConfig: {
  insertOptions: ToolbarMenuOption[];
  deleteOptions: ToolbarMenuOption[];
  aiOptions: ToolbarMenuOption[];
  alignOptions: ToolbarMenuOption[];
  debugOptions: ToolbarMenuOption[];
  cellOptions: ToolbarMenuOption[];
  getMenuOptions: typeof getMenuOptions;
};

export default toolbarMenuConfig;
