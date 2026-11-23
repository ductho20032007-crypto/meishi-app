import { createApp } from 'vue'
import './styles/tokens.css'
import './styles/base.css'
import App from './App.vue'
import { router } from './router.js'
import { i18n } from './i18n/index.js'

createApp(App).use(i18n).use(router).mount('#app')
