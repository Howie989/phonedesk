/**
 * Platform of the agent the deck talks to ("darwin" | "win32" | "linux"), taken from the `hello` message; macOS until told otherwise.
 * Used for keyboard glyphs and the few labels that are platform specific.
 */
let cur = 'darwin'

export const setPlatform = (p: unknown) => {
  if (typeof p === 'string' && p) cur = p
}
export const getPlatform = (): string => cur
export const isMac = (): boolean => cur === 'darwin'

const MAC: { [k: string]: string } = { cmd: '⌘', command: '⌘', meta: '⌘', ctrl: '⌃', control: '⌃', option: '⌥', alt: '⌥', shift: '⇧', enter: '↩', return: '↩', esc: '⎋', escape: '⎋', delete: '⌫', backspace: '⌫', tab: '⇥', space: 'Space' }
const WIN: { [k: string]: string } = { cmd: 'Ctrl', command: 'Ctrl', meta: 'Win', ctrl: 'Ctrl', control: 'Ctrl', option: 'Alt', alt: 'Alt', shift: 'Shift', enter: 'Enter', return: 'Enter', esc: 'Esc', escape: 'Esc', delete: 'Del', backspace: 'Backspace', tab: 'Tab', space: 'Space' }

/** "cmd+shift+4" -> "⌘⇧4" on a Mac, "Ctrl+Shift+4" on Windows (layouts keep one notation: cmd maps to ctrl on Windows, option to alt). */
export function formatHotkey(keys: string, platform?: string): string {
  const mac = (platform || cur) === 'darwin'
  const map = mac ? MAC : WIN
  const parts = keys.split('+').map((k) => {
    const x = k.trim()
    return map[x.toLowerCase()] || (x.length === 1 ? x.toUpperCase() : x.charAt(0).toUpperCase() + x.slice(1))
  })
  return parts.join(mac ? '' : '+')
}
