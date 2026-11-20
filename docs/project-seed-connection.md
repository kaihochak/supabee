# Project-based seed connection resolver

`src/lib/project-seed-connection.ts` resolves a Supabase project reference to
temporary Postgres connection credentials. It is used by project targets in `supabee db reset --remote` and
`supabee seed --remote`, including explicit project references and branches.

Inputs are a 20-letter project reference and Supabase authentication. Tokens are
resolved from `SUPABASE_ACCESS_TOKEN`, Supabase CLI's OS keyring (current then
legacy account), or the saved access-token file under `SUPABASE_HOME` / `~/.supabase`.
No connection string is prompted for. The native keyring library is optional;
when unavailable, use an environment token or Supabase's saved-token fallback.
Only the default Supabase cloud profile is supported for automatic credentials;
other profiles must use an explicit database URL. No credentials are printed.

The resolver probes the direct database host on port 5432. If unreachable, it
requests the project's primary pooler configuration, validates the project tenant
and Supabase pooler hostname, and uses session port 5432. It then requests a
temporary writable login role and returns:

- `dbUrl`: an encoded connection URL with TLS required.
- `expiresAt`: conservative credential expiry based on the API's TTL.
- `sessionSetupSql`: `SET SESSION ROLE postgres;`, to execute in each new psql
  session before the loader's timeout and trigger settings.

`createProjectSeedConnectionProvider` caches credentials and refreshes shortly
before expiry. Call the provider before opening the connection for each seed file.
It coalesces concurrent refresh requests and never retries seed SQL. A failed
refresh must stop the caller before it starts the next seed file.

Reset obtains credentials after confirmation and checks a psql connection plus
role/trigger setup before any destructive operation. It obtains fresh credentials
after reset, because Supabase CLI may rotate the shared temporary role password.
The seed loader checks each new credential before using it, retrying session setup
briefly for pooler propagation without ever retrying seed SQL. Resolving credentials provisions a temporary database login through
the Management API, even though it does not execute seed SQL. Do not print the
returned URL or credentials. Existing `withPsqlConnection` passes the password
through the child environment and removes its private service file afterward.
The resolver does not delete shared CLI login roles or change network bans.

The [temporary-login API](https://supabase.com/docs/reference/api/v1-create-login-role)
is experimental and requires database-write permissions. Connection fallback uses
the [pooler configuration API](https://supabase.com/docs/reference/api/v1-get-pooler-config).
The flow follows Supabase CLI v3.0.0's
[connection resolver](https://github.com/supabase/cli/blob/v3.0.0/apps/cli/src/command-internal/db-config.layer.ts).

Tests mock HTTP and reachability; they do not obtain live credentials. Live
permissions, pooler credential propagation, and trigger disabling still require
validation against a disposable project before live compatibility is considered
verified. Tests cover expiry, invalid responses, pooler tenant validation,
credential encoding, private psql configuration, and secret-free failures.
