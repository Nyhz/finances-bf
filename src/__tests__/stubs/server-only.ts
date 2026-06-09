// Vitest stand-in for the "server-only" marker package. The real package
// throws outside a React Server Component environment (by design); tests
// import server modules directly, so the marker is aliased to this no-op
// in vitest.config.ts.
export {};
