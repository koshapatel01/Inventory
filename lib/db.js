// Shared Postgres connection (Neon serverless driver — works over HTTP, so it
// survives Vercel's read-only, ephemeral serverless functions, unlike the
// old node:fs-based store). SERVER-ONLY.
//
// Accepts either DATABASE_URL or POSTGRES_URL since different versions of
// Vercel's Postgres/Neon integration have injected one or the other.

import { neon } from '@neondatabase/serverless';

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;

if (!connectionString) {
  throw new Error(
    'Missing DATABASE_URL (or POSTGRES_URL). Attach a Postgres database to this project in Vercel ' +
      '(Storage tab → Create Database), then set the same connection string in .env.local for local dev.'
  );
}

export const sql = neon(connectionString);
