import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// 把分享檔用的唯讀檢視器打包成單一 HTML（public/viewer.html），匯出時再塞入導圖資料
export default defineConfig({
  root: 'src/viewer',
  publicDir: false,
  plugins: [viteSingleFile()],
  build: { target: 'safari15', outDir: '../../public', emptyOutDir: false, rollupOptions: { input: 'src/viewer/viewer.html' } },
});
