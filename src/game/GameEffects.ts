import { ObjectPool } from '../core/ObjectPool.ts'
import { randomUnit } from '../core/RandomSource.ts'
import { TAU } from './config.ts'
import type { Particle, Rectangle, ScorchMark, TankBody, Theme, TrackMark } from './types.ts'

/** Dependencies used to adapt effect density and colors to current game state. */
export interface EffectsContext {
  /** Returns the adaptive effect-quality multiplier. */
  getEffectQuality(): number
  /** Returns the active arena theme. */
  getTheme(): Theme
  /** Raises the impact flash to at least the supplied opacity. */
  raiseFlash(alpha: number): void
}

/** Values used to initialize a pooled visual particle. */
interface ParticleOptions {
  /** World-space horizontal position. */
  x: number
  /** World-space vertical position. */
  y: number
  /** Horizontal velocity in world units per second. */
  velocityX: number
  /** Vertical velocity in world units per second. */
  velocityY: number
  /** Visible lifetime in seconds. */
  life: number
  /** Base rendered radius or half-size. */
  size: number
  /** CSS color used to draw the particle. */
  color: string
  /** Per-frame velocity retention at 60 Hz. */
  drag?: number
  /** Renderer shape selector. */
  kind?: string
  /** Initial rotation in radians. */
  rotation?: number
  /** Angular velocity in radians per second. */
  spin?: number
}

/** Owns pooled particles, tread marks, scorch marks, and effect emitters. */
export class GameEffects {
  /** Active pooled particles. */
  public readonly particles: Particle[] = []
  /** Temporary tank tread marks. */
  public readonly trackMarks: TrackMark[] = []
  /** Persistent explosion scorch marks. */
  public readonly scorchMarks: ScorchMark[] = []
  /** Pool that recycles short-lived particle objects. */
  private readonly particlePool = new ObjectPool<Particle>(() => ({
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    life: 0,
    maxLife: 0,
    size: 1,
    color: '#fff',
    drag: 0.96,
    kind: 'spark',
    rotation: 0,
    spin: 0,
  }))
  /** Current game-state callbacks needed by effect emitters. */
  private readonly context: EffectsContext

  /** Creates an effect manager backed by current game-state callbacks. */
  public constructor(context: EffectsContext) {
    this.context = context
  }

  /** Releases pooled particles and clears all surface marks for a new level. */
  public reset(): void {
    while (this.particles.length > 0) {
      const particle = this.particles.pop()
      if (particle) this.particlePool.release(particle)
    }
    this.trackMarks.length = 0
    this.scorchMarks.length = 0
  }

  /** Ages tread marks while retaining a softer persistent scorch layer. */
  public updateSurfaceEffects(deltaSeconds: number): void {
    for (let index = this.trackMarks.length - 1; index >= 0; index -= 1) {
      this.trackMarks[index].life -= deltaSeconds
      if (this.trackMarks[index].life <= 0) this.trackMarks.splice(index, 1)
    }
  }

  /** Emits two tread marks behind a moving tank. */
  public spawnTrackMarks(tank: TankBody, color = 'rgba(0,0,0,0.32)'): void {
    const backwardX = Math.cos(tank.bodyAngle) * tank.radius * 0.68
    const backwardY = Math.sin(tank.bodyAngle) * tank.radius * 0.68
    const sideX = Math.cos(tank.bodyAngle + Math.PI * 0.5) * tank.radius * 0.56
    const sideY = Math.sin(tank.bodyAngle + Math.PI * 0.5) * tank.radius * 0.56
    const x = tank.x - backwardX
    const y = tank.y - backwardY
    this.trackMarks.push(
      { x: x + sideX, y: y + sideY, angle: tank.bodyAngle, life: 5.5, maxLife: 5.5, color },
      { x: x - sideX, y: y - sideY, angle: tank.bodyAngle, life: 5.5, maxLife: 5.5, color },
    )
    if (this.trackMarks.length > 220) this.trackMarks.splice(0, this.trackMarks.length - 220)
  }

  /** Integrates active particles and returns expired objects to the pool. */
  public updateParticles(deltaSeconds: number): void {
    for (let index = this.particles.length - 1; index >= 0; index -= 1) {
      const particle = this.particles[index]
      particle.life -= deltaSeconds
      if (particle.life <= 0) {
        const last = this.particles.pop()
        if (last && index < this.particles.length) this.particles[index] = last
        this.particlePool.release(particle)
        continue
      }
      particle.x += particle.vx * deltaSeconds
      particle.y += particle.vy * deltaSeconds
      particle.rotation += particle.spin * deltaSeconds
      const drag = Math.pow(particle.drag, deltaSeconds * 60)
      particle.vx *= drag
      particle.vy *= drag
    }
  }

