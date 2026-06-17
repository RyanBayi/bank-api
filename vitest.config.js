import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom', // Simule un navigateur (pour document, window, etc.)
    coverage: {
      provider: 'v8',
      include: ['src/**/*.js', 'public/**/*.js'], // On force l'inclusion du frontend
      reporter: ['text', 'json', 'html'],
    },
  },
});