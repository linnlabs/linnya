export function replaceDatePart(base: Date, selectedDate: Date): Date {
  const result = new Date(base);
  result.setFullYear(
    selectedDate.getFullYear(),
    selectedDate.getMonth(),
    selectedDate.getDate(),
  );
  return result;
}
