<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type Unsubscribe,
  type User,
} from 'firebase/auth';
import ProgressHeader from './components/ProgressHeader.vue';
import NodeCard from './components/NodeCard.vue';
import NodeDrawer from './components/NodeDrawer.vue';
import DebugPanel from './components/DebugPanel.vue';
import IconBoard from './components/IconBoard.vue';
import { auth } from './lib/firebase';
import { emitNodeSelected } from './lib/advisor';
import { logError, logInfo } from './lib/log';
import { useTreeStore } from './stores/tree';
import type { FocusNode, NodeStatus } from './types';

const store = useTreeStore();
const user = ref<User | null>(null);
const authReady = ref(false);
const signingIn = ref(false);
const authError = ref('');
const selected = ref<FocusNode | null>(null);
const showDebug = ref(store.debug);
const activeTab = ref<'board' | 'tree'>('board');

let unsubscribeAuth: Unsubscribe | null = null;

onMounted(() => {
  unsubscribeAuth = onAuthStateChanged(auth, async nextUser => {
    user.value = nextUser;
    authReady.value = true;
    store.detach();
    store.$reset();
    showDebug.value = store.debug;

    if (!nextUser) return;

    logInfo('auth', { uid: nextUser.uid });
    await store.load();
    if (!store.unauthorized) {
      store.attach(nextUser.uid);
    }
  });
});

onUnmounted(() => {
  unsubscribeAuth?.();
  store.detach();
});

async function signIn() {
  signingIn.value = true;
  authError.value = '';
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (cause) {
    authError.value = cause instanceof Error ? cause.message : String(cause);
    logError('sign in failed', cause);
  } finally {
    signingIn.value = false;
  }
}

async function signOutNow() {
  await signOut(auth);
}

function openNode(node: FocusNode) {
  selected.value = node;
  emitNodeSelected(node);
}

function switchTab(tab: 'board' | 'tree') {
  activeTab.value = tab;
  if (tab === 'board') selected.value = null;
}

function openNodeById(nodeId: string) {
  const node = store.nodeById(nodeId);
  if (!node) return;
  activeTab.value = 'tree';
  selected.value = node;
  emitNodeSelected(node);
}

async function setStatus(status: NodeStatus) {
  if (!selected.value) return;
  await store.setStatus(selected.value.id, status);
}
</script>

<template>
  <div v-if="!authReady" class="center">
    <p>載入中…</p>
  </div>

  <div v-else-if="!user" class="login">
    <p class="eyebrow">INTERNAL · CHEMISTRY</p>
    <h1>國策樹（內部完整版）</h1>
    <p class="sub">此版本含 CONFIDENTIAL Marking Scheme 節點，僅限授權人員存取。</p>
    <button class="btn primary" type="button" :disabled="signingIn" @click="signIn">
      {{ signingIn ? '登入中…' : 'Google 登入' }}
    </button>
    <p v-if="authError" class="error">{{ authError }}</p>
  </div>

  <template v-else>
    <header class="topbar">
      <div>
        <p class="eyebrow">INTERNAL · v{{ store.tree?.release.version ?? '—' }}</p>
        <strong>Chemistry 國策樹</strong>
      </div>
      <nav class="tabs">
        <button type="button" :class="{ active: activeTab === 'board' }" @click="switchTab('board')">
          國策
        </button>
        <button type="button" :class="{ active: activeTab === 'tree' }" @click="switchTab('tree')">
          樹狀圖
        </button>
      </nav>
      <div class="account">
        <span>{{ user.email }}</span>
        <button class="btn small" type="button" @click="signOutNow">登出</button>
      </div>
    </header>

    <main class="page">
      <p v-if="store.loading" class="center">載入樹資料…</p>

      <div v-else-if="store.unauthorized" class="center">
        <h2>沒有內部存取權限</h2>
        <p>{{ store.error }}</p>
        <p class="muted">請管理員建立 <code>internal_access/{{ user.uid }}</code>，active 設 true。</p>
      </div>

      <template v-else-if="store.tree">
        <p class="confidential-banner">
          內部完整版含 2024 HKEAA Marking Scheme（CONFIDENTIAL）。禁止對外披露、截圖外流或令學生取得。
        </p>

        <ProgressHeader
          :percent="store.weightedPercent"
          :target="store.tree.target_grade"
          :version="store.tree.schema_version"
          :status="store.tree.status"
          :counts="store.counts"
        />

        <p v-if="store.error" class="error">{{ store.error }}</p>

        <IconBoard
          v-if="activeTab === 'board'"
          :statuses="store.statuses"
          :node-by-id="store.nodeById"
          @open="openNodeById"
        />

        <section v-else class="groups">
          <section
            v-for="group in store.groups"
            :key="group.key"
            class="group"
            :class="{ confidential: group.confidential }"
          >
            <header class="group-head">
              <h2>{{ group.label }}</h2>
              <p>{{ group.description }}</p>
            </header>
            <div class="grid">
              <NodeCard
                v-for="node in group.nodes"
                :key="node.id"
                :node="node"
                :status="store.statusOf(node.id)"
                :unlocked="store.isUnlocked(node.id)"
                :missing="store.missingPrerequisites(node.id)"
                :confidential="group.confidential"
                @open="openNode"
              />
            </div>
          </section>
        </section>

        <NodeDrawer
          v-if="selected"
          :node="selected"
          :status="store.statusOf(selected.id)"
          :unlocked="store.isUnlocked(selected.id)"
          :missing="store.missingPrerequisites(selected.id)"
          :saving="store.saving === selected.id"
          @close="selected = null"
          @set-status="setStatus"
        />

        <button class="debug-toggle" type="button" @click="showDebug = !showDebug">
          {{ showDebug ? '關閉 DEBUG' : 'DEBUG' }}
        </button>

        <DebugPanel
          v-if="showDebug"
          class="debug-wrap"
          :tree="store.tree"
          :statuses="store.statuses"
          :percent="store.weightedPercent"
        />
      </template>

      <p v-else class="center error">{{ store.error || '無法載入資料' }}</p>
    </main>
  </template>
