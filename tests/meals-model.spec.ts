import { test, expect } from '@playwright/test';
import { serviceInstant, wallTime } from '../src/meals/time';

test('Chicago Saturday noon stays on the same date in standard and daylight time', () => {
  expect(serviceInstant('2027-01-09T12:00', 'America/Chicago')).toBe('2027-01-09T18:00:00.000Z');
  expect(wallTime('2027-01-09T18:00:00.000Z', 'America/Chicago')).toBe('2027-01-09T12:00');
  expect(serviceInstant('2027-07-10T12:00', 'America/Chicago')).toBe('2027-07-10T17:00:00.000Z');
  expect(wallTime('2027-07-10T17:00:00.000Z', 'America/Chicago')).toBe('2027-07-10T12:00');
});

test('nonexistent spring-forward local times fail without shifting the meal', () => {
  expect(() => serviceInstant('2027-03-14T02:30', 'America/Chicago')).toThrow('does not exist because of daylight saving time');
  expect(() => serviceInstant('2027-03-14T02:30', 'America/New_York')).toThrow('does not exist because of daylight saving time');
  expect(serviceInstant('2027-03-14T03:30', 'America/Chicago')).toBe('2027-03-14T08:30:00.000Z');
});

test('ambiguous autumn local times fail rather than silently choosing an offset', () => {
  expect(() => serviceInstant('2026-11-01T01:30', 'America/Chicago')).toThrow('occurs twice because of daylight saving time');
  expect(() => serviceInstant('2026-11-01T01:30', 'America/New_York')).toThrow('occurs twice because of daylight saving time');
  expect(serviceInstant('2026-11-01T02:30', 'America/Chicago')).toBe('2026-11-01T08:30:00.000Z');
});

test('explicit zones work independently of the runtime timezone including fractional offsets', () => {
  expect(serviceInstant('2027-01-09T12:00', 'Asia/Kathmandu')).toBe('2027-01-09T06:15:00.000Z');
  expect(serviceInstant('2027-01-09T12:00', 'Asia/Kolkata')).toBe('2027-01-09T06:30:00.000Z');
  expect(serviceInstant('2027-01-09T12:00', 'UTC')).toBe('2027-01-09T12:00:00.000Z');
  expect(wallTime('2027-01-09T12:00:00Z', 'America/Chicago')).toBe('2027-01-09T06:00');
});

test('invalid dates and zones do not produce an instant', () => {
  expect(() => serviceInstant('2027-02-30T12:00', 'America/Chicago')).toThrow('valid meal date');
  expect(() => serviceInstant('2027-01-09T25:00', 'America/Chicago')).toThrow('valid meal date');
  expect(() => serviceInstant('', 'America/Chicago')).toThrow('Choose a meal date and time');
  expect(() => serviceInstant('2027-01-09T12:00', 'Not/A_Timezone')).toThrow();
});

test('midnight is represented as hour zero and round trips across year boundaries', () => {
  expect(wallTime('2027-01-01T06:00:00.000Z', 'America/Chicago')).toBe('2027-01-01T00:00');
  expect(serviceInstant('2027-01-01T00:00', 'America/Chicago')).toBe('2027-01-01T06:00:00.000Z');
  expect(serviceInstant('2027-01-01T00:00', 'Pacific/Auckland')).toBe('2026-12-31T11:00:00.000Z');
});
