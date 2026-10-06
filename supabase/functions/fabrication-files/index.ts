import { createClient } from 'npm:@supabase/supabase-js@2.116.0';
import { handle, immutableObjectConflict, type Services } from './handler.ts';
import { FileError } from './validation.ts';

const url = Deno.env.get('SUPABASE_URL') || '';
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const configuredOrigins = (Deno.env.get('FABRICATION_ALLOWED_ORIGINS') || 'https://team.frc4418.org').split(',').map(v => v.trim()).filter(Boolean);
const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init, signal: AbortSignal.any([...(init?.signal ? [init.signal] : []), AbortSignal.timeout(30_000)]) }),
} };
// Never set a caller Authorization header on the service client: it has one fixed, backend-only purpose.
const service = url && serviceKey ? createClient(url, serviceKey, options) : null;
const auth = url && anonKey ? createClient(url, anonKey, options) : null;
const safeErrors: Record<string, [number, string]> = {
  FB401: [401, 'Sign in with an active team account.'], FB403: [403, 'This project or file is no longer available to your account.'],
  FB409: [409, 'The part changed. Refresh before submitting a new revision.'], FB412: [412, 'This request key cannot be reused with different data.'],
  FB413: [413, 'The upload capacity limit was reached. Ask a team administrator to review storage.'], FB422: [422, 'Check the revision metadata and required files.'],
};
function checked<T>(result: { data: T; error: null | { code?: string } }): T {
  if (result.error) {
    const code = result.error.code || '';
    const error = safeErrors[code];
    if (error) throw new FileError(code, error[0], error[1]);
    throw new FileError('file_service_unavailable', 502, 'File action could not be confirmed. Check its status before retrying.');
  }
  return result.data;
}
// Exact allowlisted RPC calls only; no client-provided RPC name, bucket, path, or service operation.
const services: Services = {
  allowedOrigins: configuredOrigins,
  async verify(jwt) {
    if (!auth || !service) throw Error('Configuration unavailable');
    const { data, error } = await auth.auth.getUser(jwt);
    if (error || !data.user || data.user.is_anonymous) throw Error('Sign in required');
    return { id: data.user.id };
  },
  async reserve(actor, requestId, p, manifest) {
    return checked(await service!.rpc('fabrication_reserve_upload', { actor, request_id: requestId, p, manifest }).retry(false));
  },
  async authorize(actor, requestId, leaseId) {
    return checked(await service!.rpc('fabrication_upload_authorize', { actor, request_id: requestId, lease_id: leaseId }).retry(false));
  },
  async finalize(actor, requestId, leaseId) {
    return checked(await service!.rpc('fabrication_finalize_upload', { actor, request_id: requestId, lease_id: leaseId }).retry(false));
  },
  async cancel(jwt, requestId, actor) {
    const caller = createClient(url, anonKey, { ...options, global: { ...options.global, headers: { Authorization: `Bearer ${jwt}` } } });
    return checked(await caller.rpc('fabrication_cancel_mutation', { request_id: requestId, expected_actor: actor }).retry(false));
  },
  async cleanup(actor, requestId) {
    return checked(await service!.rpc('fabrication_cancelled_upload_paths', { actor, request_id: requestId, lease_id: null }).retry(false));
  },
  async download(actor, revisionId, kind) {
    return checked(await service!.rpc('fabrication_download_file', { actor, revision_id: revisionId, file_kind: kind }).retry(false));
  },
  async put(path, bytes, contentType, digest) {
    const { error } = await service!.storage.from('fabrication-private').upload(path, bytes, {
      upsert: false, contentType, cacheControl: '0', metadata: { sha256: digest },
    });
    if (!error) return 'created';
    // An existing immutable object is never replaced. Handler reauthorizes then checks its bytes.
    if (immutableObjectConflict(error)) return 'exists';
    throw new FileError('storage_write_unconfirmed', 502, 'The upload could not be confirmed. Check its status before retrying.');
  },
  async get(path, limit) {
    // Bound the actual response stream before buffering; do not trust object metadata alone.
    const response = await fetch(`${url}/storage/v1/object/authenticated/fabrication-private/${path.split('/').map(encodeURIComponent).join('/')}`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` }, signal: AbortSignal.timeout(30_000), redirect: 'error',
    });
    if (!response.ok || !response.body) throw new FileError('storage_read_unconfirmed', 502, 'The stored file could not be read.');
    const declared = response.headers.get('content-length');
    if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) { await response.body.cancel(); throw new FileError('stored_size_mismatch', 502, 'Stored file size does not match its revision.'); }
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
    try {
      while (true) {
        const result = await reader.read(); if (result.done) break;
        length += result.value.length;
        if (length > limit) { await reader.cancel(); throw new FileError('stored_size_mismatch', 502, 'Stored file size does not match its revision.'); }
        chunks.push(result.value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes;
  },
  async remove(paths) {
    const { error } = await service!.storage.from('fabrication-private').remove(paths);
    if (error) throw new FileError('cleanup_pending', 503, 'Cancellation is recorded, but file cleanup is pending. Check its status again.');
  },
};
Deno.serve(request => handle(request, services));
