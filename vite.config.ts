import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  const keys = ['ANTHROPIC_API_KEY', 'PERPLEXITY_API_KEY', 'GROK_API_KEY'];
  // Gemini ключ лише на Python-сервері (scrapling); у клієнтський бандл не потрапляє.
  if (mode !== 'test') {
    for (const k of keys) {
      console.log(`[env] ${k}: ${env[k] ? '✅ set' : '❌ MISSING'}`);
    }
  }

  return {
    test: {
      globals: true,
      environment: 'jsdom',
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    },
    root: path.resolve(__dirname),
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      proxy: {
        '/api/scrape': { target: 'http://127.0.0.1:8765', changeOrigin: true },
        '/api/concerts': { target: 'http://127.0.0.1:8765', changeOrigin: true },
        '/api/gemini/stream': { target: 'http://127.0.0.1:8765', changeOrigin: true },
        '/api/perplexity': {
          target: 'https://api.perplexity.ai',
          changeOrigin: true,
          rewrite: () => '/chat/completions',
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.setHeader('Authorization', `Bearer ${env.PERPLEXITY_API_KEY}`);
            });
          },
        },
        '/api/grok': {
          target: 'https://api.x.ai',
          changeOrigin: true,
          rewrite: () => '/v1/chat/completions',
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.setHeader('Authorization', `Bearer ${env.GROK_API_KEY}`);
            });
          },
        },
        '/api/claude': {
          target: 'https://api.anthropic.com',
          changeOrigin: true,
          rewrite: () => '/v1/messages',
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.setHeader('x-api-key', env.ANTHROPIC_API_KEY || '');
              proxyReq.setHeader('anthropic-version', '2023-06-01');
            });
            proxy.on('proxyRes', (proxyRes) => {
              proxyRes.headers['access-control-allow-origin'] = '*';
            });
          },
        },
      },
    },
  };
});
