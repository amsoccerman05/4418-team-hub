// Resolve the Edge dependency graph with the pinned official Deno CLI. This
// NEVER executes index.ts, starts a listener, or receives application secrets.
// Usage after setup-deno: node scripts/lock-meals-edge.mjs [--verify]
// Official references:
// https://docs.deno.com/runtime/reference/cli/install/
// https://github.com/denoland/deno/releases/tag/v2.8.0
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const DENO_VERSION = '2.8.0';
assert(process.argv.slice(2).every(value => value === '--verify'), 'Only --verify is supported');
const verify = process.argv.includes('--verify');
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const original = join(repo, 'supabase/functions/team-meals');
const target = join(original, 'deno.lock');
if (verify) assert(existsSync(target), 'Commit the generated meal deno.lock before frozen verification');
const temporary = mkdtempSync(join(tmpdir(), 'meals-deno-lock-'));
try {
    const home = join(temporary, 'home'), cache = join(temporary, 'cache');
    const copied = join(temporary, 'source/supabase/functions/team-meals');
    mkdirSync(home); mkdirSync(cache); mkdirSync(copied, { recursive: true });
    // Preserve relative imports, but copy no root package.json/.npmrc/.env or
    // application credentials. This is a function-only resolution workspace.
    for (const name of readdirSync(original)) if (name.endsWith('.ts') || name === 'deno.json' || name === 'deno.lock')
        copyFileSync(join(original, name), join(copied, name));
    const types = join(temporary, 'source/src/meals'); mkdirSync(types, { recursive: true });
    copyFileSync(join(repo, 'src/meals/types.ts'), join(types, 'types.ts'));
    const environment = { PATH: process.env.PATH ?? '', HOME: home, DENO_DIR: cache, DENO_NO_PROMPT: '1', DENO_NO_UPDATE_CHECK: '1', NO_COLOR: '1' };
    const invoke = (arguments_, capture = false) => {
        const result = spawnSync('deno', arguments_, { cwd: copied, env: environment, encoding: 'utf8', stdio: capture ? 'pipe' : 'inherit', timeout: 180000 });
        assert(!result.error, `Deno CLI unavailable or timed out; install official Deno ${DENO_VERSION}`);
        assert.equal(result.status, 0, 'Deno dependency resolution failed');
        return result.stdout ?? '';
    };
    assert.match(invoke(['--version'], true).split('\n')[0], /^deno 2\.8\.0 \(stable, release, /,
        `Use the pinned official Deno ${DENO_VERSION} CI toolchain`);
    // No --allow-scripts, --env-file, run, eval, or serve. The CLI builds a static
    // graph (including literal import('pg')) and only fetches public packages.
    invoke(['install', '--entrypoint', '--prod', '--no-check', '--config=deno.json', '--lock=deno.lock',
        `--frozen=${verify ? 'true' : 'false'}`, '--node-modules-dir=none', 'index.ts']);
    const generated = join(copied, 'deno.lock');
    const lock = JSON.parse(readFileSync(generated, 'utf8'));
    assert(lock.npm?.['pg@8.23.1']?.integrity, 'Deno must generate genuine pg integrity and its transitive dependency graph');
    if (verify) assert.equal(readFileSync(generated, 'utf8'), readFileSync(target, 'utf8'), 'Frozen resolution changed the committed lockfile');
    else copyFileSync(generated, target);
    console.log(verify ? 'Verified the committed meal Edge dependency lock.' : 'Generated supabase/functions/team-meals/deno.lock using official Deno resolution.');
} finally { rmSync(temporary, { recursive: true, force: true }); }
