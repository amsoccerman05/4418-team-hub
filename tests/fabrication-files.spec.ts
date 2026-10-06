import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { handle, immutableObjectConflict, type Services, type Receipt, type Reservation } from '../supabase/functions/fabrication-files/handler';
import { BODY_MAX_BYTES, FileError, sha256, validateDxf, validatePdf, validateFilename, validateFile, type Manifest } from '../supabase/functions/fabrication-files/validation';

const actor = '10000000-0000-0000-0000-000000000001', board = '20000000-0000-0000-0000-000000000001';
const part = '30000000-0000-0000-0000-000000000001', revision = '40000000-0000-0000-0000-000000000001';
const requestId = '50000000-0000-0000-0000-000000000001', lease = '60000000-0000-0000-0000-000000000001';
const prefix = `${board}/${part}/${revision}`;
const encode = (text: string) => new TextEncoder().encode(text);
// Synthetic in-memory fixtures only. No CAD or customer document files are committed or uploaded.
const dxfText = '0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n0\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n0\nLINE\n8\n0\n10\n0\n20\n0\n11\n25.4\n21\n10\n0\nENDSEC\n0\nEOF\n';
function pdfBytes(extra = '') {
  let text = '%PDF-1.4\n'; const offsets = [0];
  for (const [i, content] of ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] ${extra} >>`].entries()) { offsets.push(text.length); text += `${i + 1} 0 obj\n${content}\nendobj\n`; }
  const xref = text.length;
  text += 'xref\n0 4\n0000000000 65535 f \n';
  for (const at of offsets.slice(1)) text += `${String(at).padStart(10, '0')} 00000 n \n`;
  return encode(text + `trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
}
const metadata = { part_id: part, board_id: board, revision_id: revision, version: null, name: 'Bracket', material: 'Plywood', thickness: 0.25, thickness_unit: 'in', drawing_unit: 'mm', quantity: 2, needed_date: '2026-10-20', notes: '', onshape_url: 'https://cad.onshape.com/documents/abc123/w/xyz/e/123' };
function upload(options: { pdf?: boolean; dxf?: string; filename?: string; mime?: string; p?: unknown; expected_actor?: string; extra?: [string, string]; signal?: AbortSignal } = {}) {
  const form = new FormData(); form.set('action', 'upload'); form.set('request_id', requestId); form.set('expected_actor', options.expected_actor || actor); form.set('p', JSON.stringify(options.p || metadata));
  form.set('dxf', new File([options.dxf ?? dxfText], options.filename || 'Bracket.dxf', { type: options.mime || 'application/dxf' }));
  if (options.pdf) form.set('pdf', new File([pdfBytes()], 'Bracket.pdf', { type: 'application/pdf' }));
  if (options.extra) form.append(...options.extra);
  return new Request('https://edge.test/fabrication-files', { method: 'POST', headers: { Origin: 'https://team.frc4418.org', Authorization: 'Bearer verified-token' }, body: form, signal: options.signal });
}
function action(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new Request('https://edge.test/fabrication-files', { method: 'POST', headers: { Origin: 'https://team.frc4418.org', Authorization: 'Bearer verified-token', 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ expected_actor: actor, ...body }) });
}
function fixture() {
  const calls: string[] = [], objects = new Map<string, Uint8Array>();
  let status: Receipt['status'] = 'pending', manifest: Manifest | null = null, saved = '', available = true;
  const receipt = (): Receipt => ({ request_id: requestId, status, action: status === 'applied' ? 'revision' : null, entity_id: status === 'applied' ? part : null, version: status === 'applied' ? 1 : null });
  const check = () => { if (!available) throw new FileError('FB403', 403, 'Project unavailable.'); };
  const reservation = (): Reservation => ({ receipt: receipt(), reservation: manifest ? { lease_id: lease, revision_id: revision, bucket: 'fabrication-private', dxf_path: `${prefix}/drawing.dxf`, pdf_path: manifest.pdf ? `${prefix}/drawing.pdf` : null, manifest } : null });
  const s: Services = {
    verify: async jwt => { calls.push('verify'); expect(jwt).toBe('verified-token'); return { id: actor }; },
    reserve: async (id, key, p, m) => { calls.push('reserve'); check(); expect(id).toBe(actor); expect(key).toBe(requestId); const payload = JSON.stringify([p, m]); if (saved && payload !== saved) throw new FileError('FB412', 412, 'Conflicting retry.'); saved = payload; manifest = m; return reservation(); },
    authorize: async (id, key, token) => { calls.push('authorize'); check(); expect([id, key, token]).toEqual([actor, requestId, lease]); return reservation(); },
    finalize: async () => { calls.push('finalize'); check(); if (status === 'pending') status = 'applied'; return receipt(); },
    cancel: async (jwt, key, id) => { calls.push('cancel'); check(); expect([jwt, key, id]).toEqual(['verified-token', requestId, actor]); if (status !== 'applied') status = 'cancelled'; return receipt(); },
    cleanup: async (id, key) => { calls.push('cleanup'); check(); expect([id, key]).toEqual([actor, requestId]); if (status !== 'cancelled') throw Error('Cannot delete applied bytes'); return { bucket: 'fabrication-private', paths: manifest ? [`${prefix}/drawing.dxf`, ...(manifest.pdf ? [`${prefix}/drawing.pdf`] : [])] : [] }; },
    put: async (path, bytes, mime, hash) => { calls.push('put'); expect(path).toMatch(/\/drawing\.(dxf|pdf)$/); expect(mime).toBe(path.endsWith('dxf') ? 'application/dxf' : 'application/pdf'); expect(hash).toBe(await sha256(bytes)); if (objects.has(path)) return 'exists'; objects.set(path, bytes.slice()); return 'created'; },
    get: async (path, limit) => { calls.push('get'); const bytes = objects.get(path); if (!bytes || bytes.length > limit) throw new FileError('stored_size_mismatch', 502, 'Size mismatch.'); return bytes; },
    remove: async paths => { calls.push('remove'); for (const path of paths) objects.delete(path); },
    download: async (id, rid, kind) => { calls.push('download'); check(); expect([id, rid]).toEqual([actor, revision]); const f = manifest?.[kind]; if (!f || status !== 'applied') throw new FileError('FB403', 403, 'File unavailable.'); return { ...f, bucket: 'fabrication-private', path: `${prefix}/drawing.${kind}`, revision_number: 1, content_type: kind === 'dxf' ? 'application/dxf' : 'application/pdf' }; },
  };
  return { s, calls, objects, receipt, reservation, revoke: () => { available = false; }, setStatus: (next: Receipt['status']) => { status = next; } };
}

