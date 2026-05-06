const OPEN_PROFILE_MODAL_EVENT = 'open-profile-modal'

export function requestOpenProfileModal() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(OPEN_PROFILE_MODAL_EVENT))
}

export function onOpenProfileModal(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const listener = () => handler()
  window.addEventListener(OPEN_PROFILE_MODAL_EVENT, listener)
  return () => window.removeEventListener(OPEN_PROFILE_MODAL_EVENT, listener)
}
