import { randomUnit } from '../core/RandomSource.ts'

export interface ToneOptions {
  /** Frequency value. */
  frequency: number
  /** End frequency value. */
  endFrequency?: number
  /** Duration value. */
  duration: number
  /** Volume value. */
  volume: number
  /** Type value. */
  type?: OscillatorType
}

type TonePreset = readonly [number, number, number, number, OscillatorType]

/** Synthesizes compact sound effects without external audio assets. */
export class SynthAudio {
  /** Stores the button. */
  private readonly button: HTMLButtonElement
  /** Stores the context. */
  private context: AudioContext | null = null
  /** Stores the master. */
  private master: GainNode | null = null
  /** Stores the noise buffer. */
  private noiseBuffer: AudioBuffer | null = null
  /** Stores the muted. */
  private muted = false
  /** Stores the last played. */
  private readonly lastPlayed = new Map<string, number>()

  /** Creates a new SynthAudio instance. */
  public constructor(button: HTMLButtonElement) {
    this.button = button
    button.addEventListener('click', () => {
      this.unlock()
      this.setMuted(!this.muted)
    })
    window.addEventListener('pointerdown', () => this.unlock(), { once: true, passive: true })
    window.addEventListener('keydown', () => this.unlock(), { once: true })
    this.updateButton()
  }

  /** Creates or resumes Web Audio after a user interaction. */
  public unlock(): void {
    if (!this.context) {
      this.context = new AudioContext()
      this.master = this.context.createGain()
      this.master.gain.value = this.muted ? 0 : 0.22
      this.master.connect(this.context.destination)
      this.createNoiseBuffer()
    }
    if (this.context.state === 'suspended') void this.context.resume()
  }

  /** Performs the create noise buffer operation. */
  private createNoiseBuffer(): void {
    if (!this.context) return
    const sampleRate = this.context.sampleRate
    const buffer = this.context.createBuffer(1, Math.floor(sampleRate * 0.65), sampleRate)
    const data = buffer.getChannelData(0)
    for (let index = 0; index < data.length; index += 1) data[index] = randomUnit() * 2 - 1
    this.noiseBuffer = buffer
  }

  /** Performs the set muted operation. */
  private setMuted(value: boolean): void {
    this.muted = value
    if (this.context && this.master) {
      this.master.gain.setTargetAtTime(value ? 0 : 0.22, this.context.currentTime, 0.02)
    }
    this.updateButton()
    if (!value) this.ui()
  }

  /** Performs the update button operation. */
  private updateButton(): void {
    this.button.textContent = this.muted ? '×' : '♪'
    this.button.setAttribute(
      'aria-label',
      this.muted ? 'Enable sound effects' : 'Mute sound effects',
    )
    this.button.setAttribute('aria-pressed', String(this.muted))
    this.button.classList.toggle('is-muted', this.muted)
  }

  /** Performs the can play operation. */
  private canPlay(key: string, minimumGapMs: number): boolean {
    if (this.muted || !this.context || !this.master) return false
    const now = performance.now()
    const previous = this.lastPlayed.get(key) ?? 0
    if (now - previous < minimumGapMs) return false
    this.lastPlayed.set(key, now)
    return true
  }

