// Deploys edge functions (default: game and admin) through the Supabase Management API.
//   SUPABASE_ACCESS_TOKEN=sbp_... node tools/deploy-functions.mjs [game|admin ...]
// (Equivalent to `supabase functions deploy game`.) Uploads index.ts plus the shared
// engine and data from public/js so the server runs exactly the browser's rules.
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const env = process.env;
const proxy = env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy;

// Behind a proxy (the cloud sandbox), fetch only honours it when Node starts with
// NODE_USE_ENV_PROXY=1. Relaunch with it set, so the npm script needs no shell syntax
// and runs the same in cmd, PowerShell and bash.
if (proxy && !env.NODE_USE_ENV_PROXY) {
  const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...env, NODE_USE_ENV_PROXY: '1' },
  });
  process.exit(r.status ?? 1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT_REF = env.SUPABASE_PROJECT_REF || 'janiqspmhkbsyemkknpv';
// The cloud proxy injects the token itself; anywhere else it must be set.
if (!env.SUPABASE_ACCESS_TOKEN && !proxy) {
  console.error('Set SUPABASE_ACCESS_TOKEN to a Supabase personal access token (sbp_...) first.');
  process.exit(1);
}
const token = env.SUPABASE_ACCESS_TOKEN || 'proxy-injected';

const slugs = process.argv.slice(2).length ? process.argv.slice(2) : ['game', 'admin'];
let failed = false;
for (const slug of slugs) {
  const files = [['index.ts', join(root, `supabase/functions/${slug}/index.ts`)]];
  for (const dir of ['engine', 'data']) {
    for (const f of readdirSync(join(root, 'public/js', dir))) {
      if (f.endsWith('.js')) files.push([`js/${dir}/${f}`, join(root, 'public/js', dir, f)]);
    }
  }
  const form = new FormData();
  form.append('metadata', JSON.stringify({ entrypoint_path: 'index.ts', name: slug, verify_jwt: false }));
  for (const [name, path] of files) {
    form.append('file', new Blob([readFileSync(path)], { type: 'application/typescript' }), name);
  }
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/functions/deploy?slug=${slug}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const text = await res.text();
  console.log(slug, res.status, text.slice(0, 160));
  if (!res.ok) failed = true;
}
if (failed) process.exit(1);
