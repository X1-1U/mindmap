import { defineConfig } from 'vite';

// Tauri 開發模式固定用 1420 埠
export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true, host: process.env.TAURI_DEV_HOST || '127.0.0.1' },
  envPrefix: ['VITE_', 'TAURI_ENV_*'],
  build: { target: 'safari15', outDir: 'dist', emptyOutDir: true },
});
