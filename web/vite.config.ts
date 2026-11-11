import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: true },
      '/uploads': { target: 'http://127.0.0.1:3000', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1200,

    /**
     * 目标浏览器：兼容到 ES2019
     *
     * 问题：默认 target 是 'modules'（≈ES2020+），会把 ??、?. 等
     * 现代语法原样输出。老旧设备（低版本 Android WebView、
     * iOS 13 以下 Safari、部分国产浏览器内核）不支持这些语法，
     * 解析阶段直接报错 → 页面永远白屏或卡在加载。
     *
     * es2019 会把这些语法降级为等价的 ES5/ES2015 写法，
     * 覆盖绝大多数在用设备。
     */
    target: 'es2019',

    /** 生成 sourcemap 便于线上排查（不影响加载） */
    sourcemap: false,

    rollupOptions: {
      output: {
        /**
         * 手动分包：把体积大且变动少的依赖拆出来
         *
         * 原来所有代码打成一个 864KB 的包，任何改动都会让
         * 用户重新下载整包；弱网下首屏要等很久。
         * 拆成 vendor（框架）+ 业务代码后：
         *   · vendor 可长期缓存，发版只重下小的业务包
         *   · 并行下载，首屏更快
         */
        // rolldown（Vite 8）只支持函数形式的 manualChunks
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return;
          if (/node_modules\/(react|react-dom|react-router|react-router-dom|scheduler)\//.test(id)) {
            return 'react-vendor';
          }
          if (id.includes('@radix-ui') || id.includes('sonner') || id.includes('lucide-react')) {
            return 'ui-vendor';
          }
          return 'vendor';
        },
      },
    },
  },
});
