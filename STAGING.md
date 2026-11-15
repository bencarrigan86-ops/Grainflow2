# A test copy of Grainflow

A second copy of the app and the database, so a change can be tried on made-up data before it goes near the farm's
real records. About an hour to set up, once. Nothing in it touches the live farm.

The app is ready for it (`docs/js/env.js`). A copy served from a name starting with `grainflow2-test` uses the test
database, shows a red "TEST COPY" bar on every screen, and never falls back to the live database. Until step 2 is done
it talks to nothing at all.

## 1. A second database

1. In Supabase, create a new project (the free plan is fine for testing). Call it `grainflow-test`.
2. Open its SQL editor and paste in all of `supabase/paste-into-sql-editor.sql`, then press Run. That builds the same
   tables, rules and functions as the live one. (The first migrations in `supabase/migrations` create the base tables
   and are older than the paste file; run those in date order first, then the paste file.)
3. In Authentication, switch on email sign-in, the same as the live project.

## 2. Point the test copy at it

1. In the test project, Settings, API: copy the project URL and the publishable key (`sb_publishable_...`). Never the
   secret key.
2. Put them in `docs/js/env.js`, in `TEST`:
   ```js
   export const TEST = { name: 'test', url: 'https://xxxx.supabase.co', key: 'sb_publishable_...' };
   ```
3. Commit it. The live app ignores `TEST`: it only reads it on a `grainflow2-test` address.

## 3. A second place to serve it

Cloudflare, Workers & Pages: create another Worker from the same GitHub repository.

- Name: `grainflow2-test` (the address becomes `grainflow2-test.<your account>.workers.dev`).
- Branch: use a branch called `test` so the live app only changes when `main` does. Make changes on `test`, try them
  on the test address, and merge to `main` when they are right.
- Build settings: none (the same as the live one; `wrangler.jsonc` serves `docs/`).

## 4. Test data

Sign up on the test address, make a farm, and choose sample data when it offers it. Or use Settings, Import backup with
a copy of the farm that has the names and money changed. Do not put the real backup in the test project: it is a second
copy of the real farm in a place that is looked after less.

## Using it

- Try every change on the test address first, signed in as each role that it affects.
- Support access and the SQL both behave the same there, so run any new SQL on the test project first.
- Delete the test project's data whenever you like. Nothing depends on it.
