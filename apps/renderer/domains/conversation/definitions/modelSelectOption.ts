/**
 * @file apps/renderer/domains/conversation/definitions/modelSelectOption.ts
 *
 * @description
 * 模型选择下拉（CustomSelect）的选项契约。
 *
 * 为什么放 definitions/：
 * - `AiAssistantInput.vue` 构建选项、`AiAssistantInputFooter.vue` 接收并透传给 CustomSelect，
 *   两处需要同一份类型契约，避免重复定义导致类型不一致（此前两处各定义一份，children
 *   类型一旦扩展就冲突）。
 * - 这是 conversation domain 内 UI 选项的公共契约，放 definitions/ 而非组件内部。
 *
 * children 使用递归契约承载 Provider → 模型 → 思考强度；搜索态会把模型扁平化，
 * 因而 searchText 只服务搜索匹配，不参与 CustomSelect 展示。递归只描述菜单层级，
 * 不把模型能力规则塞进共享 CustomSelect。
 */
export interface ModelSelectOption {
  isGroup?: boolean;
  isSeparator?: boolean;
  label?: string;
  value?: string;
  text?: string;
  disabled?: boolean;
  disabledReason?: string;
  allowDirectSelect?: boolean;
  searchText?: string;
  shortcut?: string;
  variant?: 'danger';
  children?: ModelSelectOption[];
}
