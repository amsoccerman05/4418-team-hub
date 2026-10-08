/** Short-lived encrypted delivery envelope. The auth tables retain only token
 * hashes; the exact provider bytes can be recovered without replacing links.
 * MEALS_ENVELOPE_KEY is a separately configured 32-byte base64 wrapping key.
 * Never log inputs, decoded provider bodies, keys, or crypto exceptions. */
const encoder = new TextEncoder();
const MAX_BYTES = 64 * 1024;
export const SYNTHETIC_ENVELOPE_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
function decode(value: unknown): Uint8Array {
    if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error('Invalid delivery envelope');
    const bytes = Uint8Array.from(atob(value), c => c.charCodeAt(0));
    if (encode(bytes) !== value) throw new Error('Invalid delivery envelope');
    return bytes;
}
export type DeliveryIdentity = { id: string; claim_id: string; idempotency_key: string };
const aad = (identity: DeliveryIdentity, purpose: string) => encoder.encode(JSON.stringify(['meal-envelope-v1', purpose, identity.id, identity.claim_id, identity.idempotency_key]));
export function createMealEnvelope(base64Key: string) {
    const rawKey = decode(base64Key);
    if (rawKey.byteLength !== 32) throw new Error('MEALS_ENVELOPE_KEY must be 32 base64-encoded bytes');
    const wrappingKey = crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
    rawKey.fill(0);
    return {
        async seal(payload: string, identity: DeliveryIdentity): Promise<string> {
            const plaintext = encoder.encode(payload);
            if (!plaintext.length || plaintext.length > MAX_BYTES) throw new Error('Invalid delivery envelope');
            const rawDataKey = crypto.getRandomValues(new Uint8Array(32));
            try {
                const dataKey = await crypto.subtle.importKey('raw', rawDataKey, 'AES-GCM', false, ['encrypt']);
                const iv = crypto.getRandomValues(new Uint8Array(12)), keyIv = crypto.getRandomValues(new Uint8Array(12));
                const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(identity, 'body'), tagLength: 128 }, dataKey, plaintext);
                const wrappedKey = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: keyIv, additionalData: aad(identity, 'key'), tagLength: 128 }, await wrappingKey, rawDataKey);
                return JSON.stringify({ v: 1, iv: encode(iv), ciphertext: encode(new Uint8Array(ciphertext)), keyIv: encode(keyIv), wrappedKey: encode(new Uint8Array(wrappedKey)) });
            } finally { rawDataKey.fill(0); plaintext.fill(0); }
        },
        async open(envelope: string, identity: DeliveryIdentity): Promise<string> {
            let rawDataKey: Uint8Array | undefined;
            try {
                if (envelope.length > 131072) throw new Error();
                const box = JSON.parse(envelope);
                if (!box || box.v !== 1 || Object.keys(box).sort().join(',') !== 'ciphertext,iv,keyIv,v,wrappedKey') throw new Error();
                const iv = decode(box.iv), keyIv = decode(box.keyIv), ciphertext = decode(box.ciphertext), wrappedKey = decode(box.wrappedKey);
                if (iv.length !== 12 || keyIv.length !== 12 || wrappedKey.length !== 48 || ciphertext.length < 17 || ciphertext.length > MAX_BYTES + 16) throw new Error();
                rawDataKey = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: keyIv, additionalData: aad(identity, 'key'), tagLength: 128 }, await wrappingKey, wrappedKey));
                const dataKey = await crypto.subtle.importKey('raw', rawDataKey, 'AES-GCM', false, ['decrypt']);
                const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad(identity, 'body'), tagLength: 128 }, dataKey, ciphertext);
                return new TextDecoder('utf-8', { fatal: true }).decode(plaintext);
            } catch { throw new Error('Delivery envelope could not be authenticated'); }
            finally { rawDataKey?.fill(0); }
        },
    };
}
