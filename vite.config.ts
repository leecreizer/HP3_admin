import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // 외부(LAN) 접속 허용: 0.0.0.0 바인딩, dev/preview 공통
  server: {
    host: true,      // 0.0.0.0 — LAN/외부 PC 접속 허용
    port: 5180,
    strictPort: true,
    allowedHosts: true,   // 터널(trycloudflare.com 등) 도메인 허용
  },
  preview: {
    host: true,
    port: 5180,
    strictPort: true,
    allowedHosts: true,
  },
})
