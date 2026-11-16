/** Move an 'HH:MM' value by whole hours, wrapping at midnight. */
export function shiftHour(value: string, by: number): string {
  const hour = Number(value.slice(0, 2));
  const next = (((hour + by) % 24) + 24) % 24;
  return `${String(next).padStart(2, '0')}:00`;
}
