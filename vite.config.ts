/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages serves project sites from /<repo>/; the deploy workflow passes
// the right base path in. Locally the app is served from the root.
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base,
  plugins: [
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'favicon-32.png', 'apple-touch-icon.png'],
      manifest: {
        id: base,
        name: 'Next Bus',
        short_name: 'Next Bus',
        description: 'Live bus departures for your stop, powered by bustimes.org.',
        lang: 'en',
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f6f7f9',
        theme_color: '#0f6b4f',
        categories: ['travel', 'navigation'],
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        shortcuts: [{ name: 'Stops', url: `${base}#/stops`, icons: [{ src: 'pwa-192.png', sizes: '192x192' }] }],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // Stop and route lookups change rarely: try the network briefly,
            // then fall back to the last copy so the app still opens offline.
            // Departures themselves are cached by the app with timestamps.
            urlPattern: ({ url }) =>
              url.origin === 'https://bustimes.org' && /^\/api\/(stops|services)\//.test(url.pathname),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'bustimes-lookups',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 100, maxAgeSeconds: 7 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
