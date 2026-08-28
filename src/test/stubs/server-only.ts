// Stub for the `server-only` package in tests. The real package throws when
// imported outside a React Server Component bundler context, which breaks
// Vitest (node environment). Vitest aliases "server-only" to this file.
export {};