// Generate local wall-clock dates (including DST), then convert each occurrence to UTC.
export type Repeat = "none" | "weekly" | "custom";
export function occurrences(
  start: string,
  end: string,
  repeat: Repeat,
  until: string,
  interval: number,
  weekdays: number[],
) {
  const first = new Date(start),
    finish = new Date(end);
  if (!Number.isFinite(+first) || !Number.isFinite(+finish) || finish <= first)
    throw new Error("End time must be after start time.");
  if (repeat === "none")
    return [{ starts_at: first.toISOString(), ends_at: finish.toISOString() }];
  if (start.slice(0, 10) !== end.slice(0, 10))
    throw new Error("Repeating meetings must start and end on the same day.");
  const last = new Date(`${until}T23:59:59`);
  if (!Number.isFinite(+last) || last < first)
    throw new Error("Repeat end date must be on or after the start date.");
  if (+last - +first > 366 * 86400000)
    throw new Error("Choose a recurrence range of up to one year.");
  if (!Number.isInteger(interval) || interval < 1 || interval > 12)
    throw new Error("Repeat every 1–12 weeks.");
  const days = repeat === "weekly" ? [first.getDay()] : weekdays;
  if (!days.length) throw new Error("Select at least one weekday.");
  const anchor =
    Date.UTC(first.getFullYear(), first.getMonth(), first.getDate()) -
    first.getDay() * 86400000;
  const result = [];
  for (
    const date = new Date(first);
    date <= last;
    date.setDate(date.getDate() + 1)
  ) {
    const week = Math.floor(
      (Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - anchor) /
        (7 * 86400000),
    );
    if (
      week % (repeat === "weekly" ? 1 : interval) ||
      !days.includes(date.getDay())
    )
      continue;
    const stop = new Date(date);
    stop.setHours(finish.getHours(), finish.getMinutes(), 0, 0);
    if (stop <= date) throw new Error("Invalid local time in this recurrence.");
    result.push({ starts_at: date.toISOString(), ends_at: stop.toISOString() });
    if (result.length > 52)
      throw new Error(
        "Limit each creation to 52 meetings. Shorten the date range.",
      );
  }
  if (!result.length) throw new Error("No meetings match the selected dates.");
  return result;
}
