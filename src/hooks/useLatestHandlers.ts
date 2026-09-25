import { useMemo, useRef } from 'react'

// Functions of fixed identity that always run the latest version given.
//
// For handlers handed to something memoized. A memoized child that skips a
// render keeps the handlers from its last one, and a plain handler closes over
// the state of the render it was made in -- so it would act on a selection, a
// mode or a position that has since changed. These read the latest version
// when called instead, from a ref updated on every render.
export function useLatestHandlers<T extends Record<string, (...args: any[]) => any>>(handlers: T): T {
  const latest = useRef(handlers)
  latest.current = handlers
  return useMemo(() => {
    const stable = {} as T
    for (const key of Object.keys(handlers) as (keyof T)[]) {
      stable[key] = ((...args: unknown[]) => latest.current[key](...args)) as T[keyof T]
    }
    return stable
    // The keys are fixed at the first render; later ones only change what runs.
  }, [])
}