test('valid ASCII DXF and PDF bytes upload with server-computed immutable manifests', async () => {
  const f = fixture(); const response = await handle(upload({ pdf: true }), f.s);
  expect(response.status).toBe(200); expect(await response.json()).toEqual(f.receipt()); expect(f.objects.size).toBe(2);
  expect(f.calls).toEqual(['verify', 'reserve', 'authorize', 'put', 'authorize', 'put', 'finalize']);
  expect(f.reservation().reservation!.manifest.dxf.sha256).toBe(await sha256(encode(dxfText)));
});
test('already applied identical retry returns receipt without another storage write', async () => {
  const f = fixture(); await handle(upload(), f.s); expect((await handle(upload(), f.s)).status).toBe(200);
  expect(f.calls.filter(v => v === 'put')).toHaveLength(1); expect(f.calls).not.toContain('remove');
});
test('pending duplicate retry verifies existing bytes and never overwrites', async () => {
  const f = fixture(); const finish = f.s.finalize; f.s.finalize = async () => { throw Error('Lost DB connection'); };
  expect((await handle(upload(), f.s)).status).toBe(502); expect(f.objects.size).toBe(1); expect(f.calls).not.toContain('remove');
  f.s.finalize = finish; expect((await handle(upload(), f.s)).status).toBe(200); expect(f.calls).toContain('get'); expect(f.objects.size).toBe(1);
});
test('same request with different validated bytes is rejected rather than replaced', async () => {
  const f = fixture(); await handle(upload(), f.s); const before = f.objects.get(`${prefix}/drawing.dxf`)!;
  expect((await handle(upload({ dxf: dxfText.replace('25.4', '26.4') }), f.s)).status).toBe(412);
  expect(f.objects.get(`${prefix}/drawing.dxf`)).toEqual(before); expect(f.calls.filter(v => v === 'put')).toHaveLength(1);
});
test('unknown finalize that actually committed returns applied and never cleans up', async () => {
  const f = fixture(); f.s.finalize = async () => { f.setStatus('applied'); throw Error('Response lost'); };
  const response = await handle(upload(), f.s); expect(response.status).toBe(200); expect((await response.json()).status).toBe('applied'); expect(f.objects.size).toBe(1); expect(f.calls).not.toContain('cleanup');
});
test('definitive finalize conflicts terminate each lease instead of exhausting pending quota', async () => {
  for (let attempt = 0; attempt < 6; attempt++) {
    const f = fixture(); f.s.finalize = async () => { throw new FileError('FB409', 409, 'Part changed.'); };
    const response = await handle(upload(), f.s); expect(response.status).toBe(409);
    expect((await response.json()).receipt.status).toBe('cancelled'); expect(f.receipt().status).toBe('cancelled'); expect(f.objects.size).toBe(0);
  }
});
test('post-reservation access loss returns rejected only after actor-bound cancellation is certain', async () => {
  const f = fixture(), put = f.s.put;
  f.s.put = async (...args) => { const result = await put(...args); f.revoke(); return result; };
  f.s.cancel = async () => { f.setStatus('cancelled'); return f.receipt(); };
  const response = await handle(upload({ pdf: true }), f.s); expect(response.status).toBe(403);
  const body = await response.json(); expect(body.receipt.status).toBe('cancelled'); expect(body.cleanup_pending).toBe(true); expect(f.calls).not.toContain('remove');
});
test('failed cancellation after definitive conflict stays uncertain so recovery ID is retained', async () => {
  const f = fixture(); f.s.finalize = async () => { throw new FileError('FB409', 409, 'Part changed.'); };
  f.s.cancel = async () => { throw Error('Connection unavailable'); };
  const response = await handle(upload(), f.s); expect(response.status).toBe(503); expect((await response.json()).code).toBe('upload_outcome_unknown'); expect(f.objects.size).toBe(1); expect(f.calls).not.toContain('remove');
});
test('transport failure keeps partial upload pending; explicit cancel cleans exact reserved paths', async () => {
  const f = fixture(), put = f.s.put; f.s.put = async (...args) => { if (args[0].endsWith('.pdf')) throw Error('Storage unavailable'); return put(...args); };
  expect((await handle(upload({ pdf: true }), f.s)).status).toBe(502); expect(f.objects.size).toBe(1); expect(f.receipt().status).toBe('pending');
  expect((await handle(action({ action: 'cancel', request_id: requestId }), f.s)).status).toBe(200); expect(f.objects.size).toBe(0); expect(f.receipt().status).toBe('cancelled');
  const cancelled = await handle(upload({ pdf: true }), f.s); expect((await cancelled.json()).status).toBe('cancelled'); expect(f.objects.size).toBe(0);
});
test('cancellation racing an in-flight storage write cleans after late write and cannot finalize', async () => {
  const f = fixture(), put = f.s.put; let written!: () => void, resume!: () => void;
  const started = new Promise<void>(r => { written = r; }), gate = new Promise<void>(r => { resume = r; });
  f.s.put = async (...args) => { written(); await gate; return put(...args); };
  const uploading = handle(upload(), f.s); await started;
  expect((await (await handle(action({ action: 'cancel', request_id: requestId }), f.s)).json()).status).toBe('cancelled');
  resume(); expect((await (await uploading).json()).status).toBe('cancelled'); expect(f.objects.size).toBe(0); expect(f.receipt().status).toBe('cancelled');
});
test('cancellation after finalize returns applied and never deletes committed files', async () => {
  const f = fixture(); await handle(upload(), f.s); const response = await handle(action({ action: 'cancel', request_id: requestId }), f.s);
  expect((await response.json()).status).toBe('applied'); expect(f.objects.size).toBe(1); expect(f.calls).not.toContain('remove');
});
test('pre-reservation cancellation tombstone prevents future upload', async () => {
  const f = fixture(); await handle(action({ action: 'cancel', request_id: requestId }), f.s);
  expect((await (await handle(upload(), f.s)).json()).status).toBe('cancelled'); expect(f.calls).not.toContain('put');
});
test('corrupt existing bytes cancel and clean without replacing or finalizing', async () => {
  const f = fixture(); f.objects.set(`${prefix}/drawing.dxf`, encode(dxfText.replace('25.4', '99.9')));
  expect((await (await handle(upload(), f.s)).json()).status).toBe('cancelled'); expect(f.calls).not.toContain('finalize'); expect(f.objects.size).toBe(0);
});
test('cleanup failure reports pending cleanup, without reporting files removed', async () => {
  const f = fixture(); f.s.finalize = async () => { throw Error(); }; await handle(upload(), f.s);
  f.s.remove = async () => { throw new FileError('cleanup_pending', 503, 'Cleanup pending.'); };
  const response = await handle(action({ action: 'cancel', request_id: requestId }), f.s); expect(response.status).toBe(503); expect((await response.json()).code).toBe('cleanup_pending'); expect(f.objects.size).toBe(1);
});
test('verified auth and expected actor are required before reservations', async () => {
  const f = fixture(); expect((await handle(upload({ expected_actor: part }), f.s)).status).toBe(403); expect(f.calls).not.toContain('reserve');
  f.s.verify = async () => { throw Error('forged JWT metadata'); }; expect((await handle(upload(), f.s)).status).toBe(401); expect(f.calls).not.toContain('put');
  expect((await handle(action({ action: 'cancel', request_id: requestId }, { Authorization: '' }), f.s)).status).toBe(401);
});
test('revoked project authority between files prevents the next privileged write', async () => {
  const f = fixture(), put = f.s.put; f.s.put = async (...args) => { const result = await put(...args); f.revoke(); return result; };
  expect((await handle(upload({ pdf: true }), f.s)).status).toBe(503); expect(f.calls.filter(v => v === 'put')).toHaveLength(1); expect(f.calls).not.toContain('finalize');
});
test('download proxies exact authenticated immutable bytes with no-store attachment headers', async () => {
  const f = fixture(); await handle(upload(), f.s); f.calls.length = 0;
  const response = await handle(action({ action: 'download', revision_id: revision, file_kind: 'dxf' }), f.s);
  expect(response.status).toBe(200); expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="Bracket-r1.dxf"');
  expect(response.headers.get('Content-Type')).toBe('application/octet-stream'); expect(response.headers.get('Cache-Control')).toContain('no-store');
  expect(response.headers.get('X-Fabrication-Revision')).toBe(revision); expect(response.headers.get('X-Fabrication-SHA256')).toBe(await sha256(encode(dxfText))); expect(await response.text()).toBe(dxfText);
  expect(f.calls).toEqual(['verify', 'download', 'get', 'download']);
});
test('download rechecks authority immediately before releasing bytes', async () => {
  const f = fixture(); await handle(upload(), f.s); const get = f.s.get; f.s.get = async (...args) => { const bytes = await get(...args); f.revoke(); return bytes; };
  const response = await handle(action({ action: 'download', revision_id: revision, file_kind: 'dxf' }), f.s); expect(response.status).toBe(403); expect(await response.text()).not.toContain('SECTION');
});
test('download rejects corrupt storage, arbitrary path, wrong revision and missing PDF', async () => {
  const f = fixture(); await handle(upload(), f.s);
  expect((await handle(action({ action: 'download', revision_id: revision, file_kind: 'pdf' }), f.s)).status).toBe(403);
  expect((await handle(action({ action: 'download', revision_id: revision, file_kind: 'dxf', path: 'private/secrets' }), f.s)).status).toBe(400);
  f.objects.set(`${prefix}/drawing.dxf`, encode(dxfText.replace('25.4', '33.3')));
  expect((await handle(action({ action: 'download', revision_id: revision, file_kind: 'dxf' }), f.s)).status).toBe(502);
  const download = f.s.download; f.s.download = async (...args) => ({ ...await download(...args), path: `${board}/${part}/${part}/drawing.dxf` });
  expect((await handle(action({ action: 'download', revision_id: revision, file_kind: 'dxf' }), f.s)).status).toBe(502);
});
test('origin, verb, media type, duplicate fields, raw path and body limits fail closed', async () => {
  const f = fixture(); expect((await handle(action({ action: 'cancel', request_id: requestId }, { Origin: 'https://evil.example' }), f.s)).status).toBe(403);
  expect((await handle(new Request('https://edge.test'), f.s)).status).toBe(405);
  expect((await handle(action({}, { 'Content-Type': 'text/plain' }), f.s)).status).toBe(415);
  expect((await handle(upload({ extra: ['action', 'upload'] }), f.s)).status).toBe(400);
  expect((await handle(upload({ extra: ['path', 'other/file.dxf'] }), f.s)).status).toBe(400);
  expect((await handle(action({}, { 'Content-Length': String(BODY_MAX_BYTES + 1) }), f.s)).status).toBe(413);
  const r = upload(); r.headers.set('Content-Length', String(BODY_MAX_BYTES + 1)); expect((await handle(r, f.s)).status).toBe(413); expect(f.calls).not.toContain('reserve');
});
test('actual chunked upload body length is enforced even without Content-Length', async () => {
  const f = fixture(); const request = new Request('https://edge.test', { method: 'POST', headers: { Authorization: 'Bearer verified-token', 'Content-Type': 'multipart/form-data; boundary=a' }, body: new Uint8Array(BODY_MAX_BYTES + 1) });
  expect(request.headers.has('content-length')).toBe(false); expect((await handle(request, f.s)).status).toBe(413); expect(f.calls).not.toContain('reserve');
});
test('malformed file content is rejected before reservation even with matching extension', async () => {
  for (const value of ['<script>alert(1)</script>', '%PDF-1.4\n%%EOF', dxfText.replace('0\nEOF\n', ''), dxfText.replace('25.4', 'NaN'), `${dxfText}0\nLINE\n`, dxfText.replace('25.4', '\x00')]) {
    const f = fixture(); expect((await handle(upload({ dxf: value }), f.s)).status).toBe(422); expect(f.calls).not.toContain('reserve');
  }
});
test('filenames, MIME mismatch and explicit units are independently enforced', async () => {
  for (const name of ['../part.dxf', 'part.dxf.exe', 'part.exe.dxf', 'part\n.dxf', 'CON.dxf', '日本.dxf']) expect(() => validateFilename(name, 'dxf')).toThrow();
  expect(() => validateFilename('Plate (left)_v2.DXF', 'dxf')).not.toThrow();
  const f = fixture(); expect((await handle(upload({ mime: 'text/html' }), f.s)).status).toBe(422);
  for (const change of [{ drawing_unit: '' }, { thickness_unit: '' }, { onshape_url: 'https://cad.onshape.com.evil.test/documents/abc' }, { needed_date: '2026-02-31' }, { sha256: 'client forged hash' }]) {
    expect((await handle(upload({ p: { ...metadata, ...change } }), f.s)).status).toBe(422);
  }
  expect(f.calls).not.toContain('reserve');
});
test('DXF accepts classic and lightweight polyline, CRLF, and scientific notation', () => {
  expect(() => validateDxf(encode(dxfText.replaceAll('\n', '\r\n').replace('25.4', '2.54e1')))).not.toThrow();
  for (const entity of ['0\nLWPOLYLINE\n90\n2\n10\n0\n20\n0\n10\n10\n20\n10\n', '0\nPOLYLINE\n0\nVERTEX\n10\n0\n20\n0\n0\nVERTEX\n10\n10\n20\n10\n0\nSEQEND\n']) expect(() => validateDxf(encode(`0\nSECTION\n2\nENTITIES\n${entity}0\nENDSEC\n0\nEOF\n`))).not.toThrow();
});
test('DXF rejects missing coordinate records, unsupported binary/3D types, invalid section and vertex structure', () => {
  for (const value of [dxfText.replace('11\n25.4\n', ''), dxfText.replace('LINE', '3DSOLID'), dxfText.replace('ENDSEC', 'SECTION'), dxfText.replace('LINE', 'VERTEX'), 'AutoCAD Binary DXF\r\n\x1a\x00']) expect(() => validateDxf(encode(value))).toThrow();
});
test('PDF validates real byte offsets, catalog and static subset rather than magic alone', async () => {
  expect(() => validatePdf(pdfBytes())).not.toThrow();
  for (const extra of ['/OpenAction 4 0 R', '/J#61vaScript (alert)', '/Encrypt 4 0 R', '/ObjStm 4 0 R']) expect(() => validatePdf(pdfBytes(extra))).toThrow();
  for (const bytes of [encode('%PDF-1.4\nstartxref\n9\n%%EOF\n'), pdfBytes().slice(0, -10), encode(new TextDecoder().decode(pdfBytes()).replace('0000000009', '0000000008')), encode(new TextDecoder().decode(pdfBytes()).replace('/Catalog', '/Unknown'))]) expect(() => validatePdf(bytes)).toThrow();
  expect(await sha256(pdfBytes())).toMatch(/^[a-f0-9]{64}$/);
  await expect(validateFile(new File([''], 'empty.pdf'), 'pdf')).rejects.toBeInstanceOf(FileError);
});
test('PDF rejects missing page-tree nodes and inconsistent counts despite genuine xref offsets', () => {
  for (const [before, after] of [['/Pages 2 0 R', '/Pages 9 0 R'], ['/Kids [3 0 R]', '/Kids [2 0 R]'], ['/Count 1', '/Count 9']]) {
    // Same-length replacement retains valid offsets, isolating page-tree checks.
    expect(() => validatePdf(encode(new TextDecoder().decode(pdfBytes()).replace(before, after)))).toThrow();
  }
});
test('adapter has only scoped backend operations, verified getUser, private storage and upsert false', () => {
  const adapter = readFileSync('supabase/functions/fabrication-files/index.ts', 'utf8');
  expect(adapter).toContain('auth.auth.getUser(jwt)'); expect(adapter).not.toMatch(/getSession\(|getPublicUrl\(|createSignedUrl\(|createSignedUploadUrl\(/);
  expect(adapter).toContain('upsert: false'); expect(adapter).toContain('metadata: { sha256: digest }');
  expect(adapter).toContain("rpc('fabrication_cancelled_upload_paths'"); expect(adapter).toContain("'npm:@supabase/supabase-js@2.116.0'");
  expect(readFileSync('src/fabrication/service.ts', 'utf8')).not.toMatch(/SERVICE_ROLE_KEY|storage\.from|upsert:/);
});


test('immutable retries recognize current and legacy Storage SDK conflict shapes', async () => {
  for (const entry of [
    { status: 409, body: { code: 'ResourceAlreadyExists', message: 'The resource already exists' } },
    { status: 400, body: { statusCode: '400', error: 'Duplicate', message: 'The resource already exists' } },
    { status: 400, body: { code: 'Duplicate', message: 'Duplicate object' } },
  ]) {
    const client = createClient('https://fabrication-storage.invalid', 'synthetic-public-key', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: async () => new Response(JSON.stringify(entry.body), { status: entry.status, headers: { 'content-type': 'application/json' } }) },
    });
    const result = await client.storage.from('fabrication-private').upload('synthetic/drawing.dxf', new Uint8Array([1]), { upsert: false });
    expect(immutableObjectConflict(result.error)).toBe(true);
  }
  for (const error of [null, {}, { status: 400, code: 'InvalidMimeType', message: 'MIME rejected' }, { status: 403, code: 'AccessDenied' }, { status: 500, message: 'The resource already exists' }]) expect(immutableObjectConflict(error)).toBe(false);
});
