# Production corrections, 2026-09-16

Finance worker v5 reached Auth successfully but its profile SELECT returned 403: service_role lacked id/active/role SELECT. The corrective migration grants only those columns. Hub uses its existing audience RPC. No provider/queue/approval behavior changes.

Team Management already requires an active mentor/admin. Self base-role changes are now rejected; Mentor cannot newly assign legacy Admin. Mentors retain authority to promote other members to Mentor. Existing final mentor/admin checks remain.

Legacy admin remains in team_private.admin, Team Management member/state/invitation authorization; finance_private capability/manager checks; Attendance manager helpers; Inventory private role/edit helpers and profile guard; Pit leadership helpers; shared profile RLS. These compatibility dependencies are intentionally unchanged. Positions retain only existing explicit Finance mappings.
