import { createRouter, createWebHistory } from 'vue-router';
import FocusTreeView from './focus-tree/views/FocusTreeView.vue';
import AdminProgressResetView from './focus-tree/views/AdminProgressResetView.vue';
import AdminPublishView from './focus-tree/views/AdminPublishView.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/focus/chem-2027' },
    { path: '/focus/:treeId', name: 'focus-tree', component: FocusTreeView },
    { path: '/admin/focus-progress', name: 'admin-progress', component: AdminProgressResetView },
    { path: '/admin/focus-publish', name: 'admin-publish', component: AdminPublishView },
  ],
});
