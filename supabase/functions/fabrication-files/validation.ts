/** Admission checks only. These checks do not certify machining, geometry, units, or malware safety. */
export const DXF_MAX_BYTES = 20 * 1024 * 1024;
export const PDF_MAX_BYTES = 10 * 1024 * 1024;
export const BODY_MAX_BYTES = DXF_MAX_BYTES + PDF_MAX_BYTES + 64 * 1024;
export type FileKind = 'dxf' | 'pdf';
export type FileManifest = { name: string; size: number; sha256: string };
export type Manifest = { dxf: FileManifest; pdf: FileManifest | null };
export class FileError extends Error {
  constructor(public code: string, public status: number, message: string) { super(message); }
}
export function invalid(message: string): never { throw new FileError('invalid_file', 422, message); }
export function validUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
}
export function validateFilename(name: string, kind: FileKind) {
  // Reject rather than silently normalize ambiguous names or path separators.
  if (name.length < 5 || name.length > 120 || !/^[A-Za-z0-9][A-Za-z0-9 _().-]*$/.test(name)
      || name.includes('..') || name.endsWith(' ') || !name.toLowerCase().endsWith(`.${kind}`)
      || /\.(exe|com|bat|cmd|js|html|htm|svg|zip|scr|dll|sh)\./i.test(name)
      || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
    invalid(`Use a simple ${kind.toUpperCase()} filename (letters, numbers, spaces, _, -, parentheses; at most 120 characters).`);
  }
}
export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
}
const inRange = (n: number, lo: number, hi: number) => n >= lo && n <= hi;
function numericCode(code: number): 'float' | 'int' | null {
  if (inRange(code, 10, 59) || inRange(code, 110, 149) || inRange(code, 210, 239)
      || inRange(code, 460, 469) || inRange(code, 1010, 1059)) return 'float';
  if (inRange(code, 60, 99) || inRange(code, 160, 179) || inRange(code, 270, 299)
      || inRange(code, 370, 389) || inRange(code, 400, 409) || inRange(code, 420, 429)
      || inRange(code, 440, 459) || inRange(code, 1060, 1071)) return 'int';
  return null;
}
/** Streaming line cursor avoids allocating hundreds of thousands of record objects. */
export function validateDxf(bytes: Uint8Array) {
  if (bytes.length < 30 || bytes.length > DXF_MAX_BYTES) invalid('DXF must be nonempty and no larger than 20 MiB.');
  for (const b of bytes) if (b !== 9 && b !== 10 && b !== 13 && (b < 32 || b > 126)) {
    invalid('Export an ASCII DXF. Binary DXF, NUL bytes, and non-ASCII text are not supported.');
  }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  let cursor = 0, records = 0, section = '', needsName = false, eof = false, entities = 0;
  let entity = '', codes = new Set<number>(), coordinatePairs = 0, declaredVertices: number | null = null;
  let polylineOpen = false, polylineVertices = 0;
  const sections = new Set<string>();
  const supported = new Set(['LINE', 'ARC', 'CIRCLE', 'ELLIPSE', 'LWPOLYLINE', 'POLYLINE', 'VERTEX', 'SEQEND', 'SPLINE', 'POINT']);
  function line(): string | null {
    if (cursor >= text.length) return null;
    const start = cursor;
    while (cursor < text.length && text[cursor] !== '\r' && text[cursor] !== '\n') cursor++;
    if (cursor - start > 4096) invalid('DXF contains an overlong record.');
    const value = text.slice(start, cursor);
    if (text[cursor] === '\r') cursor++;
    if (text[cursor] === '\n') cursor++;
    return value;
  }
  function finishEntity() {
    if (!entity) return;
    const required: Record<string, number[]> = {
      LINE: [10, 20, 11, 21], ARC: [10, 20, 40, 50, 51], CIRCLE: [10, 20, 40],
      ELLIPSE: [10, 20, 11, 21, 40], POINT: [10, 20], VERTEX: [10, 20],
      LWPOLYLINE: [10, 20, 90], SPLINE: [70, 71, 72, 73, 40, 10, 20],
    };
    if ((required[entity] || []).some(code => !codes.has(code))) invalid(`DXF ${entity} is missing required coordinate records.`);
    if (entity === 'LWPOLYLINE' && (declaredVertices !== coordinatePairs || coordinatePairs < 2)) invalid('DXF polyline vertex count is inconsistent.');
    entity = ''; codes = new Set(); coordinatePairs = 0; declaredVertices = null;
  }
  while (cursor < text.length) {
    const rawCode = line();
    if (rawCode === null) break;
    if (!rawCode.trim() && !text.slice(cursor).trim()) break;
    const rawValue = line();
    if (eof || rawValue === null || !/^\s*\d{1,4}\s*$/.test(rawCode)) invalid('DXF must contain complete group-code/value pairs ending in EOF.');
    const code = Number(rawCode), value = rawValue.trim();
    if (code > 1071 || ++records > 500_000) invalid('DXF record limit exceeded or invalid group code.');
    const numeric = numericCode(code);
    if (numeric && (!(numeric === 'int' ? /^[+-]?\d+$/.test(value) : /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) || !Number.isFinite(Number(value)))) {
      invalid('DXF contains invalid numeric values.');
    }
    if (needsName) {
      if (code !== 2 || !['HEADER', 'CLASSES', 'TABLES', 'BLOCKS', 'ENTITIES', 'OBJECTS', 'THUMBNAILIMAGE'].includes(value) || sections.has(value)) invalid('DXF section structure is invalid.');
      section = value; sections.add(value); needsName = false; continue;
    }
    if (code === 0 && value === 'SECTION') {
      if (section) invalid('DXF sections cannot be nested.');
      needsName = true; continue;
    }
    if (code === 0 && value === 'ENDSEC') {
      if (!section) invalid('DXF has an unmatched section ending.');
      if (polylineOpen) invalid('DXF POLYLINE must end with SEQEND.');
      finishEntity(); section = ''; continue;
    }
    if (code === 0 && value === 'EOF') {
      if (section || needsName || !sections.has('ENTITIES') || entities === 0) invalid('DXF needs a complete, nonempty ENTITIES section.');
      eof = true; continue;
    }
    if (!section && code !== 999) invalid('DXF record is outside a section.');
    if (section === 'ENTITIES') {
      if (code === 0) {
        finishEntity();
        if (!supported.has(value)) invalid(`DXF entity ${value.slice(0, 30)} is unsupported. Export flattened 2D curves for VCarve.`);
        if (value === 'VERTEX') { if (!polylineOpen) invalid('DXF VERTEX has no POLYLINE.'); polylineVertices++; }
        else if (value === 'SEQEND') { if (!polylineOpen || polylineVertices < 2) invalid('DXF POLYLINE needs at least two vertices.'); polylineOpen = false; }
        else { if (polylineOpen) invalid('DXF POLYLINE must end with SEQEND.'); if (value === 'POLYLINE') { polylineOpen = true; polylineVertices = 0; } }
        entity = value; if (!['SEQEND', 'VERTEX'].includes(value)) entities++;
      } else if (!entity && code !== 999) invalid('DXF entity data has no entity type.');
      else { codes.add(code); if (code === 10) coordinatePairs++; if (code === 90) declaredVertices = Number(value); }
    }
  }
  if (!eof || needsName || section) invalid('DXF is incomplete or missing its EOF record.');
}

