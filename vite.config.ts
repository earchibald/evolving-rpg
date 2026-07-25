import { defineConfig } from 'vitest/config';
import { chroniclePlugin } from './server/chronicle-plugin.js';

export default defineConfig({
  plugins: [chroniclePlugin()],
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
  },
});
