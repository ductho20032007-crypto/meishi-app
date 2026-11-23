import { shallowRef, onScopeDispose, getCurrentScope } from 'vue'
import { liveQuery } from 'dexie'

// useLiveState(queryFn, initial) -> { data, error } (both shallowRefs); unsubscribes when the scope is disposed.
export function useLiveState(queryFn, initial = undefined) {
  const data = shallowRef(initial)
  const error = shallowRef(null)
  const sub = liveQuery(queryFn).subscribe({
    next: v => { data.value = v; error.value = null },
    error: e => { error.value = e; console.error('liveQuery', e) }
  })
  if (getCurrentScope()) onScopeDispose(() => sub.unsubscribe())
  return { data, error }
}

// useLive(queryFn, initial) -> shallowRef of the query result
export function useLive(queryFn, initial = undefined) {
  return useLiveState(queryFn, initial).data
}
