import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import type { Plugin } from 'vite'

function runtimeConfig(): Record<string, string> {
  return {
    WAMP_URL: process.env.VITE_WAMP_URL ?? 'ws://localhost:8080/ws',
    WAMP_WT_URL: process.env.VITE_WAMP_WT_URL ?? 'https://localhost:8082/wamp',
    WAMP_WT_CERT_URL: process.env.VITE_WAMP_WT_CERT_URL ?? 'http://localhost:8083/wt-cert-hash',
    WAMP_REALM: process.env.VITE_WAMP_REALM ?? 'io.xconn.deskconn',
    REGISTRATION_AUTHID: process.env.VITE_REGISTRATION_AUTHID ?? 'deskconn-web-app',
  }
}

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

function appConfigDevPlugin(): Plugin {
  return {
    name: 'app-config-dev',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/app/config.js', (_req, res) => {
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
        res.end(`window.__APP_CONFIG__ = ${JSON.stringify(runtimeConfig())};`)
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    vueDevTools(),
    appConfigDevPlugin(),
    serviceWorkerDevPlugin(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
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