  /** Performs the tone operation. */
  private tone(options: ToneOptions): void {
    if (!this.context || !this.master || this.muted) return
    const now = this.context.currentTime
    const oscillator = this.context.createOscillator()
    const gain = this.context.createGain()
    oscillator.type = options.type ?? 'square'
    oscillator.frequency.setValueAtTime(Math.max(24, options.frequency), now)
    oscillator.frequency.exponentialRampToValueAtTime(
      Math.max(24, options.endFrequency ?? options.frequency),
      now + options.duration,
    )
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.linearRampToValueAtTime(options.volume, now + 0.004)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + options.duration)
    oscillator.connect(gain).connect(this.master)
    oscillator.start(now)
    oscillator.stop(now + options.duration + 0.02)
  }

  /** Performs the noise operation. */
  private noise(duration: number, volume: number, cutoff = 900): void {
    if (!this.context || !this.master || !this.noiseBuffer || this.muted) return
    const now = this.context.currentTime
    const source = this.context.createBufferSource()
    const filter = this.context.createBiquadFilter()
    const gain = this.context.createGain()
    source.buffer = this.noiseBuffer
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(cutoff, now)
    filter.frequency.exponentialRampToValueAtTime(Math.max(80, cutoff * 0.22), now + duration)
    gain.gain.setValueAtTime(volume, now)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration)
    source.connect(filter).connect(gain).connect(this.master)
    source.start(now, randomUnit() * 0.15, duration)
  }

  /** Performs the player shot operation. */
  public playerShot(index: number): void {
    if (!this.canPlay('playerShot', index === 1 ? 45 : 70)) return
    const presets: readonly TonePreset[] = [
      [190, 72, 0.13, 0.22, 'square'],
      [520, 270, 0.065, 0.09, 'square'],
      [260, 105, 0.11, 0.18, 'sawtooth'],
      [155, 48, 0.2, 0.2, 'sawtooth'],
      [110, 38, 0.26, 0.24, 'triangle'],
    ]
    const [frequency, endFrequency, duration, volume, type] = presets[index] ?? presets[0]
    this.tone({ frequency, endFrequency, duration, volume, type })
    if (index >= 2) this.noise(duration * 0.75, volume * 0.32, 1500)
  }

  /** Performs the enemy shot operation. */
  public enemyShot(distance: number, weapon = 'single'): void {
    let gap = 55
    if (weapon === 'pulse') gap = 70
    else if (weapon === 'mortar') gap = 180
    if (!this.canPlay(`enemyShot:${weapon}`, gap)) return
    const attenuation = Math.max(0.08, Math.min(0.7, 1 - distance / 1150))
    const options = SynthAudio.getEnemyTone(weapon, attenuation)
    this.tone(options)
    if (weapon === 'mortar') this.noise(0.18, 0.08 * attenuation, 620)
  }

  /** Performs the get enemy tone operation. */
  private static getEnemyTone(weapon: string, attenuation: number): ToneOptions {
    if (weapon === 'pulse')
      return { frequency: 610, endFrequency: 330, duration: 0.055, volume: 0.075 * attenuation }
    if (weapon === 'mortar')
      return {
        frequency: 92,
        endFrequency: 34,
        duration: 0.24,
        volume: 0.16 * attenuation,
        type: 'triangle',
      }
    if (weapon === 'sniper')
      return {
        frequency: 210,
        endFrequency: 74,
        duration: 0.09,
        volume: 0.13 * attenuation,
        type: 'sawtooth',
      }
    if (weapon === 'rocket')
      return {
        frequency: 118,
        endFrequency: 44,
        duration: 0.16,
        volume: 0.12 * attenuation,
        type: 'sawtooth',
      }
    return { frequency: 125, endFrequency: 68, duration: 0.1, volume: 0.1 * attenuation }
  }

  /** Performs the impact operation. */
  public impact(): void {
    if (this.canPlay('impact', 32)) this.noise(0.055, 0.075, 1900)
  }

  /** Performs the hit operation. */
  public hit(): void {
    if (this.canPlay('hit', 45))
      this.tone({ frequency: 240, endFrequency: 95, duration: 0.08, volume: 0.11 })
  }

  /** Performs the explosion operation. */
  public explosion(strength = 1): void {
    if (!this.canPlay('explosion', 55)) return
    this.noise(0.28 + strength * 0.08, 0.2 * strength, 1000)
    this.tone({
      frequency: 88,
      endFrequency: 30,
      duration: 0.3,
      volume: 0.16 * strength,
      type: 'sine',
    })
  }

  /** Performs the pickup operation. */
  public pickup(): void {
    if (!this.canPlay('pickup', 80)) return
    this.tone({ frequency: 440, endFrequency: 880, duration: 0.16, volume: 0.14, type: 'sine' })
    window.setTimeout(
      () =>
        this.tone({
          frequency: 660,
          endFrequency: 1180,
          duration: 0.12,
          volume: 0.1,
          type: 'sine',
        }),
      70,
    )
  }

  /** Performs the damage operation. */
  public damage(): void {
    if (!this.canPlay('damage', 120)) return
    this.noise(0.12, 0.14, 650)
    this.tone({ frequency: 92, endFrequency: 54, duration: 0.15, volume: 0.14, type: 'sawtooth' })
  }

  /** Performs the respawn operation. */
  public respawn(): void {
    if (this.canPlay('respawn', 250))
      this.tone({ frequency: 180, endFrequency: 720, duration: 0.34, volume: 0.13, type: 'sine' })
  }

  /** Performs the level clear operation. */
  public levelClear(): void {
    if (!this.canPlay('levelClear', 400)) return
    const frequencies = [392, 523, 784]
    const endFrequencies = [523, 659, 1046]
    ;[0, 90, 180].forEach((delay, index) => {
      window.setTimeout(
        () =>
          this.tone({
            frequency: frequencies[index],
            endFrequency: endFrequencies[index],
            duration: 0.18,
            volume: 0.12,
            type: 'sine',
          }),
        delay,
      )
    })
  }

  /** Performs the ui operation. */
  public ui(): void {
    if (this.canPlay('ui', 70))
      this.tone({ frequency: 310, endFrequency: 410, duration: 0.055, volume: 0.07, type: 'sine' })
  }
}
