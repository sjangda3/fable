# Running a sync server

Fable's server consists of Supabase Auth, PostgreSQL, private Storage, and one Edge Function. The same schema and function support a hosted Supabase project or the official Docker self-hosted stack. No server is enabled for local-only use.

## Hosted Supabase project

Use your own project and SMTP configuration. Review the migration before applying it to an existing project; it creates Fable-prefixed public tables and private functions.

```sh
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
npx supabase functions deploy sync --no-verify-jwt
```

`verify_jwt = false` delegates bearer-token verification to the function's `admin.auth.getUser(token)` call. It does not allow unauthenticated sync operations. The function also checks that the live Auth session belongs to the active device.

In Auth settings, enable email OTP, configure a six-digit code and SMTP, and use the template in `supabase/templates/sign-in.html`. The app submits the email and verification code directly; it does not require a web redirect. Set appropriate project email rate limits for your installation.

Supabase provides `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to hosted functions. The service-role key stays server-side. The desktop needs only the project URL and public publishable/anon key.

## Local development stack

Requires a running Docker-compatible engine:

```sh
npx supabase start
npx supabase db reset
npx supabase functions serve sync --no-verify-jwt
```

Use the local URL and public key shown by `supabase status`, then retrieve OTP codes from the local mail interface. The supplied ports are API 54321, Postgres 54322, Studio 54323, and mail 54324. Loopback HTTP is accepted for development; other endpoints require HTTPS.

## Docker self-hosting

Start from the [official Supabase Docker deployment](https://supabase.com/docs/guides/self-hosting/docker). Pin the platform versions you validate and supply HTTPS, SMTP, strong independent secrets, persistent volumes, backups, and working Edge Runtime routing.

1. Apply `supabase/migrations/20261016031356_initial_encrypted_sync.sql` as the database owner to the Supabase database.
2. Mount `supabase/functions/sync` into the Edge Runtime functions volume, keeping the name `sync`.
3. Provide the stack's internal `SUPABASE_URL` and service-role key to the Edge Runtime. Route `/functions/v1/sync` through the normal API gateway.
4. Configure the Auth email template and OTP values above. A login must produce a real user session with a `session_id` claim.
5. Enter the externally reachable URL and public client key in Fable's Self-hosted settings.
6. Register the first vault, save the recovery key outside it, then connect a second computer with the same vault ID and key.

Do not expose Postgres, service-role keys, Studio, or mail-development interfaces as public app endpoints. Do not log Edge request bodies or bearer tokens. The function returns bounded operational errors without note content or server configuration.

## Hosted Fable build

Set these public build variables before `npm run make`:

```dotenv
VITE_FABLE_SYNC_URL=https://your-project.supabase.co
VITE_FABLE_SYNC_PUBLISHABLE_KEY=your-public-client-key
```

They configure the Fable cloud choice in Settings. Never place a service-role key in a `VITE_` variable. A build with no hosted endpoint still exposes the complete self-hosted connection flow.

## Operations

Change `fable_private.limits.account_bytes` and `pending_uploads` as the database owner if needed. Back up encrypted Storage and the database together. Keep committed revision history and tombstones; no destructive retention worker is installed. Monitor orphan cleanup failures, storage use, email delivery, and function errors without collecting plaintext documents.

Account recovery does not recover vault keys. Test restoring a database/storage backup and unlocking it with a recovery key before offering a public service. The current workspace has no deployed project or running Docker daemon, so hosted and Docker-platform round trips are not claimed as completed.