/** Conservative classic-xref PDF subset. No decompression or execution of document content. */
export function validatePdf(bytes: Uint8Array) {
  if (bytes.length < 100 || bytes.length > PDF_MAX_BYTES) invalid('PDF must be nonempty and no larger than 10 MiB.');
  // latin1 keeps offsets one byte per JS character (including arbitrary image/stream bytes).
  const text = new TextDecoder('latin1').decode(bytes);
  if (!/^%PDF-(?:1\.[0-7]|2\.0)[\r\n]/.test(text)) invalid('PDF header is missing or unsupported.');
  const tail = /startxref\s+(\d+)\s+%%EOF[\r\n\t ]*$/.exec(text.slice(-1024));
  if (!tail) invalid('PDF is incomplete: a valid startxref and EOF trailer are required.');
  const offset = Number(tail[1]);
  if (!Number.isSafeInteger(offset) || offset < 8 || offset >= bytes.length || !/^xref(?:\r\n|\r|\n| )/.test(text.slice(offset, offset + 8))) {
    invalid('Use a PDF with a classic cross-reference table. Re-export without compressed object tables.');
  }
  const xref = text.slice(offset);
  const trailerAt = xref.indexOf('trailer');
  if (trailerAt < 0 || trailerAt > 2_000_000) invalid('PDF cross-reference trailer is missing.');
  const trailer = xref.slice(trailerAt);
  const root = /\/Root\s+(\d+)\s+(\d+)\s+R\b/.exec(trailer);
  const size = /\/Size\s+(\d+)\b/.exec(trailer);
  if (!root || !size || Number(size[1]) < 2 || Number(size[1]) > 100_000) invalid('PDF has no valid document root or object count.');
  // Reject incremental/stream object tables, encrypted files, and known active-content names.
  // This is deliberately conservative and is not a malware scanner or PDF sanitizer.
  const names = text.replace(/#([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
  if (/\/(?:Encrypt|Prev|XRefStm|ObjStm|JavaScript|JS|Launch|EmbeddedFile|OpenAction|AA|RichMedia|XFA)\b/.test(names)) invalid('Upload a fresh, unencrypted, static PDF without active content or compressed object tables.');
  const lines = xref.slice(0, trailerAt).split(/\r\n|\r|\n/);
  let i = 1, entries = 0, hasRoot = false, pagesReference = '';
  const objects = new Map<string, number>();
  while (i < lines.length) {
    if (!lines[i].trim()) { i++; continue; }
    const sub = /^(\d+)\s+(\d+)\s*$/.exec(lines[i++]);
    if (!sub) invalid('PDF cross-reference table is malformed.');
    const first = Number(sub[1]), count = Number(sub[2]);
    if (count < 1 || (entries += count) > 100_000 || first + count > Number(size[1])) invalid('PDF cross-reference bounds are invalid.');
    for (let n = 0; n < count; n++) {
      const entry = /^(\d{10})\s(\d{5})\s([nf])\s*$/.exec(lines[i++] || '');
      if (!entry) invalid('PDF cross-reference entry is malformed.');
      if (entry[3] === 'n') {
        const at = Number(entry[1]), generation = Number(entry[2]);
        if (at < 8 || at >= offset || !new RegExp(`^${first + n}\\s+${generation}\\s+obj\\b`).test(text.slice(at, at + 60))) invalid('PDF object offset does not match its cross-reference entry.');
        const reference = `${first + n}:${generation}`;
        if (objects.has(reference)) invalid('PDF has duplicate cross-reference objects.');
        objects.set(reference, at);
        if (first + n === Number(root[1]) && generation === Number(root[2])) {
          const end = text.indexOf('endobj', at);
          if (end < 0 || end - at > 65536 || !/\/Type\s*\/Catalog\b/.test(text.slice(at, end)) || !/\/Pages\s+\d+\s+\d+\s+R\b/.test(text.slice(at, end))) invalid('PDF document catalog is invalid.');
          const pages = /\/Pages\s+(\d+)\s+(\d+)\s+R\b/.exec(text.slice(at, end))!;
          pagesReference = `${Number(pages[1])}:${Number(pages[2])}`;
          hasRoot = true;
        }
      }
    }
  }
  if (!hasRoot) invalid('PDF needs a document catalog.');
  const visited = new Set<string>();
  function countPages(reference: string, depth: number): number {
    if (depth > 16 || visited.has(reference) || visited.size >= 10000) invalid('PDF page tree exceeds limits or contains cycles.');
    visited.add(reference);
    const at = objects.get(reference);
    if (at === undefined) invalid('PDF page tree references a missing object.');
    const end = text.indexOf('endobj', at);
    if (end < at || end - at > 65536) invalid('PDF page object is malformed or too large.');
    const object = text.slice(at, end);
    if (/\/Type\s*\/Page\b/.test(object)) return 1;
    if (!/\/Type\s*\/Pages\b/.test(object)) invalid('PDF page tree contains an invalid node.');
    const kids = /\/Kids\s*\[([^\]]*)\]/.exec(object), count = /\/Count\s+(\d+)\b/.exec(object);
    if (!kids || !count || Number(count[1]) < 1 || Number(count[1]) > 10000) invalid('PDF page tree count is invalid.');
    const references = Array.from(kids[1].matchAll(/(\d+)\s+(\d+)\s+R\b/g));
    if (!references.length || kids[1].replace(/\d+\s+\d+\s+R\b/g, '').trim()) invalid('PDF page references are malformed.');
    const actual = references.reduce((total, ref) => total + countPages(`${Number(ref[1])}:${Number(ref[2])}`, depth + 1), 0);
    if (actual !== Number(count[1])) invalid('PDF page count does not match its page tree.');
    return actual;
  }
  if (countPages(pagesReference, 0) < 1) invalid('PDF needs at least one page.');
}
export async function validateFile(file: File, kind: FileKind): Promise<{ bytes: Uint8Array; manifest: FileManifest; contentType: string }> {
  validateFilename(file.name, kind);
  const max = kind === 'dxf' ? DXF_MAX_BYTES : PDF_MAX_BYTES;
  if (file.size === 0 || file.size > max) throw new FileError('file_size', 413, `${kind.toUpperCase()} exceeds its size limit or is empty.`);
  const mime = file.type.toLowerCase().split(';')[0];
  const mimes = kind === 'dxf' ? ['', 'application/octet-stream', 'application/dxf', 'application/x-dxf', 'image/vnd.dxf', 'image/x-dxf', 'text/plain'] : ['', 'application/octet-stream', 'application/pdf'];
  if (!mimes.includes(mime)) invalid(`${kind.toUpperCase()} filename and MIME type disagree.`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length !== file.size) invalid('File size changed while reading.');
  if (kind === 'dxf') validateDxf(bytes); else validatePdf(bytes);
  return { bytes, manifest: { name: file.name, size: bytes.length, sha256: await sha256(bytes) }, contentType: kind === 'dxf' ? 'application/dxf' : 'application/pdf' };
}