</template>

<style scoped>
.center {
  padding: 60px 24px;
  text-align: center;
  color: var(--muted);
}

.login {
  max-width: 520px;
  margin: 12vh auto 0;
  padding: 32px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.eyebrow {
  margin: 0;
  font-size: 11px;
  letter-spacing: 0.12em;
  color: var(--muted);
}

.login h1 {
  margin: 0;
  font-size: 26px;
}

.sub {
  margin: 0 0 8px;
  font-size: 13px;
  color: var(--muted);
  line-height: 1.6;
}

.topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 12px 24px;
  border-bottom: 1px solid var(--line);
  background: var(--surface);
  position: sticky;
  top: 0;
  z-index: 30;
}

.topbar strong {
  font-size: 15px;
}

.tabs {
  display: flex;
  gap: 4px;
  margin-left: auto;
}

.tabs button {
  border: 1px solid transparent;
  background: none;
  color: var(--muted);
  border-radius: 9px;
  padding: 6px 16px;
  font-size: 13px;
  cursor: pointer;
}

.tabs button.active {
  border-color: var(--line);
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 600;
}

.account {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: var(--muted);
}

.page {
  max-width: 1280px;
  margin: 0 auto;
  padding: 22px 24px 90px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.confidential-banner {
  margin: 0;
  padding: 10px 14px;
  border-radius: 10px;
  background: #fbe9e7;
  color: #9b2c1f;
  font-size: 12px;
  line-height: 1.5;
}

.error {
  margin: 0;
  color: #a33b2c;
  font-size: 13px;
}

.muted {
  color: var(--muted);
}

.groups {
  display: flex;
  flex-direction: column;
  gap: 22px;
}

.group {
  border: 1px solid var(--line);
  border-radius: 16px;
  padding: 16px;
  background: rgba(255, 255, 255, 0.5);
}

.group.confidential {
  border-style: dashed;
  border-color: #d8a099;
  background: #fff7f5;
}

.group-head {
  margin-bottom: 12px;
}

.group-head h2 {
  margin: 0 0 4px;
  font-size: 17px;
}

.group-head p {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 10px;
}

.debug-toggle {
  position: fixed;
  right: 18px;
  bottom: 18px;
  z-index: 35;
  border: 1px solid var(--line);
  background: #1f2723;
  color: #d9e2dc;
  border-radius: 999px;
  padding: 8px 14px;
  font-size: 11px;
  letter-spacing: 0.08em;
  cursor: pointer;
}

.debug-wrap {
  margin-top: 8px;
}
</style>
