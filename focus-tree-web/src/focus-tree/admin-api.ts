import { httpsCallable } from 'firebase/functions';
import { functions } from '../lib/firebase';
import type { LookupUserResult, PublishResult, ResetInput, ResetResult, ValidateResult } from './types';

export async function lookupUser(email: string): Promise<LookupUserResult> {
  const call = httpsCallable<{ email: string }, LookupUserResult>(functions, 'focusAdminLookupUser');
  const result = await call({ email });
  return result.data;
}

export async function resetProgress(input: ResetInput): Promise<ResetResult> {
  const call = httpsCallable<ResetInput, ResetResult>(functions, 'focusProgressReset');
  const result = await call(input);
  return result.data;
}

export async function validateTree(input: { treeId: string; nodes: unknown[] }): Promise<ValidateResult> {
  const call = httpsCallable<typeof input, ValidateResult>(functions, 'focusTreeValidate');
  const result = await call(input);
  return result.data;
}

export async function approveTree(input: { treeId: string; importId: string }): Promise<{ importId: string; status: string; nodeCount: number }> {
  const call = httpsCallable<typeof input, { importId: string; status: string; nodeCount: number }>(
    functions,
    'focusTreeApprove',
  );
  const result = await call(input);
  return result.data;
}

export async function publishTree(input: {
  treeId: string;
  importId: string;
  expectedVersion: number;
}): Promise<PublishResult> {
  const call = httpsCallable<typeof input, PublishResult>(functions, 'focusTreePublish');
  const result = await call(input);
  return result.data;
}
