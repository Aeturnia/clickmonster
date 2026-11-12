// Deploys the `game` edge function through the Supabase Management API.
//   SUPABASE_ACCESS_TOKEN=sbp_... node tools/deploy-functions.mjs
// (Equivalent to `supabase functions deploy game`.) Uploads index.ts plus the shared
// engine and data from public/js so the server runs exactly the browser's rules.
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'janiqspmhkbsyemkknpv';
const token = process.env.SUPABASE_ACCESS_TOKEN || 'proxy-injected';

const files = [['index.ts', join(root, 'supabase/functions/game/index.ts')]];
for (const dir of ['engine', 'data']) {
  for (const f of readdirSync(join(root, 'public/js', dir))) {
    if (f.endsWith('.js')) files.push([`js/${dir}/${f}`, join(root, 'public/js', dir, f)]);
  }
}

const form = new FormData();
form.append('metadata', JSON.stringify({ entrypoint_path: 'index.ts', name: 'game', verify_jwt: false }));
for (const [name, path] of files) {
  form.append('file', new Blob([readFileSync(path)], { type: 'application/typescript' }), name);
}

const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/functions/deploy?slug=game`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}` },
  body: form,
});
const text = await res.text();
console.log(res.status, text.slice(0, 500));
if (!res.ok) process.exit(1);
