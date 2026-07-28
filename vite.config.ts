import { defineConfig } from 'vitest/config';
import { chroniclePlugin } from './server/chronicle-plugin.js';
import { oraclePlugin } from './server/oracle-plugin.js';
import { witnessPlugin } from './server/witness-plugin.js';

export default defineConfig({
  plugins: [chroniclePlugin(), oraclePlugin(), witnessPlugin()],
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
  },
});
