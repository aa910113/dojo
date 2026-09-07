export default defineNuxtConfig({
  ssr: false,
  devtools: { enabled: true },
  modules: ['@vite-pwa/nuxt'],
  app: {
    head: {
      title: '五十音打字練習',
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'theme-color', content: '#f8f6f0' },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-status-bar-style', content: 'default' },
      ],
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/icon.svg' },
        { rel: 'apple-touch-icon', href: '/icon-maskable.svg' },
        // 描紅範字用的教科書體;離線時退回系統日文字型
        { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Klee+One&family=M+PLUS+Rounded+1c:wght@800;900&family=Zen+Kaku+Gothic+New:wght@500;700&display=swap' },
      ],
    },
  },
  css: ['~/assets/main.css'],
  compatibilityDate: '2025-01-01',
  runtimeConfig: {
    public: {
      // 由 NUXT_PUBLIC_SUPABASE_URL / NUXT_PUBLIC_SUPABASE_KEY 環境變數覆蓋
      supabaseUrl: '',
      supabaseKey: '',
    },
  },
  pwa: {
    registerType: 'autoUpdate',
    manifest: {
      name: '五十音打字練習',
      short_name: '五十音',
      description: '平假名 / 片假名打字練習與間隔複習',
      lang: 'zh-Hant',
      theme_color: '#f8f6f0',
      background_color: '#f8f6f0',
      display: 'standalone',
      orientation: 'portrait',
      icons: [
        { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        { src: '/icon-maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
      ],
    },
    workbox: {
      globPatterns: ['**/*.{js,css,html,svg,woff2}'],
      navigateFallback: '/',
    },
    client: {
      installPrompt: true,
    },
    devOptions: {
      enabled: false,
    },
  },
})
