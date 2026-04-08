type CanvasNodesDeletedListener = (nodeIds: string[]) => void | Promise<void>

const listeners = new Set<CanvasNodesDeletedListener>()

export function subscribeCanvasNodesDeleted(
  listener: CanvasNodesDeletedListener
): () => void {
  listeners.add(listener)

  return () => {
    listeners.delete(listener)
  }
}

export function emitCanvasNodesDeleted(nodeIds: readonly string[]): void {
  if (nodeIds.length === 0 || listeners.size === 0) {
    return
  }

  const payload = [...nodeIds]
  listeners.forEach((listener) => {
    try {
      void listener(payload)
    } catch (error) {
      console.error('[canvas] failed to notify deleted nodes listener', error)
    }
  })
}