  /** Acquires and configures one visual particle within the adaptive cap. */
  public spawnParticle(options: ParticleOptions): void {
    const particleCap = Math.round(720 * this.context.getEffectQuality())
    if (this.particles.length > particleCap) return
    const particle = this.particlePool.acquire()
    const { x, y, velocityX, velocityY, life, size, color } = options
    Object.assign(particle, {
      x,
      y,
      vx: velocityX,
      vy: velocityY,
      life,
      maxLife: life,
      size,
      color,
      drag: options.drag ?? 0.95,
      kind: options.kind ?? 'spark',
      rotation: options.rotation ?? 0,
      spin: options.spin ?? 0,
    })
    this.particles.push(particle)
  }

  /** Emits a directional muzzle flash in front of a turret. */
  public spawnMuzzleFlash(x: number, y: number, angle: number, color: string, count: number): void {
    const muzzleX = x + Math.cos(angle) * 35
    const muzzleY = y + Math.sin(angle) * 35
    for (let index = 0; index < count; index += 1) {
      const particleAngle = angle + (randomUnit() - 0.5) * 0.55
      const speed = 55 + randomUnit() * 150
      this.spawnParticle({
        x: muzzleX,
        y: muzzleY,
        velocityX: Math.cos(particleAngle) * speed,
        velocityY: Math.sin(particleAngle) * speed,
        life: 0.12 + randomUnit() * 0.18,
        size: 2 + randomUnit() * 4,
        color,
        drag: 0.88,
      })
    }
  }

  /** Emits a compact radial impact burst. */
  public spawnImpact(x: number, y: number, color: string, count: number): void {
    for (let index = 0; index < count; index += 1) {
      const angle = randomUnit() * TAU
      const speed = 30 + randomUnit() * 190
      this.spawnParticle({
        x,
        y,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed,
        life: 0.18 + randomUnit() * 0.35,
        size: 1.5 + randomUnit() * 4,
        color,
        drag: 0.9,
      })
    }
  }

  /** Emits an explosion and records scorch/flash effects for larger blasts. */
  public spawnExplosion(x: number, y: number, color: string, count: number): void {
    if (count >= 15) {
      this.scorchMarks.push({
        x,
        y,
        radius: 18 + randomUnit() * 24,
        alpha: 0.26 + randomUnit() * 0.16,
      })
      if (this.scorchMarks.length > 90) this.scorchMarks.shift()
      this.context.raiseFlash(Math.min(0.3, count * 0.007))
    }
    for (let index = 0; index < count; index += 1) {
      const angle = randomUnit() * TAU
      const speed = 40 + randomUnit() * 280
      const particleColor = index % 4 === 0 ? '#ffffff' : color
      const debris = count >= 18 && index % 5 === 0
      this.spawnParticle({
        x,
        y,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed,
        life: 0.3 + randomUnit() * 0.65,
        size: 2 + randomUnit() * 7,
        color: particleColor,
        drag: 0.94,
        kind: debris ? 'debris' : 'spark',
        rotation: randomUnit() * TAU,
        spin: (randomUnit() - 0.5) * 14,
      })
    }
  }

  /** Emits rectangular chunks when a destructible wall collapses. */
  public spawnWallDebris(rectangle: Rectangle): void {
    const centerX = rectangle.x + rectangle.w * 0.5
    const centerY = rectangle.y + rectangle.h * 0.5
    const count = Math.min(34, 10 + Math.floor((rectangle.w + rectangle.h) / 24))
    for (let index = 0; index < count; index += 1) {
      const angle = randomUnit() * TAU
      const speed = 45 + randomUnit() * 190
      this.spawnParticle({
        x: centerX + (randomUnit() - 0.5) * rectangle.w * 0.7,
        y: centerY + (randomUnit() - 0.5) * rectangle.h * 0.7,
        velocityX: Math.cos(angle) * speed,
        velocityY: Math.sin(angle) * speed,
        life: 0.5 + randomUnit() * 0.8,
        size: 4 + randomUnit() * 7,
        color: this.context.getTheme().top,
        drag: 0.92,
        kind: 'debris',
        rotation: randomUnit() * TAU,
        spin: (randomUnit() - 0.5) * 12,
      })
    }
  }
}
