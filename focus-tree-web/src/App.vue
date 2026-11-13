<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { RouterLink, RouterView } from 'vue-router';
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import { auth } from './lib/firebase';

const user = ref<User | null>(null);

onMounted(() => {
  onAuthStateChanged(auth, value => {
    user.value = value;
  });
});

async function signIn() {
  await signInWithPopup(auth, new GoogleAuthProvider());
}

async function signOutNow() {
  await signOut(auth);
}
</script>

<template>
  <header class="topbar">
    <RouterLink to="/" class="brand">國策樹</RouterLink>
    <nav class="nav">
      <RouterLink to="/focus/chem-2027">chem-2027</RouterLink>
      <RouterLink to="/admin/focus-progress">管理員重置</RouterLink>
      <RouterLink to="/admin/focus-publish">驗證發佈</RouterLink>
    </nav>
    <div class="account">
      <template v-if="user">
        <span class="email">{{ user.email }}</span>
        <button class="btn small" type="button" @click="signOutNow">登出</button>
      </template>
      <button v-else class="btn small" type="button" @click="signIn">Google 登入</button>
    </div>
  </header>
  <main>
    <RouterView />
  </main>
</template>

<style scoped>
.topbar {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 12px 24px;
  border-bottom: 1px solid var(--line);
  background: var(--surface);
  position: sticky;
  top: 0;
  z-index: 30;
}

.brand {
  font-weight: 700;
  font-size: 16px;
  color: var(--text);
  text-decoration: none;
}

.nav {
  display: flex;
  gap: 16px;
  font-size: 13px;
}

.nav a {
  color: var(--muted);
  text-decoration: none;
}

.nav a.router-link-active {
  color: var(--accent);
}

.account {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
}

.email {
  color: var(--muted);
}
</style>
