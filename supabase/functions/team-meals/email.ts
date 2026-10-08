import type { VerificationMail } from './mail.ts';

/** This exact JSON body is encrypted in the private outbox before provider I/O.
 * Never add timestamps, random values, headers, or configuration during retry. */
export type MealEmail = { from: string; to: string[]; subject: string; html: string; text: string };
export const escapeMealHtml = (value: string): string => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
const address = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/;
export function validMealSender(value: string): boolean {
    if (!value || value.length > 320 || /[\r\n\u0000-\u001f\u007f]/.test(value)) return false;
    const match = /^(?:[^<>]+ <([^<>]+)>|([^<>]+))$/.exec(value);
    return Boolean(match && address.test(match[1] ?? match[2]));
}
function link(value: string, token: string, purpose: 'verify' | 'manage'): URL {
    const url = new URL(value);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) || url.username || url.password || url.search ||
        !/^m1_[a-f0-9]{64}$/.test(token) || url.hash !== `#${purpose}=${token}`) throw new Error('Invalid meal email');
    return url;
}
export function renderMealVerification(mail: VerificationMail, from: string): MealEmail {
    if (!validMealSender(from) || !address.test(mail.to) || mail.to.length > 254) throw new Error('Invalid meal email');
    const verify = link(mail.verificationUrl, mail.verificationToken, 'verify');
    const manage = link(mail.manageUrl, mail.manageToken, 'manage');
    if (verify.origin !== manage.origin || verify.pathname !== manage.pathname) throw new Error('Invalid meal email');
    const subject = 'Confirm your Saturday meal signup | 4418 IMPULSE';
    const text = `4418 IMPULSE\nConfirm your Saturday meal signup\n\nYour contribution counts only after you confirm it. Open the verification link before the temporary hold expires, within 15 minutes or before the meal begins, whichever comes first.\n\nConfirm signup: ${verify}\n\nAfter confirming, keep this private link to view, change, or cancel your own signup: ${manage}\n\nDo not forward these private links. If you did not request this signup, ignore this email; the unconfirmed hold expires automatically. Contact the meal coordinator if you need help.`;
    const html = `<!doctype html><html><body style="margin:0;background:#fbfbfb;font-family:Arial,sans-serif;color:#333333"><main style="max-width:560px;margin:24px auto;padding:24px;background:#ffffff;border:1px solid #d5d5d5;border-top:4px solid #006bb3;border-radius:12px"><p style="font-weight:bold;letter-spacing:1px">4418 IMPULSE</p><h1 style="font-size:23px">Confirm your Saturday meal signup</h1><p>Your contribution counts only after you confirm it. Open this link within 15 minutes or before the meal begins, whichever comes first.</p><p style="margin:28px 0"><a href="${escapeMealHtml(verify.toString())}" style="display:inline-block;background:#006bb3;color:#ffffff;text-decoration:none;padding:14px 20px;border-radius:6px;font-weight:bold">Confirm signup</a></p><p>After confirming, keep your <a href="${escapeMealHtml(manage.toString())}">private management link</a> to view, change, or cancel your signup.</p><p style="font-size:12px;color:#606060">Do not forward these private links. If you did not request this signup, ignore this email; the unconfirmed hold expires automatically. Contact the meal coordinator if you need help.</p></main></body></html>`;
    return { from, to: [mail.to], subject, html, text };
}

/** Validate a recovered envelope without reserializing its immutable bytes. */
export function validPreparedMealEmail(payload: string): boolean {
    if (payload.length > 32768) return false;
    try {
        const mail: unknown = JSON.parse(payload);
        if (!mail || typeof mail !== 'object' || Array.isArray(mail)) return false;
        const value = mail as Record<string, unknown>;
        if (Object.keys(value).sort().join(',') !== 'from,html,subject,text,to') return false;
        return typeof value.from === 'string' && validMealSender(value.from) && Array.isArray(value.to) && value.to.length === 1 &&
            typeof value.to[0] === 'string' && value.to[0].length <= 254 && address.test(value.to[0]) &&
            typeof value.subject === 'string' && value.subject.length > 0 && value.subject.length <= 200 && !/[\r\n\u0000-\u001f\u007f]/.test(value.subject) &&
            typeof value.html === 'string' && value.html.length > 0 && typeof value.text === 'string' && value.text.length > 0;
    } catch { return false; }
}
