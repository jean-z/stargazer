import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 5177 端口：避开 5173-5176
export default defineConfig({
  plugins: [react()],
  server: { port: 5177 },
})
