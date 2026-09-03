/* 文案 key 保留现有 shared.* 身份，避免抽包迁移改变应用翻译目录。 */
export type SharedComponentMessageParamValue = string | number;
export type SharedComponentMessageParams = Readonly<
  Record<string, SharedComponentMessageParamValue>
>;

export type SharedColorMessageKey =
  | 'shared.color.red'
  | 'shared.color.crimson'
  | 'shared.color.pink'
  | 'shared.color.purple'
  | 'shared.color.indigo'
  | 'shared.color.blue'
  | 'shared.color.teal'
  | 'shared.color.mint'
  | 'shared.color.green'
  | 'shared.color.lime'
  | 'shared.color.yellow'
  | 'shared.color.orange'
  | 'shared.color.brown'
  | 'shared.color.slate'
  | 'shared.color.gray';

export type SharedComponentMessageKey =
  | 'shared.alert.cancel'
  | 'shared.alert.confirm'
  | 'shared.alert.title'
  | 'shared.characterCount.label'
  | SharedColorMessageKey
  | 'shared.colorPicker.backgroundTitle'
  | 'shared.colorPicker.clear'
  | 'shared.colorPicker.textTitle'
  | 'shared.customSelect.placeholder'
  | 'shared.customSelect.title'
  | 'shared.draggablePanel.title'
  | 'shared.modal.close'
  | 'shared.modal.title'
  | 'shared.numberSpin.stepDown'
  | 'shared.numberSpin.stepUp'
  | 'shared.simpleDatePicker.month.1'
  | 'shared.simpleDatePicker.month.2'
  | 'shared.simpleDatePicker.month.3'
  | 'shared.simpleDatePicker.month.4'
  | 'shared.simpleDatePicker.month.5'
  | 'shared.simpleDatePicker.month.6'
  | 'shared.simpleDatePicker.month.7'
  | 'shared.simpleDatePicker.month.8'
  | 'shared.simpleDatePicker.month.9'
  | 'shared.simpleDatePicker.month.10'
  | 'shared.simpleDatePicker.month.11'
  | 'shared.simpleDatePicker.month.12'
  | 'shared.simpleDatePicker.placeholder'
  | 'shared.simpleDatePicker.weekday.monday'
  | 'shared.simpleDatePicker.weekday.tuesday'
  | 'shared.simpleDatePicker.weekday.wednesday'
  | 'shared.simpleDatePicker.weekday.thursday'
  | 'shared.simpleDatePicker.weekday.friday'
  | 'shared.simpleDatePicker.weekday.saturday'
  | 'shared.simpleDatePicker.weekday.sunday'
  | 'shared.simpleDatePicker.year'
  | 'shared.timePicker.cancel'
  | 'shared.timePicker.confirm'
  | 'shared.timePicker.placeholder'
  | 'shared.scrollToBottom.title'
  | 'shared.secretInput.hide'
  | 'shared.secretInput.show'
  | 'shared.segmentedTabs.ariaLabel'
  | 'shared.textInput.clear'
  | 'shared.textPopover.triggerTitle';

export type SharedComponentMessageResolver = (
  key: SharedComponentMessageKey,
  params?: SharedComponentMessageParams
) => string;
