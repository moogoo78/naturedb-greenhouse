import { defineConfig } from 'vite';

// Dev: proxy naturedb so the client is same-origin (no CORS, host-only cookie).
// naturedb picks its Site from the Host header, so send the site's host.
const target = process.env.NATUREDB_PROXY_TARGET || 'http://flask:5000';
const host = process.env.NATUREDB_SITE_HOST || 'hast.localhost:5000';
const proxy = { target, changeOrigin: false, headers: { host } };

export default defineConfig({
  server: {
    proxy: {
      '/api': proxy,
      '/admin': proxy,
      '/static': proxy,
    },
  },
});
