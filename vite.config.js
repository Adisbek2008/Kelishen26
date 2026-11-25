import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'client',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false },
  server: { port: 5173, proxy: {
    // changeOrigin: false — сохраняем Host браузера, иначе серверная проверка Origin (CSRF) отклонит запросы
    '/api': { target: 'http://localhost:3000', changeOrigin: false },
  } },
});
