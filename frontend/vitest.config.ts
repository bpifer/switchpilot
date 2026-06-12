import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    // globals enables testing-library's automatic DOM cleanup between tests
    globals: true,
    setupFiles: ['src/test/setup.ts'],
    css: false
  }
});
