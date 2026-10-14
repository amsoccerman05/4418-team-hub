# STEM outreach attendance and annual hours

STEM Outreach is an optional Attendance event type with the same six-digit code, check-in and checkout flow as team meetings. Outreach events appear on all active Attendance participants’ signed-in TeamHub calendars. No Google Calendar invitations or public personal totals are created.

## Lettering period

The confirmed requirement is 10 hours in each May 1–April 30 year, using America/Denver time. The default report chooses the current year on the server. A year selector exposes prior records. Totals are computed from preserved timestamps; no annual job deletes, zeros or rewrites attendance. Events crossing the annual boundary contribute only the elapsed time inside each period. Leap days and UTC offset changes use PostgreSQL’s time-zone rules.

Only actual recorded arrivals and departures count. Missing departures contribute no estimated hours. Overlapping intervals count once per participant. Mentor volunteer logs remain separate. Hours support human review; the tool does not award letters or replace other requirements.

## Authorization and safeguards

Students receive only their own totals. Existing leadership readers can see team totals and recorded inactive-participant history. Outreach calendar visibility does not expose another participant’s attendance. New participants can see events immediately; explicit leadership roster sync adds their optional check-in entry.

Database triggers enforce optional snapshots and prohibit all outreach attendance strikes, including manually requested strikes. Normal meeting strike behavior remains unchanged. Meeting type cannot be converted into or out of outreach to relabel existing attendance history.

Existing meeting managers may correct verified outreach arrival/departure times, with a required reason and current record version. Corrections are restricted to the event’s attendance window, reject future times, serialize with checkout, and retain audit history. No correction occurs automatically during deployment. Mentors/admins may change the displayed hours target for all years through a versioned, audited setting; the annual boundary stays fixed.

## Release and validation

Apply `20261014052049_attendance_stem_outreach.sql` only after the reviewed commit’s database, browser, native concurrency and disposable Auth/PostgREST checks pass. It adds no historical outreach events or fabricated hours. Preserve the previously deployed check-in hardening and 30-minute checkout grace.

Regression coverage includes strike prohibition, normal-meeting compatibility, optional snapshots, scoped totals, overlap deduplication, missing checkout, leap day, Denver-local annual boundary splitting, prior-year preservation, audited corrections, roster sync, and inactive-participant history. Browser tests use synthetic records at 390px and 1440px. Integration tests must retain their loopback-only disposable-stack guards.
