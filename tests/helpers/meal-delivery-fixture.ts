import { mockProviderUsage } from '../../supabase/functions/team-meals/mail.ts';
/** Structural ciphertext fixture for direct SQL transaction tests only. No
 * plaintext, real capability or address is encoded; these rows are never sent.
 * Full handler/Edge tests use real authenticated envelopes with ephemeral keys. */
export const SQL_DELIVERY_ENVELOPE = JSON.stringify({ v: 1, iv: 'A'.repeat(16), ciphertext: 'A'.repeat(24), keyIv: 'B'.repeat(16), wrappedKey: 'B'.repeat(64) });
export const syntheticProviderUsage = () => JSON.stringify(mockProviderUsage());
/** Only after creating a brand-new disposable fixture. Production stays off. */
export const syntheticMailApproval = (limit: number) => `update meals_private.mail_budget set daily_limit=${limit},mail_enabled=true,quota_approved_until=clock_timestamp()+interval '1 day',reserved_daily=0,reserved_monthly=0,notification_daily_allowance=0`;
