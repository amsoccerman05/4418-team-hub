export function wallTime(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value));
  const part = (name: string) => parts.find(p => p.type === name)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}
/** Reject DST gaps and duplicate local times instead of guessing a UTC instant. */
export function serviceInstant(localTime: string, timezone: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(localTime);
  if (!match) throw Error('Choose a meal date and time.');
  const nominal = Date.UTC(...([Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5])] as [number, number, number, number, number]));
  if (new Date(nominal).toISOString().slice(0, 16) !== localTime) throw Error('Choose a valid meal date and time.');
  const offsets = new Set<number>();
  for (let hours = -36; hours <= 36; hours += 6) {
    const sample = nominal + hours * 3600000;
    const zoned = wallTime(new Date(sample).toISOString(), timezone);
    offsets.add(Date.parse(`${zoned}:00Z`) - sample);
  }
  const instants = [...offsets].map(offset => new Date(nominal - offset).toISOString()).filter(instant => wallTime(instant, timezone) === localTime);
  if (instants.length !== 1) throw Error(instants.length ? 'This local time occurs twice because of daylight saving time. Choose an unambiguous time.' : 'This local time does not exist because of daylight saving time. Choose another time.');
  return instants[0];
}
