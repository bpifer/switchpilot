import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // DB-backed test files (api, audit chain) share one Postgres and both run
    // migrations on startup; running files sequentially avoids that race.
    // The whole suite is a few seconds, so this costs almost nothing.
    fileParallelism: false
  }
});
