// Prints SQL that seeds the `zones` table from the built-in zones (existing rows are kept).
//   node tools/seed-zones.mjs > seed.sql
import { DEFAULT_ZONES } from '../public/js/data/zones.js';

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const rows = DEFAULT_ZONES.map((z, i) => `(${q(z.id)}, ${q(JSON.stringify(z))}::jsonb, ${i}, 'seed')`);
console.log(`insert into public.zones (id, data, sort, updated_by) values\n${rows.join(',\n')}\non conflict (id) do nothing;`);
