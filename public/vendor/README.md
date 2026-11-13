# Vendored files

Third-party files served from our own site, so that the entrance, sign-in and the game load only
from our domain and Supabase (docs/landing-scope.md, Q2 and Q2a). They are copied unmodified from
the published package and must never be edited.

## supabase-js 2.45.4

| File | SHA-256 |
|---|---|
| `supabase-js@2.45.4/supabase.js` | `8596965fe918e656600a1b568d3a168f5c0d3d22a600886bb6f44a6555db01e7` |
| `supabase-js@2.45.4/591.supabase.js` | `9c305b77dab63dd79eb96efab9069366fb2255bd8731d6b862287558d2560406` |
| `supabase-js@2.45.4/LICENSE` | `334dd6820e2eaeab2064e7c59001b810566728a28a41a7c1dbf69bbee17d0936` |

- **Package:** `@supabase/supabase-js@2.45.4` from the npm registry, tarball integrity `sha512-E5p8/zOLaQ3a462MZnmnz03CrduA5ySH9hZyL03Y+QZLIOO4/Gs8Rdy4ZCKDHsN7x0xdanVEWWFN3pJFQr9/hg==`.
- **Files:**
  - `supabase.js` is the package's own browser build, `dist/umd/supabase.js`. It is a classic script that defines the global `supabase`.
  - `591.supabase.js` is the build's one lazily loaded chunk, `dist/umd/591.supabase.js`. It is a stub that throws "ws does not work in the browser", and is loaded only where there is no native `WebSocket`. It is kept so that even that path never reaches another host. It loads from the same directory as `supabase.js`.
  - `LICENSE` is the package's MIT licence.
- **Loaded by** `public/js/net.js` (`client()`), the only code that creates the Supabase client.
- **Same version elsewhere:** the edge functions use the same version through `npm:@supabase/supabase-js@2.45.4`.
- **Line endings:** `.gitattributes` marks `public/vendor/**` as `-text`, so git never changes these files' bytes.

## Updating

1. Pick the new version and read its release notes, in particular anything about auth storage, `onAuthStateChange` events or Realtime.
2. Download and unpack the package in an empty scratch directory. `npm pack` checks the tarball against the registry's integrity hash.
   ```
   npm pack @supabase/supabase-js@<version> --json    # note the "integrity" value
   tar -xzf supabase-supabase-js-<version>.tgz
   ```
3. Make sure `package/dist/umd/` still has `supabase.js` and the same set of chunks.
   - Search `supabase.js` for `.e(` to list every chunk it can load. Each chunk must be copied too.
   - It must contain no `import(` and no URLs other than documentation links and the unused `localhost` default.
4. Create `public/vendor/supabase-js@<version>/` with `supabase.js`, every chunk, and `LICENSE`. Copy the files unmodified.
5. Update the version in three places:
   - `public/js/net.js` (`LIBRARY`);
   - the edge functions' `npm:` imports (`supabase/functions/*/index.ts`), so server and client agree;
   - this file: the version, the integrity hash, and the SHA-256 of each file (`sha256sum`).
6. Run `npm test` and `npm run test:ui`. The UI harness fails on any request to another host.
7. Delete the old version's directory in the same change. Redeploy the functions (`npm run deploy:functions`).
