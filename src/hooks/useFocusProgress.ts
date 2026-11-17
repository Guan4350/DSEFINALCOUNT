import { useCallback, useEffect, useRef, useState } from 'react';
import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useApp } from '../contexts/AppContext';

export type NodeStatus = 'not_started' | 'in_progress' | 'completed';

const TREE_ID = 'chem-focus-tree-3.1.0';
const LOCAL_KEY = 'focus-tree-progress:v1';
const VALID = new Set<NodeStatus>(['not_started', 'in_progress', 'completed']);

function readLocal(): Record<string, NodeStatus> {
  try {
    const raw = window.localStorage.getItem(LOCAL_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const result: Record<string, NodeStatus> = {};
    for (const [id, value] of Object.entries(parsed)) {
      if (typeof value === 'string' && VALID.has(value as NodeStatus)) {
        result[id] = value as NodeStatus;
      }
    }
    return result;
  } catch {
    return {};
  }
}

function writeLocal(statuses: Record<string, NodeStatus>): void {
  try {
    window.localStorage.setItem(LOCAL_KEY, JSON.stringify(statuses));
  } catch {
    // localStorage may be unavailable; cloud write still attempted.
  }
}

export function useFocusProgress() {
  const { user } = useApp();
  const [statuses, setStatuses] = useState<Record<string, NodeStatus>>(() => readLocal());
  const [ready, setReady] = useState(false);
  const statusesRef = useRef(statuses);
  statusesRef.current = statuses;

  useEffect(() => {
    let active = true;

    if (!user || !db) {
      setStatuses(readLocal());
      setReady(true);
      return () => {
        active = false;
      };
    }

    const ref = doc(db, 'internal_focus_progress', user.uid);
    const unsubscribe = onSnapshot(
      ref,
      snap => {
        if (!active) return;
        const data = snap.data() as { tree_id?: string; statuses?: Record<string, NodeStatus> } | undefined;
        setStatuses(data?.tree_id === TREE_ID ? data.statuses ?? {} : {});
        setReady(true);
      },
      error => {
        console.warn('[focus-tree] progress sync failed, using local cache', error);
        if (!active) return;
        setStatuses(readLocal());
        setReady(true);
      },
    );

    return () => {
      active = false;
      unsubscribe();
    };
  }, [user]);

  const setStatus = useCallback(
    async (nodeId: string, status: NodeStatus) => {
      const current = statusesRef.current;
      const next = { ...current };
      if (status === 'not_started') delete next[nodeId];
      else next[nodeId] = status;

      statusesRef.current = next;
      setStatuses(next);
      writeLocal(next);

      if (!user || !db) return;
      try {
        await setDoc(
          doc(db, 'internal_focus_progress', user.uid),
          { tree_id: TREE_ID, statuses: next, updated_at: serverTimestamp() },
          { merge: true },
        );
      } catch (error) {
        console.warn('[focus-tree] progress write failed', error);
      }
    },
    [user],
  );

  return { statuses, ready, setStatus };
}
