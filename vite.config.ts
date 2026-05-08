import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import type { Plugin } from 'vite'

function serviceWorkerDevPlugin(): Plugin {
  return {
    name: 'sw-download-dev',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/sw-download.js', async (_req, res) => {
        const result = await server.transformRequest('/src/sw-download.ts')
        if (!result) { res.statusCode = 404; res.end(); return }
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
        res.end(result.code)
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    vueDevTools(),
    serviceWorkerDevPlugin(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        'sw-download': fileURLToPath(new URL('./src/sw-download.ts', import.meta.url)),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === 'sw-download' ? '[name].js' : 'assets/[name]-[hash].js',
      },
    },
  },
})
