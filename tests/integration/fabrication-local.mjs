#!/usr/bin/env node
// Owns one disposable local stack. Never links, resets, deploys, or calls Management API.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { dirname, resolve, join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { CLI_VERSION, API_PORT, DB_PORT, ORIGIN, localStatus, localFetch, isolatedEnvironment, edgeObservation, edgeHandlerReady, assertLocalPreflight } from './fabrication-safety.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const mode = process.argv[2] || '--run';
assert(['--run', '--preflight', '--prepare-only'].includes(mode), 'Use --run, --preflight, or --prepare-only');
const executable = process.env.FABRICATION_SUPABASE_CLI || 'supabase';
assert(executable === 'supabase' || isAbsolute(executable), 'CLI override must be an absolute local binary path');
const root = mkdtempSync(join(tmpdir(), 'fabrication-integration-'));
const project = `fabrication-it-${randomUUID().slice(0, 12)}`;
const network = `${project}-loopback`;
const env = isolatedEnvironment(root);
mkdirSync(env.HOME, { recursive: true });
const common = { cwd: root, env, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024 };
const cli = (args, timeout = 60_000) => execFileSync(executable, [...args, '--workdir', root, '--network-id', network], { ...common, timeout }).trim();
const docker = args => execFileSync('docker', args, { ...common, timeout: 45_000 }).trim();
const pgArgs = ['exec', '-i', `supabase_db_${project}`, 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-Atq', '-v', 'ON_ERROR_STOP=1'];
const sql = input => execFileSync('docker', pgArgs, { ...common, input, timeout: 45_000 }).trim();
let started = false, networkCreated = false, edge, report, cleanupPromise;
const children = new Set();
const secrets = [];
const clean = text => secrets.reduce((out, secret) => out.replaceAll(secret, '[local-key]'), String(text))
  .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[local-jwt]')
  .replace(/sb_(?:secret|publishable)_[A-Za-z0-9_-]+/g, '[local-key]');
let edgeOutput = '', edgeOutputHead = '';
function captureEdge(chunk) { const text = String(chunk); if (edgeOutputHead.length < 8000) edgeOutputHead += text.slice(0, 8000 - edgeOutputHead.length); edgeOutput = (edgeOutput + text).slice(-16000); }
// Explicit gate release, not a timing-dependent sleep. Separate psql connection
// holds the lock while real HTTP requests queue inside the deployed RPCs.
async function gate(lock = '4418') {
  assert(['4418', '9918,99'].includes(lock));
  const child = spawn('docker', pgArgs, common);
  children.add(child); child.once('close', () => children.delete(child));
  let out = '', err = '', readyResolve, readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const done = new Promise((resolve, reject) => {
    child.stdout.on('data', b => { out += b; if (out.includes('FABRICATION_GATE_READY')) readyResolve(); });
    child.stderr.on('data', b => { err += b; });
    child.on('error', error => { readyReject(error); reject(error); });
    child.on('close', code => { if (code) { const error = Error(clean(err)); readyReject(error); reject(error); } else resolve(); });
  });
  // Attach handlers immediately so a failed readiness check cannot leak rejections.
  done.catch(() => {});
  child.stdin.write(`begin;set statement_timeout='40s';set idle_in_transaction_session_timeout='40s';select pg_advisory_xact_lock(${lock});select 'FABRICATION_GATE_READY';\n`);
  const timeout = setTimeout(() => readyReject(Error('SQL gate did not become ready')), 15_000);
  try { await ready; } catch (error) { child.kill('SIGTERM'); throw error; } finally { clearTimeout(timeout); }
  let released = false;
  return async () => { if (!released) { released = true; child.stdin.end('commit;\n\\q\n'); } await done; };
}
async function waitFor(predicate, label, timeout = 15_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await predicate()) return; await new Promise(r => setTimeout(r, 100)); }
  throw Error(`Timed out waiting for ${label}`);
}

function cleanup() {
  if (cleanupPromise) return cleanupPromise;
  cleanupPromise = (async () => {
    let failed = false;
    await Promise.all([...children].map(child => new Promise(resolve => {
      if (child.exitCode !== null) { resolve(); return; }
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 3000);
      child.once('close', () => { clearTimeout(timer); resolve(); });
      child.kill('SIGTERM');
    })));
    if (started) {
      try { cli(['stop', '--project-id', project, '--no-backup'], 120_000); }
      catch (error) { console.error(`Disposable stack cleanup failed: ${clean(error.message)}`); failed = true; }
    }
    if (networkCreated && !failed) {
      try { docker(['network', 'rm', network]); }
      catch (error) { console.error(`Disposable network cleanup failed: ${clean(error.message)}`); failed = true; }
    }
    if (failed) {
      process.exitCode = 1;
      console.error(`Retained synthetic workspace: ${root}\nCleanup only this run: supabase stop --workdir ${root} --project-id ${project} --no-backup\nThen: docker network rm ${network}`);
    } else rmSync(root, { recursive: true, force: true });
  })();
  return cleanupPromise;
}
for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) process.once(signal, async () => { await cleanup(); process.exit(code); });

