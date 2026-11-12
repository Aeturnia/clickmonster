// Deploys edge functions (default: game and admin) through the Supabase Management API.
//   SUPABASE_ACCESS_TOKEN=sbp_... node tools/deploy-functions.mjs [game|admin ...]
// (Equivalent to `supabase functions deploy game`.) Uploads index.ts plus the shared
// engine and data from public/js so the server runs exactly the browser's rules.
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'janiqspmhkbsyemkknpv';
const token = process.env.SUPABASE_ACCESS_TOKEN || 'proxy-injected';

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
