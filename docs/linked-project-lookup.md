# Linked project lookup

`resolveLinkedProject` in `src/lib/linked-project.ts` resolves project identity in
this order:

1. A nonblank `SUPABASE_PROJECT_ID` environment variable.
2. The reference saved in `supabase/.temp/project-ref` in the current project.
3. In an interactive terminal, `supabase link` opens Supabase's project picker
   and saves the selected reference. Supabee reads that saved selection.
4. Without a terminal or an existing selection, fail with instructions to set
   the environment variable, link the project, or supply an explicit reference.

The result contains `projectRef` and `source` (`environment`, `saved`, or
`picker`). Invalid nonblank references fail instead of falling through to a
different project. Environment selection does not overwrite the saved link.
An unreadable saved reference or cancelled picker stops lookup.

This helper resolves identity only. It does not request database credentials,
reset a database, or seed data. The interactive fallback runs Supabase's link
workflow, including its authentication and local project-link updates.

The picker callback must save its selection using Supabase's standard link file.
`db reset --remote` uses this lookup, then forwards the selected project reference
to cutoff detection, reset, and migration replay. Explicit projects and branches
also use their resolved project reference; explicit URLs remain URL targets.
Project targets obtain temporary seed credentials using Supabase login or
`SUPABASE_ACCESS_TOKEN`; they do not prompt for a separate URL and ignore stale
`SUPABASE_DB_URL` / `PGURI` values. Explicit URL targets use their supplied URL.
Plain reset stays local; legacy URL-based target options retain their behavior.

Tests exercise lookup ordering, saved files, noninteractive failures, and
picker success/cancellation with a stub picker. They never open a real picker
or contact Supabase.
