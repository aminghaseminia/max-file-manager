import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Keep runtime packages in node_modules; bundling dbus-next also hoists optional transports
  // (such as x11) into eager requires even when the session bus uses Unix-socket auth.
  main: { plugins: [externalizeDepsPlugin()] },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: { plugins: [react()] }
})
