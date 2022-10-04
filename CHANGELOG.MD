# Changes

This document will include all changes across versions of Prisma Util. When you run an outdated version, you'll be redirected to the specific section of this document to see what changes have been made.

## Notations

- `[BREAKING]` This change will provide changes to the configuration file that must be made in order for Prisma Util to run.
- `[FIX]` Bug or incorrect behavior fixes.
- `[FEATURE]` New feature added to Prisma Util.
- `[BACKEND]` Improved internals for Prisma Util.
- `[QOL]` Quality of Life improvement for the Developer Experience.

## v1.3.0

- `[BREAKING]` Migrated configuration file from `.json` to `.mjs` to provide pathway for code-generated schemas.
- `[FEATURE]` Code-generated schemas have been added.
- `[FEATURE]` Prisma Util now has an update warning.
- `[QOL]` Added comments to models and enums in the generated schema containing the original file name.
- `[BACKEND]` Improved internals for handling migrations, to allow you to create `.ts` migration files in v1.4.0 and to facilitate `pg_trgm` integration with Prisma
