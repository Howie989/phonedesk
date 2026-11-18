import { mountDeck } from './mount'

// Standalone page: the deck is always open. Other pages can load this bundle and call
// window.PhoneDesk.mountDeck(el, { baseUrl }) to embed it as an overlay.
;(window as unknown as { PhoneDesk: { mountDeck: typeof mountDeck } }).PhoneDesk = { mountDeck }
mountDeck(document.getElementById('root') as HTMLElement, { standalone: true })