const sourcePaths = [
  'supabase/migrations/202610020001_planning_v1.sql',
  'supabase/migrations/202610030001_planning_task_dependencies.sql',
  'supabase/migrations/202610040001_planning_task_assignees.sql',
  'supabase/migrations/20261006073717_sprint_review_v1.sql',
  'supabase/migrations/20261006201639_fabrication_v1.sql',
  'supabase/migrations/20261006213850_assembly_testing_v1.sql',
  ...['index.ts', 'handler.ts', 'validation.ts'].map(f => `supabase/functions/fabrication-files/${f}`),
  'src/planning/assembly/model.ts',
  ...['fabrication-local.mjs', 'fabrication-safety.mjs', 'fabrication-stack.spec.mjs', 'assembly-stack.spec.mjs'].map(f => `tests/integration/${f}`),
];
const hashes = Object.fromEntries(sourcePaths.map(path => [path, createHash('sha256').update(readFileSync(join(repo, path))).digest('hex')]));
try {
  const version = execFileSync(executable, ['--version'], common).trim();
  assert.equal(version, CLI_VERSION, `Install the pinned official Supabase CLI ${CLI_VERSION}`);
  for (const args of [['init'], ['start'], ['status'], ['stop'], ['functions', 'serve']]) cli([...args, '--help']);
  if (mode !== '--prepare-only') {
    try { docker(['info', '--format', '{{.ServerVersion}}']); }
    catch { throw Error('BLOCKED: a working local Docker daemon at /var/run/docker.sock is required. No integration tests ran.'); }
  }
  if (mode === '--preflight') console.log(`PASS preflight: Node ${process.version}, Supabase CLI ${version}, local Docker`);
  else {
    cli(['init']);
    // Fresh config contains only synthetic settings; never copy repository .env,
    // .temp, links, secrets, or service configuration from a user's Supabase home.
    writeFileSync(join(root, 'supabase/config.toml'), `project_id = "${project}"
[api]
enabled = true
port = ${API_PORT}
schemas = ["public"]
extra_search_path = ["public", "extensions"]
[db]
port = ${DB_PORT}
shadow_port = 54330
major_version = 17
[db.seed]
enabled = false
[studio]
enabled = false
[realtime]
enabled = false
[local_smtp]
enabled = false
[analytics]
enabled = false
[storage]
enabled = true
file_size_limit = "32MiB"
[auth]
enabled = true
site_url = "${ORIGIN}"
additional_redirect_urls = []
enable_signup = true
enable_anonymous_sign_ins = false
[auth.email]
enable_signup = true
enable_confirmations = false
[edge_runtime]
enabled = true
policy = "per_worker"
inspector_port = 54338
[functions.fabrication-files]
verify_jwt = false
`);
    const functionDir = join(root, 'supabase/functions/fabrication-files');
    mkdirSync(functionDir, { recursive: true });
    for (const name of ['index.ts', 'handler.ts', 'validation.ts']) copyFileSync(join(repo, 'supabase/functions/fabrication-files', name), join(functionDir, name));
    // start loads this documented path before the first worker can be warmed.
    const edgeEnv = join(root, 'supabase/functions/.env');
    writeFileSync(edgeEnv, `FABRICATION_ALLOWED_ORIGINS=${ORIGIN}\n`, { mode: 0o600 });
    if (mode === '--prepare-only') {
      // This mode validates preparation only and must never be described as integration success.
      console.log(JSON.stringify({ status: 'PREPARED_ONLY_NOT_EXECUTED', cli: version, source_sha256: hashes }, null, 2));
    } else {
      console.log(`Starting disposable local stack ${project}; cold image pulls can take several minutes.`);
      docker(['network', 'create', '--label', `fabrication.integration=${project}`, '--opt', 'com.docker.network.bridge.host_binding_ipv4=127.0.0.1', network]);
      networkCreated = true;
      started = true; // Also clean up if startup only partially succeeds.
      cli(['start', '--exclude', 'realtime,imgproxy,mailpit,postgres-meta,studio,logflare,vector,supavisor'], 12 * 60_000);
      const containerIDs = docker(['ps', '-q', '--filter', `network=${network}`]).split('\n').filter(Boolean);
      assert(containerIDs.length >= 5, 'Expected real local Supabase service containers');
      for (const container of JSON.parse(docker(['inspect', ...containerIDs]))) {
        for (const bindings of Object.values(container.NetworkSettings.Ports || {})) {
          for (const binding of bindings || []) assert(['127.0.0.1', '::1'].includes(binding.HostIp), `Non-loopback published port rejected for ${container.Name}`);
        }
      }
      const status = localStatus(JSON.parse(cli(['status', '-o', 'json'])));
      secrets.push(status.anonKey, status.serviceKey);
      assert.equal(sql('select count(*) from auth.users'), '0', 'Refusing a nonempty Auth database');
      assert.equal(sql('select count(*) from storage.objects'), '0', 'Refusing nonempty Storage');
      const authFunction = sql("select pg_get_functiondef('auth.uid()'::regprocedure)");
      assert(!authFunction.includes('test.uid'), 'Mock auth.uid is forbidden');
      sql(readFileSync(join(repo, 'tests/integration/fabrication-prerequisites.sql'), 'utf8'));
      for (const path of sourcePaths.filter(p => p.endsWith('.sql'))) sql(readFileSync(join(repo, path), 'utf8'));
      sql("notify pgrst, 'reload schema';");
      edge = spawn(executable, ['functions', 'serve', 'fabrication-files', '--env-file', edgeEnv, '--workdir', root, '--network-id', network], common);
      children.add(edge); edge.once('close', () => children.delete(edge));
      edge.stdout.on('data', captureEdge);
      edge.stderr.on('data', captureEdge);
      edge.on('error', error => { edgeOutput += error.message; });
      const route = '/functions/v1/fabrication-files';
      const probeHeaders = { Origin: ORIGIN, apikey: status.anonKey, 'Content-Type': 'application/json' };
      let lastProbe = null, previousSummary = '', lastLoggedAt = 0, attempts = 0;
      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline) {
        attempts++;
        if (edge.exitCode !== null) throw Error(`Local function server exited ${edge.exitCode}`);
        try {
          lastProbe = await edgeObservation(await localFetch(status.base, route, {
            method: 'POST', headers: probeHeaders, body: '{}', signal: AbortSignal.timeout(8000),
          }));
        } catch (error) { lastProbe = { transport_error: String(error.message).slice(0, 300) }; }
        const summary = JSON.stringify(lastProbe);
        if (summary !== previousSummary || Date.now() - lastLoggedAt >= 15_000) {
          console.log(`Edge readiness attempt ${attempts}: ${clean(summary)}`);
          previousSummary = summary; lastLoggedAt = Date.now();
        }
        if (edgeHandlerReady(lastProbe)) break;
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      assert(edgeHandlerReady(lastProbe), `Real Edge handler did not become ready: ${JSON.stringify(lastProbe)}`);
      const preflight = await edgeObservation(await localFetch(status.base, route, {
        method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,apikey,content-type' },
      }));
      console.log(`Local gateway preflight: ${clean(JSON.stringify(preflight))}`);
      assertLocalPreflight(preflight);
      const deniedOrigin = await edgeObservation(await localFetch(status.base, route, {
        method: 'POST', headers: { ...probeHeaders, Origin: 'http://127.0.0.1:54340' }, body: '{}',
      }));
      assert.equal(deniedOrigin.status, 403, `Unapproved origin was not denied: ${JSON.stringify(deniedOrigin)}`);
      assert.equal(deniedOrigin.code, 'origin_denied', `Expected application origin enforcement: ${JSON.stringify(deniedOrigin)}`);
      console.log('PASS real handler readiness, allowed local preflight, and rejected-origin enforcement');
      const { runFabricationIntegration } = await import('./fabrication-stack.spec.mjs');
      const checks = await runFabricationIntegration({ ...status, sql, gate, waitFor, registerSecret: s => secrets.push(s) });
      assert.equal(sql("select pg_get_functiondef('auth.uid()'::regprocedure)"), authFunction, 'Auth function changed');
      const images = JSON.parse(docker(['inspect', `supabase_db_${project}`]))[0].Config.Image;
      report = { status: 'PASS_REAL_SUPABASE_INTEGRATION', cli: version, node: process.version, postgres_image: images, checks, source_sha256: hashes };
    }
  }
} catch (error) {
  console.error(clean(error.message));
  if (edgeOutput) console.error(`Local Edge startup diagnostics:\n${clean(edgeOutputHead)}\nLocal Edge recent diagnostics:\n${clean(edgeOutput)}`);
  process.exitCode = 1;
} finally {
  await cleanup();
}
if (report && !process.exitCode) console.log(JSON.stringify(report, null, 2));
