import { BODY_MAX_BYTES, DXF_MAX_BYTES, PDF_MAX_BYTES, FileError, sha256, validUuid, validateFile, validateFilename, type FileKind, type Manifest } from './validation.ts';
export type Receipt = { request_id: string; status: 'pending' | 'applied' | 'cancelled' | 'unknown'; action: string | null; entity_id: string | null; version: number | null };
export type Reservation = { receipt: Receipt; reservation: null | { lease_id: string; revision_id: string; bucket: 'fabrication-private'; dxf_path: string; pdf_path: string | null; manifest: Manifest } };
export type Download = { bucket: string; path: string; name: string; size: number; sha256: string; content_type: string; revision_number: number };
export type Cleanup = { bucket: string; paths: string[] };
export type Services = {
  verify(jwt: string): Promise<{ id: string }>;
  reserve(actor: string, requestId: string, p: Record<string, unknown>, manifest: Manifest): Promise<Reservation>;
  authorize(actor: string, requestId: string, leaseId: string): Promise<Reservation>;
  finalize(actor: string, requestId: string, leaseId: string): Promise<Receipt>;
  cancel(jwt: string, requestId: string, actor: string): Promise<Receipt>;
  cleanup(actor: string, requestId: string): Promise<Cleanup>;
  download(actor: string, revisionId: string, kind: FileKind): Promise<Download>;
  put(path: string, bytes: Uint8Array, contentType: string, digest: string): Promise<'created' | 'exists'>;
  get(path: string, limit: number): Promise<Uint8Array>;
  remove(paths: string[]): Promise<void>;
  allowedOrigins?: string[];
};
function fail(code: string, status: number, message: string): never { throw new FileError(code, status, message); }
function scopedPath(path: unknown, revisionId?: string): path is string {
  return typeof path === 'string' && path.length < 500 && /^[a-z0-9/_-]+\.(dxf|pdf)$/.test(path)
    && !path.startsWith('/') && !path.includes('..') && (!revisionId || path.split('/').includes(revisionId));
}
function checkedReservation(result: Reservation, requestId: string, revisionId?: string): NonNullable<Reservation['reservation']> {
  if (result.receipt.request_id !== requestId || result.receipt.status !== 'pending' || !result.reservation) fail('upload_unavailable', 409, 'This upload is no longer pending. Reload its status.');
  const r = result.reservation;
  if (r.bucket !== 'fabrication-private' || !validUuid(r.lease_id) || !validUuid(r.revision_id)
    || (revisionId && r.revision_id !== revisionId) || !scopedPath(r.dxf_path, r.revision_id)
    || (r.pdf_path !== null && !scopedPath(r.pdf_path, r.revision_id))) fail('invalid_reservation', 502, 'The server could not verify the upload reservation.');
  return r;
}
function sameManifest(a: Manifest, b: Manifest): boolean {
  return (['dxf', 'pdf'] as const).every(kind => {
    const x = a[kind], y = b[kind];
    return x === null ? y === null : !!y && x.name === y.name && x.size === y.size && x.sha256 === y.sha256;
  });
}
async function readBounded(req: Request, maximum: number): Promise<Uint8Array> {
  const length = req.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > maximum)) fail('request_too_large', 413, 'Request exceeds the allowed size.');
  if (!req.body) fail('invalid_request', 400, 'A request body is required.');
  const reader = req.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      if (req.signal.aborted) fail('request_aborted', 408, 'Request interrupted. Check its status before retrying.');
      const next = await reader.read(); if (next.done) break;
      size += next.value.byteLength;
      if (size > maximum) { await reader.cancel(); fail('request_too_large', 413, 'Request exceeds the allowed size.'); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let at = 0;
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
  return bytes;
}
function jsonObject(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function validateSubmission(p: unknown): asserts p is Record<string, unknown> {
  const keys = ['part_id', 'board_id', 'version', 'revision_id', 'name', 'material', 'thickness', 'thickness_unit', 'drawing_unit', 'quantity', 'needed_date', 'onshape_url', 'notes'];
  if (!jsonObject(p) || Object.keys(p).some(k => !keys.includes(k)) || keys.some(k => !(k in p))) fail('invalid_metadata', 422, 'Complete revision metadata is required.');
  for (const id of ['part_id', 'board_id', 'revision_id']) if (!validUuid(p[id])) fail('invalid_metadata', 422, 'Revision identifiers must be valid UUIDs.');
  if (!(p.version === null || Number.isSafeInteger(p.version) && Number(p.version) >= 1)
    || !['mm', 'in'].includes(String(p.drawing_unit)) || !['mm', 'in'].includes(String(p.thickness_unit))
    || typeof p.thickness !== 'number' || !Number.isFinite(p.thickness) || p.thickness <= 0 || p.thickness > 1000
    || !Number.isSafeInteger(p.quantity) || Number(p.quantity) < 1 || Number(p.quantity) > 100000) fail('invalid_metadata', 422, 'Choose explicit drawing and thickness units, positive thickness, and a valid quantity.');
  for (const key of ['name', 'material', 'notes', 'needed_date', 'onshape_url']) if (typeof p[key] !== 'string') fail('invalid_metadata', 422, 'Revision text fields must be strings.');
  if (!(p.name as string).trim() || (p.name as string).length > 200 || !(p.material as string).trim() || (p.material as string).length > 120 || (p.notes as string).length > 2000) fail('invalid_metadata', 422, 'Revision name, material, or notes exceed the allowed length.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.needed_date as string) || (p.needed_date as string).startsWith('0000') || !Number.isFinite(Date.parse(`${p.needed_date}T00:00:00Z`)) || new Date(`${p.needed_date}T00:00:00Z`).toISOString().slice(0, 10) !== p.needed_date) fail('invalid_metadata', 422, 'Needed date must be a valid calendar date.');
  if (p.onshape_url) {
    try {
      const url = new URL(p.onshape_url as string);
      if ((p.onshape_url as string).length > 2000 || /[\s\\\u0000-\u001f\u007f]/.test(p.onshape_url as string) || url.protocol !== 'https:' || url.username || url.password || url.port || url.hostname !== 'cad.onshape.com' || !/^\/documents\/[A-Za-z0-9]+(?:\/|$)/.test(url.pathname)) throw Error();
    } catch { fail('invalid_onshape_url', 422, 'Use an HTTPS Onshape document link.'); }
  }
}
async function cleanupCancelled(s: Services, actor: string, requestId: string) {
  // The RPC grants only terminal-cancelled paths. It never grants applied or ambiguous leases.
  const cleanup = await s.cleanup(actor, requestId);
  if (cleanup.bucket !== 'fabrication-private' || cleanup.paths.length > 2 || cleanup.paths.some(path => !scopedPath(path))) fail('cleanup_unavailable', 503, 'Cancellation is recorded but cleanup could not be verified.');
  if (cleanup.paths.length) await s.remove(cleanup.paths);
}
export async function handle(req: Request, s: Services): Promise<Response> {
  const origins = s.allowedOrigins || ['https://team.frc4418.org'];
  const origin = req.headers.get('origin');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
    'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Expose-Headers': 'Content-Disposition, X-Fabrication-Revision, X-Fabrication-Kind, X-Fabrication-SHA256, Content-Length', 'Vary': 'Origin',
  };
  if (origin && origins.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
  if (origin && !origins.includes(origin)) return reply(403, { code: 'origin_denied', error: 'Origin not allowed.' });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') return reply(405, { code: 'method_not_allowed', error: 'POST required.' });
  const jwt = req.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/i)?.[1];
  if (!jwt) return reply(401, { code: 'sign_in_required', error: 'Sign in required.' });
  let actor: string;
  try { const user = await s.verify(jwt); actor = user.id; if (!validUuid(actor)) throw Error(); }
  catch { return reply(401, { code: 'sign_in_required', error: 'Sign in required.' }); }
  let requestId: string | undefined;
  let leaseId: string | undefined;
  try {
    const contentType = req.headers.get('content-type') || '';
    if (/^multipart\/form-data\s*;/i.test(contentType)) {
      const raw = await readBounded(req, BODY_MAX_BYTES);
      let form: FormData;
      try { form = await new Response(raw as Uint8Array<ArrayBuffer>, { headers: { 'Content-Type': contentType } }).formData(); }
      catch { fail('invalid_request', 400, 'Malformed upload form.'); }
      const keys = ['action', 'request_id', 'expected_actor', 'p', 'dxf', 'pdf'];
      for (const key of form.keys()) if (!keys.includes(key) || form.getAll(key).length !== 1) fail('invalid_request', 400, 'Upload fields must be unique and supported.');
      if (form.get('action') !== 'upload' || !validUuid(form.get('request_id'))) fail('invalid_request', 400, 'A valid upload request ID is required.');
      requestId = form.get('request_id') as string;
      if (form.get('expected_actor') !== actor) fail('account_changed', 403, 'Your signed-in account changed. Reopen Fabrication.');
      const rawP = form.get('p'); let p: unknown;
      try { if (typeof rawP !== 'string' || rawP.length > 12000) throw Error(); p = JSON.parse(rawP); }
      catch { fail('invalid_metadata', 422, 'Valid revision metadata is required.'); }
      validateSubmission(p);
      const dxf = form.get('dxf'), pdf = form.get('pdf');
      if (!(dxf instanceof File) || (pdf !== null && !(pdf instanceof File))) fail('invalid_file', 422, 'A DXF file is required; PDF is optional.');
      const checkedDxf = await validateFile(dxf, 'dxf');
      const checkedPdf = pdf ? await validateFile(pdf as File, 'pdf') : null;
      const manifest = { dxf: checkedDxf.manifest, pdf: checkedPdf?.manifest || null };
      const reserved = await s.reserve(actor, requestId, p, manifest);
      if (reserved.receipt.status === 'applied') return reply(200, reserved.receipt);
      if (reserved.receipt.status === 'cancelled') { await cleanupCancelled(s, actor, requestId); return reply(200, reserved.receipt); }
      const reservation = checkedReservation(reserved, requestId, p.revision_id as string);
      leaseId = reservation.lease_id;
      if (!sameManifest(reservation.manifest, manifest) || !!reservation.pdf_path !== !!checkedPdf) fail('manifest_conflict', 409, 'The reservation does not match these files.');
      for (const [kind, file] of [['dxf', checkedDxf], ['pdf', checkedPdf]] as const) {
        if (!file) continue;
        const current = await s.authorize(actor, requestId, leaseId);
        if (current.receipt.status === 'applied') return reply(200, current.receipt);
        if (current.receipt.status === 'cancelled') { await cleanupCancelled(s, actor, requestId); return reply(200, current.receipt); }
        const permit = checkedReservation(current, requestId, reservation.revision_id);
        if (permit.lease_id !== leaseId || !sameManifest(permit.manifest, manifest) || permit.dxf_path !== reservation.dxf_path || permit.pdf_path !== reservation.pdf_path) fail('manifest_conflict', 409, 'The upload reservation changed.');
        if (req.signal.aborted) fail('request_aborted', 408, 'Upload interrupted. Check its status before retrying.');
        const path = kind === 'dxf' ? permit.dxf_path : permit.pdf_path!;
        const put = await s.put(path, file.bytes, file.contentType, file.manifest.sha256);
        if (put === 'exists') {
          // Duplicate/concurrent retries cannot replace objects. Verify actual stored bytes.
          const beforeRead = await s.authorize(actor, requestId, leaseId);
          if (beforeRead.receipt.status === 'applied') return reply(200, beforeRead.receipt);
          if (beforeRead.receipt.status === 'cancelled') { await cleanupCancelled(s, actor, requestId); return reply(200, beforeRead.receipt); }
          checkedReservation(beforeRead, requestId, reservation.revision_id);
          const existing = await s.get(path, file.manifest.size);
          if (existing.length !== file.manifest.size || await sha256(existing) !== file.manifest.sha256) fail('stored_file_conflict', 409, 'Stored file verification failed. Cancel this upload and submit a new revision.');
        }
      }
      if (req.signal.aborted) fail('request_aborted', 408, 'Upload interrupted. Check its status before retrying.');
      const receipt = await s.finalize(actor, requestId, leaseId);
      if (receipt.status === 'cancelled') await cleanupCancelled(s, actor, requestId);
      return reply(receipt.status === 'applied' || receipt.status === 'cancelled' ? 200 : 409, receipt);
    }
    if (!/^application\/json(?:\s*;|$)/i.test(contentType)) fail('unsupported_media_type', 415, 'Use multipart upload or a JSON file action.');
    let body: unknown;
    try { body = JSON.parse(new TextDecoder().decode(await readBounded(req, 4096))); }
    catch (error) { if (error instanceof FileError) throw error; fail('invalid_request', 400, 'Valid JSON required.'); }
    if (!jsonObject(body)) fail('invalid_request', 400, 'A file action is required.');
    if (body.expected_actor !== actor) fail('account_changed', 403, 'Your signed-in account changed. Reopen Fabrication.');
    if (body.action === 'cancel') {
      if (Object.keys(body).some(k => !['action', 'request_id', 'expected_actor'].includes(k)) || !validUuid(body.request_id)) fail('invalid_request', 400, 'A valid cancellation request ID is required.');
      requestId = body.request_id;
      const receipt = await s.cancel(jwt, requestId, actor);
      if (receipt.status === 'cancelled') await cleanupCancelled(s, actor, requestId);
      return reply(200, receipt);
    }
    if (body.action !== 'download' || Object.keys(body).some(k => !['action', 'revision_id', 'file_kind', 'expected_actor'].includes(k)) || !validUuid(body.revision_id) || !['dxf', 'pdf'].includes(String(body.file_kind))) fail('invalid_request', 400, 'A valid revision and file kind are required.');
    const revisionId = body.revision_id, kind = body.file_kind as FileKind;
    const file = await s.download(actor, revisionId, kind);
    if (file.bucket !== 'fabrication-private' || !scopedPath(file.path, revisionId) || !file.path.endsWith(`.${kind}`)
      || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > (kind === 'dxf' ? DXF_MAX_BYTES : PDF_MAX_BYTES)
      || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.revision_number) || file.revision_number < 1) fail('invalid_file_record', 502, 'The file record could not be verified.');
    validateFilename(file.name, kind);
    const bytes = await s.get(file.path, file.size);
    if (bytes.length !== file.size || await sha256(bytes) !== file.sha256) fail('checksum_mismatch', 502, 'File integrity could not be verified.');
    // Recheck current active membership/project access immediately before returning bytes.
    const current = await s.download(actor, revisionId, kind);
    if (current.path !== file.path || current.sha256 !== file.sha256 || current.size !== file.size || current.revision_number !== file.revision_number) fail('file_changed', 409, 'The authorized file changed. Reload Fabrication.');
    const filename = `${file.name.slice(0, -(kind.length + 1))}-r${file.revision_number}.${kind}`;
    return new Response(bytes as Uint8Array<ArrayBuffer>, { status: 200, headers: { ...headers,
      'Content-Type': kind === 'dxf' ? 'application/octet-stream' : 'application/pdf', 'Content-Length': String(bytes.length),
      'Content-Disposition': `attachment; filename="${filename}"`, 'X-Fabrication-Revision': revisionId,
      'X-Fabrication-Kind': kind, 'X-Fabrication-SHA256': file.sha256,
    } });
  } catch (error) {
    const e = error instanceof FileError ? error : new FileError('file_service_unavailable', 502, 'File action could not be confirmed. Check its status before retrying.');
    const errorBody = { code: e.code, error: e.message, ...(requestId ? { request_id: requestId } : {}) };
    const integrityFailure = ['stored_file_conflict', 'stored_size_mismatch'].includes(e.code);
    const definitive = integrityFailure || e.status >= 400 && e.status < 500 && ![408, 429].includes(e.status);
    // A post-reservation definitive failure must not strand an invisible pending lease.
    // Cancellation is itself atomic: if finalization won, it returns applied and forbids cleanup.
    if (requestId && leaseId && definitive) {
      try {
        const terminal = await s.cancel(jwt, requestId, actor);
        if (terminal.status === 'applied') return reply(200, terminal);
        if (terminal.status === 'cancelled') {
          try { await cleanupCancelled(s, actor, requestId); }
          catch (cleanupError) {
            // A revoked project can still cancel its actor-bound receipt, but cannot delete bytes.
            // The lease is terminal and quota stays charged; administrator maintenance handles orphans.
            if (!(cleanupError instanceof FileError) || ![401, 403].includes(cleanupError.status)) {
              return reply(503, { code: 'cleanup_pending', error: 'Cancellation is recorded, but file cleanup is pending. Check its status.', request_id: requestId, receipt: terminal });
            }
            return reply(e.status, { ...errorBody, receipt: terminal, cleanup_pending: true });
          }
          return integrityFailure ? reply(200, terminal) : reply(e.status, { ...errorBody, receipt: terminal });
        }
      } catch { /* An uncertain cancellation must retain the client recovery receipt. */ }
      return reply(503, { code: 'upload_outcome_unknown', error: 'The upload outcome could not be confirmed. Keep this request and check its status.', request_id: requestId });
    }
    // A finalize response can be lost after commit. Never delete or overwrite on an ambiguous result.
    if (requestId && leaseId) {
      try {
        const current = await s.authorize(actor, requestId, leaseId);
        if (current.receipt.status === 'applied') return reply(200, current.receipt);
        if (current.receipt.status === 'cancelled') { await cleanupCancelled(s, actor, requestId); return reply(200, current.receipt); }
      } catch { /* Preserve the original uncertain failure for actor-bound reconciliation. */ }
    }
    return reply(e.status, errorBody);
  }
}
