import vue from '@vitejs/plugin-vue'
import Components from 'unplugin-vue-components/vite'
import { AntDesignVueResolver } from 'unplugin-vue-components/resolvers'
import { defineConfig } from 'vite'

/**
 * 录屏插件构建配置。
 *
 * 与目标插件（DogeVenci/utools-recorder）保持一致：
 * - Vue 3 + Ant Design Vue 3 + less，保证 antd 组件视觉与原版逐像素相同；
 * - unplugin-vue-components 按需解析 antd 组件并自动引入其 less 样式，
 *   这是原版样式的来源，不能改成手写 CSS。
 */
export default defineConfig({
  base: './',
  plugins: [vue(), Components({ dts: false, resolvers: [AntDesignVueResolver()] })],
  css: {
    preprocessorOptions: {
      less: {
        javascriptEnabled: true
      }
    }
  },
  server: {
    host: '127.0.0.1',
    port: 5178,
    strictPort: true,
    open: false
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
})
