import type { ViewerReaction } from './contracts';

export interface ReactionState {
  key: string;
  status: 'loading' | 'ready' | 'error';
  reaction: ViewerReaction;
  error?: string;
}

export type ReactionStateEvent =
  | { type: 'load'; key: string }
  | { type: 'loaded' | 'updated'; key: string; reaction: ViewerReaction }
  | { type: 'failed'; key: string; error: string };

export function reactionStateReducer(
  state: ReactionState | undefined,
  event: ReactionStateEvent,
): ReactionState | undefined {
  if (event.type === 'load') {
    return { key: event.key, status: 'loading', reaction: null };
  }
  if (!state || state.key !== event.key) return state;
  if (event.type === 'failed') {
    return { key: event.key, status: 'error', reaction: null, error: event.error };
  }
  return { key: event.key, status: 'ready', reaction: event.reaction };
}

export function getVisibleReaction(
  state: ReactionState | undefined,
  key: string,
  isAuthenticated: boolean,
): ViewerReaction {
  return isAuthenticated && state?.key === key && state.status === 'ready'
    ? state.reaction
    : null;
}
