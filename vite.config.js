import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [
    vue(),
    electron([
      {
        entry: resolve(__dirname, 'src/main/index.js'),
        onstart(options) {
          options.startup()
        },
        vite: {
          build: {
            outDir: resolve(__dirname, 'dist/main'),
            rollupOptions: {
              input: {
                index: resolve(__dirname, 'src/main/index.js'),
                schemaStorage: resolve(__dirname, 'src/main/schemaStorage.js')
              },
              external: ['electron']
            }
          }
        }
      },
      {
        entry: resolve(__dirname, 'src/preload/index.js'),
        onstart(options) {
          options.reload()
        },
        vite: {
          build: {
            outDir: resolve(__dirname, 'dist/preload')
          }
        }
      }
    ]),
    renderer()
  ],
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  build: {
    outDir: resolve(__dirname, 'dist/renderer')
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer/src')
    }
  }
})
