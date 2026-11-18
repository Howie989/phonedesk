/**
 * Soundboard player for sounds that play on the phone (action.on 'phone' | 'both'). One HTMLAudioElement per sound id.
 * iOS only lets audio start from a tap: unlock(id) is called from the press handler (a silent clip starts on the element inside the
 * gesture), and the later {type:'play-sound'} message from the agent reuses that same unlocked element.
 * Modes: restart (default) starts over, toggle stops when already playing, overlap plays a new copy on top.
 */

export interface PlayMsg {
  id: string
  url: string
  volume?: number
  mode?: 'overlap' | 'restart' | 'toggle'
}

/** 0.1 s of silence (8 kHz mono 8-bit PCM), used to unlock an element inside a tap. */
const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA='

export const soundKey = (v: string): string => String(v || '').replace(/^snd:/, '')

interface Slot {
  el: HTMLAudioElement
  extra: HTMLAudioElement[]
}

export class Soundboard {
  private slots: { [id: string]: Slot } = {}
  /** ids playing on this phone: id -> {startedAt, durMs?} */
  playing: { [id: string]: { at: number; durMs?: number } } = {}
  constructor(private onChange: () => void, private token: () => string | null) {}

  private slot(id: string): Slot {
    if (!this.slots[id]) this.slots[id] = { el: new Audio(), extra: [] }
    return this.slots[id]
  }

  /** Call inside the tap handler. */
  unlock(id: string) {
    try {
      const s = this.slot(soundKey(id))
      if (s.el.paused && !s.el.src) {
        s.el.src = SILENT
        const p = s.el.play()
        if (p && p.catch) p.catch(() => undefined)
      }
    } catch (e) {
      /* audio is optional */
    }
  }

  private withToken(url: string): string {
    const t = this.token()
    if (!t || url.indexOf('token=') >= 0) return url
    return url + (url.indexOf('?') >= 0 ? '&' : '?') + 'token=' + encodeURIComponent(t)
  }

  private mark(id: string, el: HTMLAudioElement) {
    const done = () => {
      // still playing through another copy?
      const s = this.slots[id]
      const busy = !!s && [s.el].concat(s.extra).some((a) => !a.paused && !a.ended)
      if (!busy) delete this.playing[id]
      this.onChange()
    }
    el.onended = done
    el.onpause = done
    el.onplaying = () => {
      this.playing[id] = { at: Date.now(), durMs: isFinite(el.duration) && el.duration > 0 ? Math.round(el.duration * 1000) : undefined }
      this.onChange()
    }
    el.onloadedmetadata = () => {
      if (this.playing[id] && isFinite(el.duration)) {
        this.playing[id].durMs = Math.round(el.duration * 1000)
        this.onChange()
      }
    }
  }

  play(msg: PlayMsg) {
    const id = soundKey(msg.id)
    const s = this.slot(id)
    const vol = Math.min(1, Math.max(0, (msg.volume === undefined ? 100 : msg.volume) / 100))
    const url = this.withToken(msg.url)
    const mode = msg.mode || 'restart'
    const running = (a: HTMLAudioElement) => !a.paused && !a.ended && a.src.indexOf('data:audio/wav') !== 0
    let el = s.el
    try {
      if (mode === 'toggle' && running(el)) {
        el.pause()
        el.currentTime = 0
        return
      }
      if (mode === 'overlap' && running(el)) {
        el = new Audio()
        s.extra.push(el)
      }
      el.volume = vol
      if (el.src !== url && el.getAttribute('data-url') !== url) {
        el.src = url
        el.setAttribute('data-url', url)
      } else if (mode !== 'overlap') {
        el.currentTime = 0
      }
      this.mark(id, el)
      const p = el.play()
      if (p && p.catch) p.catch(() => undefined)
    } catch (e) {
      /* ignore */
    }
  }

  stopAll() {
    Object.keys(this.slots).forEach((id) => {
      const s = this.slots[id]
      ;[s.el].concat(s.extra).forEach((a) => {
        try {
          a.pause()
          a.currentTime = 0
        } catch (e) {
          /* ignore */
        }
      })
      s.extra = []
    })
    this.playing = {}
    this.onChange()
  }
}
