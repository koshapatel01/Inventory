// Shared Postgres connection (Neon serverless driver — works over HTTP, so it
// survives Vercel's read-only, ephemeral serverless functions, unlike the
// old node:fs-based store). SERVER-ONLY.
//
// Accepts either DATABASE_URL or POSTGRES_URL since different versions of
// Vercel's Postgres/Neon integration have injected one or the other.
//
// Lazily connects on first actual use rather than at import time: Next.js's
// build step ("Collecting page data") imports every route module — including
// ones that only touch this file transitively — to gather build metadata,
// which is not the same as that route ever running. Throwing here at import
// time (the original version of this file did) made the missing-env-var
// check fire during the BUILD itself and fail it outright, even though the
// env var was correctly set for the actual deployed runtime. Deferring the
// check to first real query means a build never fails for this reason, and
// the same clear error still surfaces immediately the first time a request
// actually needs the database.

import { neon } from '@neondatabase/serverless';

let client = null;

function getClient() {
  if (!client) {
    const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!connectionString) {
      throw new Error(
        'Missing DATABASE_URL (or POSTGRES_URL). Attach a Postgres database to this project in Vercel ' +
          '(Storage tab → Create Database), then set the same connection string in .env.local for local dev.'
      );
    }
    client = neon(connectionString);
  }
  return client;
}

// A Proxy so `sql` still works both as a tagged template (sql`...`) and via
// its `.query()` method (used by the migration scripts) without eagerly
// creating the real client.
export const sql = new Proxy(function () {}, {
  apply(_target, _thisArg, args) {
    return getClient()(...args);
  },
  get(_target, prop) {
    return getClient()[prop];
  },
});
