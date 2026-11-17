import 'ant-design-vue/dist/reset.css'
import Antd from 'ant-design-vue'
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'

createApp(App).use(Antd).use(createPinia()).mount('#app')
