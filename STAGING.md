# A test copy of the app

A second copy of the app and the database, so a change can be tried before it goes near the farm's real records. Nothing in it
touches the live farm.

The app is ready for it (`docs/js/env.js`). A copy served from a name starting with `grainflow2-test` uses the test database,
shows a red "TEST COPY" bar on every screen, and never falls back to the live database.

## 1. The test database (done)

A second Supabase project, in the same organisation as the live one, in the same region (Sydney).

1. Create the project (Supabase, New project). Compute size Micro. Leave "Grant API access to new tables automatically" and
   "Enable RLS on new tables automatically" off: the migrations do both themselves.
2. Build it: run `supabase/test-copy/part-1.sql` to `part-4.sql`, in order, each in a new SQL editor query. They are every
   migration in date order. After a new migration is added, run `node tools/make-test-sql.mjs` to rebuild them, or just paste
   the new migration into the test project's SQL editor.
3. Authentication, Sign In / Providers, User Signups: turn Confirm email off. Leave sign-ups on while the test accounts are
   made, then turn them off.

## 2. Point the test copy at it (done)

The project address and the publishable key (`sb_publishable_...`, never the secret key) are in `docs/js/env.js`, in `TEST`.
The live app ignores `TEST`: it only reads it on a `grainflow2-test` address.

## 3. A second place to serve it

Cloudflare, Workers & Pages, Create, Import a repository: the same GitHub repository.

- Worker name: `grainflow2-test` (the address becomes `grainflow2-test.<account>.workers.dev`).
- Production branch: `test`, so the live app changes only when `main` does. Try things on `test`, merge to `main` when right.
- Build settings: no build command. Deploy command: `npx wrangler deploy -c wrangler.test.jsonc` (the test Worker's own config,
  so its name matches the Worker).

## 4. Test data and people

- The family farm's own data can be used here (it is a copy, on a private project): in the live app, Settings, download a backup;
  on the test address, sign in and import it. Then delete the bank details and signature. Keep the file out of the repository
  (`*backup*.json` is ignored) and delete it afterwards. Never copy a trial farm or anyone else's data.
- One test account for each role (owner, manager, bookkeeper, worker, driver, advisor). Use your own email with `+role` added
  before the `@`, so every email comes to you. Invite each one from the owner's Settings, People.
- When the accounts exist, turn off "Allow new users to sign up" so nobody else can make one.

## Using it

- Try every change on the test address first, signed in as each role that it affects.
- Run any new SQL on the test project first.
- Refresh the data from a new backup whenever it gets stale.
