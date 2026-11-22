import { shallowRef, onScopeDispose } from 'vue'
import { liveQuery } from 'dexie'

export function useLive(queryFn, initial = undefined) {
  const state = shallowRef(initial)
  const sub = liveQuery(queryFn).subscribe({ next: v => { state.value = v }, error: e => console.error('liveQuery', e) })
  onScopeDispose(() => sub.unsubscribe())
  return state
}
