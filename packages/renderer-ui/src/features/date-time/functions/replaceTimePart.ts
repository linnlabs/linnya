export function replaceTimePart(base: Date, hour: number, minute: number): Date {
  const result = new Date(base);
  result.setHours(hour, minute, 0, 0);
  return result;
}
