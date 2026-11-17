import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { logError } from './lib/log';
import './style.css';

const app = createApp(App);

app.config.errorHandler = (error, _instance, info) => {
  logError('vue error', error, info);
};

window.addEventListener('unhandledrejection', event => {
  logError('unhandled rejection', event.reason);
});

app.use(createPinia()).mount('#app');
