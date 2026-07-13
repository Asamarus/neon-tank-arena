import type { InputManager, TouchStick } from '../input/InputManager.ts'
import { randomUnit } from '../core/RandomSource.ts'
import {
  BONUS_TYPES,
  ENEMY_TYPES,
  IS_COARSE_POINTER,
  PALETTE,
  TAU,
  UPGRADE_CRATE_COLOR,
  WEAPONS,
} from './config.ts'
import { clamp, lerp } from './geometry.ts'
import type {
  BonusBox,
  Bullet,
  EffectiveWeapon,
  Enemy,
  EnemyMine,
  Hazard,
  Obstacle,
  Particle,
  Player,
  PlayerTrap,
  Rectangle,
  ScorchMark,
  Theme,
  TrackMark,
  UpgradeBox,
} from './types.ts'

/** Values required to render a tank body and turret. */
interface TankRenderOptions {
  /** World-space horizontal center. */
  x: number
  /** World-space vertical center. */
  y: number
  /** Tank body radius. */
  radius: number
  /** Hull rotation in radians. */
  bodyAngle: number
  /** Turret rotation in radians. */
  turretAngle: number
  /** Primary armor color. */
  color: string
  /** Shadow and trim color. */
  dark: string
  /** Remaining health ratio. */
  healthRatio: number
  /** Whether is player. */
  isPlayer: boolean
  /** Current barrel recoil offset. */
  recoil?: number
}

/** State and queries required to draw one game frame. */
export interface GameRenderContext {
  /** Current CSS-pixel viewport width. */
  viewWidth: number
  /** Current CSS-pixel viewport height. */
  viewHeight: number
  /** Canvas device-pixel scale. */
  dpr: number
  /** Arena width in world units. */
  worldWidth: number
  /** Arena height in world units. */
  worldHeight: number
  /** Left edge of the camera in world units. */
  cameraX: number
  /** Top edge of the camera in world units. */
  cameraY: number
  /** Whether running. */
  running: boolean
  /** Whether paused. */
  paused: boolean
  /** Current camera shake amplitude. */
  screenShake: number
  /** Current full-screen impact flash opacity. */
  flashAlpha: number
  /** Active arena theme. */
  theme: Theme
  /** Cached theme hue used by effects. */
  themeHue: number
  /** Arena collision walls. */
  obstacles: Obstacle[]
  /** Living enemy tanks. */
  enemies: Enemy[]
  /** Collectable bonus crates. */
  bonusBoxes: BonusBox[]
  /** Collectable permanent-upgrade crates. */
  upgradeBoxes: UpgradeBox[]
  /** Environmental hazard zones. */
  hazards: Hazard[]
  /** Player-deployed traps. */
  playerTraps: PlayerTrap[]
  /** Hostile proximity mines. */
  enemyMines: EnemyMine[]
  /** Active projectiles. */
  bullets: Bullet[]
  /** Active visual particles. */
  particles: Particle[]
  /** Temporary tank tread marks. */
  trackMarks: TrackMark[]
  /** Persistent explosion scorch marks. */
  scorchMarks: ScorchMark[]
  /** Current consecutive-hit count. */
  comboCount: number
  /** Remaining combo lifetime. */
  comboTimer: number
  /** Score multiplier produced by the combo. */
  comboMultiplier: number
  /** Whether boss active. */
  bossActive: boolean
  /** Display name of the current boss. */
  bossName: string
  /** Cached repeating arena-floor texture. */
  floorPattern: CanvasPattern | null
  /** Smoothed frame duration used for adaptive effects. */
  frameAverage: number
  /** Adaptive visual-effect quality multiplier. */
  effectQuality: number
  /** Timestamp of the previous rendered frame. */
  lastRenderTime?: number
  /** Unified keyboard, pointer, and touch input state. */
  input: InputManager
  /** Player tank state. */
  player: Player
  /** Returns a weapon after permanent upgrades are applied. */
  getEffectiveWeapon(index: number): EffectiveWeapon
  /** Tests whether a circle overlaps the visible camera area. */
  isCircleVisible(x: number, y: number, radius?: number, margin?: number): boolean
  /** Tests whether a rectangle overlaps the visible camera area. */
  isRectVisible(rect: Rectangle, margin?: number): boolean
}

/** Renders the arena from a read-only view of current game state. */
export class GameRenderer {
  /** Shared game state used while rendering a frame. */
  private readonly game: GameRenderContext
  /** High-DPI canvas drawing context. */
  private readonly context: CanvasRenderingContext2D

  /** Creates a renderer for one game and canvas context. */
  public constructor(game: GameRenderContext, context: CanvasRenderingContext2D) {
    this.game = game
    this.context = context
  }

  /** Performs the render operation. */
  public render(): void {
    const now = performance.now()
    if (this.game.lastRenderTime) {
      const frameMs = Math.min(80, now - this.game.lastRenderTime)
      this.game.frameAverage = lerp(this.game.frameAverage, frameMs, 0.045)
      if (this.game.frameAverage > 27) this.game.effectQuality = 0.48
      else if (this.game.frameAverage > 20) this.game.effectQuality = 0.72
      else this.game.effectQuality = 1
    }
    this.game.lastRenderTime = now
    this.context.setTransform(this.game.dpr, 0, 0, this.game.dpr, 0, 0)
    this.context.fillStyle = PALETTE.background
    this.context.fillRect(0, 0, this.game.viewWidth, this.game.viewHeight)

    const shakeX = this.game.screenShake > 0 ? (randomUnit() - 0.5) * this.game.screenShake : 0
    const shakeY = this.game.screenShake > 0 ? (randomUnit() - 0.5) * this.game.screenShake : 0
    this.context.save()
    this.context.translate(-this.game.cameraX + shakeX, -this.game.cameraY + shakeY)
    this.drawArena()
    this.drawHazards()
    this.drawSurfaceEffects()
    this.drawObstacles()
    this.drawBonusBoxes()
    this.drawUpgradeBoxes()
    this.drawTraps()
    this.drawParticles()
    this.drawBullets()
    this.drawEnemies()
    this.drawPlayer()
    this.context.restore()

    this.drawCrosshair()
    this.drawTouchControls()
    if (this.game.comboCount > 1 && this.game.comboTimer > 0) this.drawComboIndicator()
    if (this.game.bossActive) this.drawBossBar()
    if (this.game.flashAlpha > 0) {
      this.context.fillStyle = `rgba(255,255,255,${this.game.flashAlpha})`
      this.context.fillRect(0, 0, this.game.viewWidth, this.game.viewHeight)
    }
    if (this.game.paused) {
      this.context.fillStyle = 'rgba(2, 6, 10, 0.38)'
      this.context.fillRect(0, 0, this.game.viewWidth, this.game.viewHeight)
    }
  }

  /** Performs the draw arena operation. */
  private drawArena(): void {
    const left = Math.max(0, this.game.cameraX - 4)
    const top = Math.max(0, this.game.cameraY - 4)
    const width = Math.min(this.game.worldWidth - left, this.game.viewWidth + 8)
    const height = Math.min(this.game.worldHeight - top, this.game.viewHeight + 8)
    this.context.fillStyle = this.game.floorPattern || this.game.theme.floor
    this.context.fillRect(left, top, width, height)
    if (this.game.effectQuality > 0.55) this.drawThemeDetails(left, top, left + width, top + height)
    this.context.strokeStyle = `${this.game.theme.accent}80`
    this.context.lineWidth = 4
    this.context.strokeRect(2, 2, this.game.worldWidth - 4, this.game.worldHeight - 4)
  }

  /** Render theme hazards beneath tanks with simple animated telegraphs. */
  private drawHazards(): void {
    const time = performance.now() * 0.003
    for (const hazard of this.game.hazards) {
      if (!this.game.isRectVisible(hazard, 40)) continue
      this.drawHazard(hazard, time)
    }
  }

  /** Draws one animated arena hazard. */
  private drawHazard(hazard: Hazard, time: number): void {
    this.context.save()
    this.setHazardColors(hazard, time)
    this.context.lineWidth = 2
    this.context.setLineDash(hazard.kind === 'electric' ? [10, 7] : [])
    if (hazard.circular) {
      this.context.beginPath()
      this.context.arc(hazard.x + hazard.w * 0.5, hazard.y + hazard.h * 0.5, hazard.w * 0.5, 0, TAU)
    } else {
      roundRectPath(this.context, hazard.x, hazard.y, hazard.w, hazard.h, 14)
    }
    this.context.fill()
    this.context.stroke()
    this.context.setLineDash([])
    if (hazard.kind === 'conveyor' || hazard.kind === 'wind') this.drawHazardDirection(hazard)
    this.context.restore()
  }

  /** Selects fill and outline colors for one hazard kind. */
  private setHazardColors(hazard: Hazard, time: number): void {
    if (hazard.kind === 'lava') {
      const pulse = 0.55 + Math.sin(time + hazard.phase) * 0.18
      this.context.fillStyle = `rgba(255,74,35,${0.18 + pulse * 0.16})`
      this.context.strokeStyle = 'rgba(255,170,60,0.68)'
    } else if (hazard.kind === 'electric') {
      const powered = Math.sin(performance.now() * 0.004 + hazard.phase) > 0.15
      this.context.fillStyle = powered ? 'rgba(151,123,255,0.22)' : 'rgba(100,92,170,0.08)'
      this.context.strokeStyle = powered ? 'rgba(206,190,255,0.82)' : 'rgba(160,145,220,0.25)'
    } else if (hazard.kind === 'ice') {
      this.context.fillStyle = 'rgba(155,238,255,0.12)'
      this.context.strokeStyle = 'rgba(189,248,255,0.45)'
    } else if (hazard.kind === 'conveyor') {
      this.context.fillStyle = 'rgba(255,165,71,0.10)'
      this.context.strokeStyle = 'rgba(255,186,96,0.48)'
    } else if (hazard.kind === 'sludge') {
      this.context.fillStyle = 'rgba(71,179,89,0.16)'
      this.context.strokeStyle = 'rgba(124,234,139,0.42)'
    } else {
      this.context.fillStyle = 'rgba(255,207,112,0.08)'
      this.context.strokeStyle = 'rgba(255,220,145,0.35)'
    }
  }

  /** Draws the force direction arrow for wind and conveyor hazards. */
  private drawHazardDirection(hazard: Hazard): void {
    const centerX = hazard.x + hazard.w * 0.5
    const centerY = hazard.y + hazard.h * 0.5
    const deltaX = Math.cos(hazard.direction) * 34
    const deltaY = Math.sin(hazard.direction) * 34
    this.context.strokeStyle = this.game.theme.accent
    this.context.globalAlpha = 0.5
    this.context.beginPath()
    this.context.moveTo(centerX - deltaX, centerY - deltaY)
    this.context.lineTo(centerX + deltaX, centerY + deltaY)
    this.context.lineTo(
      centerX + deltaX - Math.cos(hazard.direction - 0.65) * 14,
      centerY + deltaY - Math.sin(hazard.direction - 0.65) * 14,
    )
    this.context.moveTo(centerX + deltaX, centerY + deltaY)
    this.context.lineTo(
      centerX + deltaX - Math.cos(hazard.direction + 0.65) * 14,
      centerY + deltaY - Math.sin(hazard.direction + 0.65) * 14,
    )
    this.context.stroke()
  }

  /** Draw lightweight, deterministic decorations unique to each arena theme. */
  private drawThemeDetails(startX: number, startY: number, endX: number, endY: number): void {
    const step = this.game.theme.id === 'space' ? 96 : 144
    const sx = Math.floor(startX / step) * step
    const sy = Math.floor(startY / step) * step
    this.context.save()
    this.context.lineWidth = 1.2
    for (let x = sx; x <= endX; x += step) {
      for (let y = sy; y <= endY; y += step) {
        const hash = Math.abs(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1
        const ox = hash * step * 0.62
        const oy = ((hash * 7.13) % 1) * step * 0.62
        const px = x + 18 + ox
        const py = y + 18 + oy
        this.drawThemeDetail(px, py, hash)
      }
    }
    this.context.restore()
  }

  /** Draws one deterministic floor decoration for the active theme. */
  private drawThemeDetail(x: number, y: number, hash: number): void {
    if (this.game.theme.id === 'desert') {
      this.context.strokeStyle = 'rgba(255,211,130,0.09)'
      this.context.beginPath()
      this.context.arc(x, y, 18 + hash * 20, 0.15, Math.PI * 0.78)
      this.context.stroke()
    } else if (this.game.theme.id === 'ice') {
      this.context.strokeStyle = 'rgba(170,244,255,0.09)'
      this.context.beginPath()
      this.context.moveTo(x - 15, y - 8)
      this.context.lineTo(x, y + 5)
      this.context.lineTo(x - 7, y + 22)
      this.context.stroke()
    } else if (this.game.theme.id === 'factory') {
      this.context.fillStyle = 'rgba(255,174,76,0.06)'
      this.context.save()
      this.context.translate(x, y)
      this.context.rotate(-0.65)
      for (let index = -2; index <= 2; index += 1) this.context.fillRect(index * 12, -4, 6, 26)
      this.context.restore()
    } else if (this.game.theme.id === 'space') {
      this.context.fillStyle = `rgba(222,211,255,${0.14 + hash * 0.18})`
      this.context.beginPath()
      this.context.arc(x, y, 0.8 + hash * 1.6, 0, TAU)
      this.context.fill()
    } else if (this.game.theme.id === 'jungle') {
      this.context.fillStyle = 'rgba(78,191,98,0.075)'
      this.context.beginPath()
      this.context.arc(x, y, 11 + hash * 16, 0, TAU)
      this.context.arc(x + 18, y + 8, 7 + hash * 10, 0, TAU)
      this.context.fill()
    } else if (this.game.theme.id === 'volcanic') {
      this.context.strokeStyle = 'rgba(255,91,60,0.12)'
      this.context.beginPath()
      this.context.moveTo(x - 22, y - 8)
      this.context.lineTo(x - 5, y + 2)
      this.context.lineTo(x + 4, y - 8)
      this.context.lineTo(x + 24, y + 13)
      this.context.stroke()
    }
  }

  /** Draw fading tread marks and persistent blast scars beneath gameplay. */
  private drawSurfaceEffects(): void {
    this.context.save()
    for (const mark of this.game.scorchMarks) {
      if (!this.game.isCircleVisible(mark.x, mark.y, mark.radius, 25)) continue
      if (this.game.effectQuality > 0.65) {
        const gradient = this.context.createRadialGradient(
          mark.x,
          mark.y,
          2,
          mark.x,
          mark.y,
          mark.radius,
        )
        gradient.addColorStop(0, `rgba(0,0,0,${mark.alpha})`)
        gradient.addColorStop(0.55, `rgba(0,0,0,${mark.alpha * 0.72})`)
        gradient.addColorStop(1, 'rgba(0,0,0,0)')
        this.context.fillStyle = gradient
      } else {
        this.context.fillStyle = `rgba(0,0,0,${mark.alpha * 0.45})`
      }
      this.context.beginPath()
      this.context.arc(mark.x, mark.y, mark.radius, 0, TAU)
      this.context.fill()
    }
    for (const mark of this.game.trackMarks) {
      if (!this.game.isCircleVisible(mark.x, mark.y, 12, 20)) continue
      this.context.globalAlpha = clamp(mark.life / mark.maxLife, 0, 1) * 0.8
      this.context.fillStyle = mark.color
      this.context.save()
      this.context.translate(mark.x, mark.y)
      this.context.rotate(mark.angle)
      roundRectPath(this.context, -6, -2.1, 12, 4.2, 1.5)
      this.context.fill()
      this.context.restore()
    }
    this.context.restore()
    this.context.globalAlpha = 1
  }

  /** Performs the draw obstacles operation. */
  private drawObstacles(): void {
    const margin = 80
    const left = this.game.cameraX - margin
    const top = this.game.cameraY - margin
    const right = this.game.cameraX + this.game.viewWidth + margin
    const bottom = this.game.cameraY + this.game.viewHeight + margin

    for (const rect of this.game.obstacles) {
      if (rect.x > right || rect.y > bottom || rect.x + rect.w < left || rect.y + rect.h < top)
        continue
      this.context.fillStyle = PALETTE.shadow
      roundRectPath(this.context, rect.x + 10, rect.y + 12, rect.w, rect.h, 8)
      this.context.fill()
      this.context.fillStyle = this.game.theme.edge
      roundRectPath(this.context, rect.x, rect.y + 7, rect.w, rect.h, 8)
      this.context.fill()
      this.context.fillStyle = this.game.theme.wall
      roundRectPath(this.context, rect.x, rect.y, rect.w, rect.h, 8)
      this.context.fill()
      this.context.fillStyle = this.game.theme.top
      roundRectPath(this.context, rect.x + 3, rect.y + 3, rect.w - 6, Math.max(8, rect.h * 0.32), 5)
      this.context.fill()
      this.context.strokeStyle = `hsla(${this.game.themeHue} 68% 67% / 0.12)`
      this.context.lineWidth = 1
      roundRectPath(this.context, rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1, 8)
      this.context.stroke()

      if (rect.destructible) {
        const damage = 1 - rect.hp / rect.maxHp
        this.context.strokeStyle = `rgba(255,255,255,${0.12 + damage * 0.34})`
        this.context.lineWidth = 1 + damage * 1.4
        this.context.beginPath()
        this.context.moveTo(rect.x + rect.w * 0.24, rect.y + rect.h * 0.16)
        this.context.lineTo(rect.x + rect.w * (0.43 + damage * 0.08), rect.y + rect.h * 0.52)
        this.context.lineTo(rect.x + rect.w * 0.34, rect.y + rect.h * 0.82)
        if (damage > 0.35) {
          this.context.moveTo(rect.x + rect.w * 0.72, rect.y + rect.h * 0.18)
          this.context.lineTo(rect.x + rect.w * 0.58, rect.y + rect.h * 0.48)
          this.context.lineTo(rect.x + rect.w * 0.76, rect.y + rect.h * 0.74)
        }
        this.context.stroke()
        this.context.fillStyle = `${this.game.theme.accent}${damage > 0.6 ? '33' : '18'}`
        this.context.fillRect(
          rect.x + 5,
          rect.y + rect.h - 7,
          (rect.w - 10) * clamp(rect.hp / rect.maxHp, 0, 1),
          2,
        )
      }
    }
  }

  /** Performs the draw bonus boxes operation. */
  private drawBonusBoxes(): void {
    const margin = 60
    const left = this.game.cameraX - margin
    const top = this.game.cameraY - margin
    const right = this.game.cameraX + this.game.viewWidth + margin
    const bottom = this.game.cameraY + this.game.viewHeight + margin
    const time = performance.now() * 0.003

    for (const box of this.game.bonusBoxes) {
      if (box.x < left || box.y < top || box.x > right || box.y > bottom) continue
      const bonus = BONUS_TYPES[box.bonusIndex]
      const pulse = 1 + Math.sin(time * 2.2 + box.phase) * 0.07

      this.context.save()
      this.context.translate(box.x, box.y)
      this.context.scale(pulse, pulse)
      this.context.fillStyle = PALETTE.shadow
      roundRectPath(this.context, -box.size + 6, -box.size + 9, box.size * 2, box.size * 2, 7)
      this.context.fill()

      this.context.rotate(Math.sin(time + box.phase) * 0.055)
      this.context.shadowBlur = 18
      this.context.shadowColor = bonus.color
      this.context.fillStyle = '#102836'
      roundRectPath(this.context, -box.size, -box.size, box.size * 2, box.size * 2, 7)
      this.context.fill()
      this.context.shadowBlur = 0

      this.context.strokeStyle = bonus.color
      this.context.lineWidth = 2
      roundRectPath(
        this.context,
        -box.size + 1,
        -box.size + 1,
        box.size * 2 - 2,
        box.size * 2 - 2,
        7,
      )
      this.context.stroke()
      this.context.fillStyle = `hsla(${this.game.themeHue} 65% 48% / 0.22)`
      roundRectPath(
        this.context,
        -box.size + 6,
        -box.size + 6,
        box.size * 2 - 12,
        box.size * 0.5,
        4,
      )
      this.context.fill()

      this.context.fillStyle = bonus.color
      this.context.font = '900 23px ui-sans-serif, system-ui, sans-serif'
      this.context.textAlign = 'center'
      this.context.textBaseline = 'middle'
      this.context.fillText('?', 0, 1)
      this.context.restore()
    }
  }

  /** Performs the draw upgrade boxes operation. */
  private drawUpgradeBoxes(): void {
    const margin = 64
    const left = this.game.cameraX - margin
    const top = this.game.cameraY - margin
    const right = this.game.cameraX + this.game.viewWidth + margin
    const bottom = this.game.cameraY + this.game.viewHeight + margin
    const time = performance.now() * 0.003

    for (const box of this.game.upgradeBoxes) {
      if (box.x < left || box.y < top || box.x > right || box.y > bottom) continue
      const weapon = WEAPONS[box.weaponIndex]
      const pulse = 1 + Math.sin(time * 2.6 + box.phase) * 0.075

      this.context.save()
      this.context.translate(box.x, box.y)
      this.context.scale(pulse, pulse)
      this.context.rotate(Math.sin(time * 0.9 + box.phase) * 0.07)

      this.context.fillStyle = PALETTE.shadow
      roundRectPath(this.context, -box.size + 6, -box.size + 10, box.size * 2, box.size * 2, 7)
      this.context.fill()

      this.context.shadowBlur = 22
      this.context.shadowColor = UPGRADE_CRATE_COLOR
      this.context.fillStyle = '#30230f'
      roundRectPath(this.context, -box.size, -box.size, box.size * 2, box.size * 2, 8)
      this.context.fill()
      this.context.shadowBlur = 0

      this.context.strokeStyle = UPGRADE_CRATE_COLOR
      this.context.lineWidth = 2.5
      roundRectPath(
        this.context,
        -box.size + 1,
        -box.size + 1,
        box.size * 2 - 2,
        box.size * 2 - 2,
        8,
      )
      this.context.stroke()
      this.context.strokeStyle = weapon.color
      this.context.lineWidth = 1.5
      roundRectPath(
        this.context,
        -box.size + 6,
        -box.size + 6,
        box.size * 2 - 12,
        box.size * 2 - 12,
        5,
      )
      this.context.stroke()

      this.context.fillStyle = UPGRADE_CRATE_COLOR
      this.context.font = '950 25px ui-sans-serif, system-ui, sans-serif'
      this.context.textAlign = 'center'
      this.context.textBaseline = 'middle'
      this.context.fillText('↑', 0, -4)
      this.context.fillStyle = weapon.color
      this.context.font = '900 9px ui-sans-serif, system-ui, sans-serif'
      this.context.fillText(weapon.name.slice(0, 3).toUpperCase(), 0, 13)
      this.context.restore()
    }
  }

  /** Performs the draw traps operation. */
  private drawTraps(): void {
    const time = performance.now() * 0.006
    for (const [trapIndex, trap] of this.game.playerTraps.entries()) {
      if (!this.game.isCircleVisible(trap.x, trap.y, trap.radius || trap.halfLength || 30)) continue
      this.drawPlayerTrap(trap, trapIndex, time)
    }
    for (const [mineIndex, mine] of this.game.enemyMines.entries()) {
      if (!this.game.isCircleVisible(mine.x, mine.y, 26)) continue
      this.drawEnemyMine(mine, mineIndex, time)
    }
  }

  /** Draws one player-deployed mine, stasis field, or laser barrier. */
  private drawPlayerTrap(trap: PlayerTrap, index: number, time: number): void {
    this.context.save()
    if (trap.kind === 'mine') this.drawPlayerMine(trap, index, time)
    else if (trap.kind === 'stasis') this.drawStasisField(trap, index, time)
    else this.drawLaserBarrier(trap)
    this.context.restore()
  }

  /** Draws one rotating player mine. */
  private drawPlayerMine(trap: PlayerTrap, index: number, time: number): void {
    this.context.translate(trap.x, trap.y)
    this.context.rotate(time + index)
    this.context.fillStyle = '#322511'
    this.context.strokeStyle = '#ffca6b'
    this.context.lineWidth = 2
    this.context.beginPath()
    for (let point = 0; point < 8; point += 1) {
      const angle = (point * TAU) / 8
      const radius = point % 2 ? 12 : 20
      this.context.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius)
    }
    this.context.closePath()
    this.context.fill()
    this.context.stroke()
    this.context.fillStyle = trap.arm > 0 ? '#fff1a8' : '#ff705f'
    this.context.beginPath()
    this.context.arc(0, 0, 4, 0, TAU)
    this.context.fill()
  }

  /** Draws one pulsing stasis field. */
  private drawStasisField(trap: PlayerTrap, index: number, time: number): void {
    this.context.globalAlpha = 0.22 + Math.sin(time + index) * 0.06
    this.context.fillStyle = '#9f8cff'
    this.context.strokeStyle = '#c7baff'
    this.context.lineWidth = 2
    this.context.beginPath()
    this.context.arc(trap.x, trap.y, trap.radius, 0, TAU)
    this.context.fill()
    this.context.stroke()
  }

  /** Draws one player laser barrier. */
  private drawLaserBarrier(trap: PlayerTrap): void {
    const deltaX = Math.cos(trap.angle) * trap.halfLength
    const deltaY = Math.sin(trap.angle) * trap.halfLength
    this.context.strokeStyle = '#67efff'
    this.context.lineWidth = 6
    this.context.globalAlpha = 0.25
    this.context.beginPath()
    this.context.moveTo(trap.x - deltaX, trap.y - deltaY)
    this.context.lineTo(trap.x + deltaX, trap.y + deltaY)
    this.context.stroke()
    this.context.globalAlpha = 0.9
    this.context.lineWidth = 2
    this.context.stroke()
  }

  /** Draws one enemy proximity mine. */
  private drawEnemyMine(mine: EnemyMine, index: number, time: number): void {
    this.context.save()
    this.context.translate(mine.x, mine.y)
    this.context.fillStyle = '#3a1512'
    this.context.strokeStyle = '#ff765f'
    this.context.lineWidth = 2
    this.context.beginPath()
    this.context.arc(0, 0, 14, 0, TAU)
    this.context.fill()
    this.context.stroke()
    this.context.fillStyle = mine.arm > 0 ? '#ffbf84' : '#ff4f4f'
    this.context.beginPath()
    this.context.arc(0, 0, 4 + Math.sin(time + index) * 1.2, 0, TAU)
    this.context.fill()
    this.context.restore()
  }

  /** Performs the draw player operation. */
  private drawPlayer(): void {
    const p = this.game.player
    if (p.deadTimer > 0) return
    const blink = p.invulnerable > 0 && Math.floor(p.invulnerable * 12) % 2 === 0
    if (blink) this.context.globalAlpha = 0.35
    this.drawTank({
      x: p.x,
      y: p.y,
      radius: p.radius,
      bodyAngle: p.bodyAngle,
      turretAngle: p.turretAngle,
      color: PALETTE.player,
      dark: PALETTE.playerDark,
      healthRatio: p.health / p.maxHealth,
      isPlayer: true,
      recoil: p.recoil,
    })
    if (p.invulnerable > 0) {
      this.context.strokeStyle = `rgba(101, 239, 255, ${0.28 + Math.sin(performance.now() * 0.012) * 0.12})`
      this.context.lineWidth = 3
      this.context.beginPath()
      this.context.arc(p.x, p.y, p.radius + 12, 0, TAU)
      this.context.stroke()
    }
    if (p.directionalShieldTimer > 0) {
      const pulse = 0.62 + Math.sin(performance.now() * 0.015) * 0.16
      this.context.save()
      this.context.strokeStyle = `rgba(88,207,255,${pulse})`
      this.context.lineWidth = 6
      this.context.shadowColor = '#58cfff'
      this.context.shadowBlur = this.game.effectQuality > 0.6 ? 16 : 0
      this.context.beginPath()
      this.context.arc(p.x, p.y, p.radius + 14, p.turretAngle - 1.08, p.turretAngle + 1.08)
      this.context.stroke()
      this.context.restore()
    }
    this.context.globalAlpha = 1
  }

  /** Performs the draw enemies operation. */
  private drawEnemies(): void {
    for (const [enemyIndex, enemy] of this.game.enemies.entries()) {
      if (!this.game.isCircleVisible(enemy.x, enemy.y, enemy.radius + 28)) continue
      this.drawEnemy(enemy, enemyIndex)
    }
  }

  /** Draws one enemy tank, rank aura, label, and archetype marker. */
  private drawEnemy(enemy: Enemy, index: number): void {
    const type = ENEMY_TYPES[enemy.typeIndex]
    const color = enemy.flash > 0 ? '#ffffff' : type.color
    this.context.save()
    this.context.globalAlpha = enemy.cloakAlpha ?? 1
    if (enemy.elite || enemy.boss) this.drawEnemyRankAura(enemy, index)
    this.drawTank({
      x: enemy.x,
      y: enemy.y,
      radius: enemy.radius,
      bodyAngle: enemy.bodyAngle,
      turretAngle: enemy.turretAngle,
      color,
      dark: type.dark,
      healthRatio: enemy.health / enemy.maxHealth,
      isPlayer: false,
      recoil: enemy.recoil,
    })
    this.drawEnemyRankLabel(enemy)
    if (type.marker) this.drawEnemyMarker(enemy, type.marker)
    this.context.restore()
  }

  /** Draws the animated elite or boss aura around a tank. */
  private drawEnemyRankAura(enemy: Enemy, index: number): void {
    const pulse = performance.now() * 0.008 + index
    this.context.strokeStyle = enemy.boss
      ? `rgba(255,95,136,${0.58 + Math.sin(pulse) * 0.18})`
      : `rgba(255,220,104,${0.48 + Math.sin(pulse) * 0.16})`
    this.context.lineWidth = enemy.boss ? 5 : 3
    if (this.game.effectQuality > 0.6) {
      this.context.shadowBlur = enemy.boss ? 24 : 18
      this.context.shadowColor = enemy.boss ? '#ff5f88' : '#ffd66e'
    }
    this.context.beginPath()
    this.context.arc(enemy.x, enemy.y, enemy.radius + (enemy.boss ? 15 : 9), 0, TAU)
    this.context.stroke()
    this.context.shadowBlur = 0
  }

  /** Draws a boss phase or elite-star label above an enemy. */
  private drawEnemyRankLabel(enemy: Enemy): void {
    if (enemy.boss) {
      this.context.fillStyle = '#ffd0dd'
      this.context.font = '900 13px ui-sans-serif, system-ui, sans-serif'
      this.context.textAlign = 'center'
      this.context.fillText(`PHASE ${enemy.bossPhase}`, enemy.x, enemy.y - enemy.radius - 28)
    } else if (enemy.elite) {
      this.context.fillStyle = '#ffe77d'
      this.context.font = '900 12px ui-sans-serif, system-ui, sans-serif'
      this.context.textAlign = 'center'
      this.context.fillText('★', enemy.x, enemy.y - enemy.radius - 20)
    }
  }

  /** Draws the short archetype marker inside an enemy hull. */
  private drawEnemyMarker(enemy: Enemy, marker: string): void {
    this.context.translate(enemy.x, enemy.y)
    this.context.fillStyle = '#061018'
    this.context.font = `900 ${Math.max(10, enemy.radius * 0.55)}px ui-sans-serif, system-ui, sans-serif`
    this.context.textAlign = 'center'
    this.context.textBaseline = 'middle'
    this.context.fillText(marker, 0, 1)
  }

  /** Performs the draw tank operation. */
  private drawTank(options: TankRenderOptions): void {
    const { x, y, radius, bodyAngle, turretAngle, color, dark, healthRatio, isPlayer } = options
    const recoil = options.recoil ?? 0
    this.context.save()
    this.context.translate(x + 6, y + 8)
    this.context.rotate(bodyAngle)
    this.context.fillStyle = PALETTE.shadow
    roundRectPath(this.context, -radius, -radius * 0.74, radius * 2, radius * 1.48, radius * 0.3)
    this.context.fill()
    this.context.restore()

    this.context.save()
    this.context.translate(x, y)
    this.context.rotate(bodyAngle)
    this.context.fillStyle = '#071018'
    roundRectPath(
      this.context,
      -radius * 1.04,
      -radius * 0.78,
      radius * 2.08,
      radius * 0.48,
      radius * 0.16,
    )
    this.context.fill()
    roundRectPath(
      this.context,
      -radius * 1.04,
      radius * 0.3,
      radius * 2.08,
      radius * 0.48,
      radius * 0.16,
    )
    this.context.fill()
    this.context.fillStyle = dark
    roundRectPath(
      this.context,
      -radius * 0.84,
      -radius * 0.67,
      radius * 1.68,
      radius * 1.34,
      radius * 0.28,
    )
    this.context.fill()
    this.context.fillStyle = color
    roundRectPath(
      this.context,
      -radius * 0.66,
      -radius * 0.49,
      radius * 1.32,
      radius * 0.98,
      radius * 0.25,
    )
    this.context.fill()
    this.context.fillStyle = 'rgba(255,255,255,0.14)'
    roundRectPath(
      this.context,
      -radius * 0.52,
      -radius * 0.39,
      radius * 0.9,
      radius * 0.18,
      radius * 0.08,
    )
    this.context.fill()
    this.context.restore()

    this.context.save()
    this.context.translate(x, y)
    this.context.rotate(turretAngle)
    this.context.translate(-recoil, 0)
    this.context.fillStyle = dark
    roundRectPath(
      this.context,
      -radius * 0.05,
      -radius * 0.17,
      radius * 1.65,
      radius * 0.34,
      radius * 0.14,
    )
    this.context.fill()
    this.context.fillStyle = color
    roundRectPath(
      this.context,
      radius * 0.25,
      -radius * 0.11,
      radius * 1.25,
      radius * 0.22,
      radius * 0.1,
    )
    this.context.fill()
    this.context.restore()

    this.context.fillStyle = dark
    this.context.beginPath()
    this.context.arc(x, y, radius * 0.54, 0, TAU)
    this.context.fill()
    this.context.fillStyle = color
    this.context.beginPath()
    this.context.arc(x, y, radius * 0.38, 0, TAU)
    this.context.fill()
    this.context.fillStyle = 'rgba(255,255,255,0.22)'
    this.context.beginPath()
    this.context.arc(x - radius * 0.11, y - radius * 0.11, radius * 0.11, 0, TAU)
    this.context.fill()

    if (!isPlayer && healthRatio < 0.999) {
      const width = radius * 2
      this.context.fillStyle = 'rgba(0,0,0,0.45)'
      roundRectPath(this.context, x - width * 0.5, y - radius - 13, width, 4, 2)
      this.context.fill()
      this.context.fillStyle = healthRatio > 0.35 ? '#72efb0' : '#ff6179'
      roundRectPath(
        this.context,
        x - width * 0.5,
        y - radius - 13,
        width * clamp(healthRatio, 0, 1),
        4,
        2,
      )
      this.context.fill()
    }
  }

  /** Performs the draw bullets operation. */
  private drawBullets(): void {
    for (const bullet of this.game.bullets) {
      const projectileVisible = this.game.isCircleVisible(bullet.x, bullet.y, bullet.radius, 80)
      const targetVisible =
        bullet.type === 'enemyMortar' &&
        this.game.isCircleVisible(bullet.targetX, bullet.targetY, bullet.splash, 40)
      if (!projectileVisible && !targetVisible) continue
      const angle = Math.atan2(bullet.vy, bullet.vx)

      if (bullet.type === 'enemyMortar') {
        const progress = clamp(1 - bullet.life / bullet.maxLife, 0, 1)
        this.context.save()
        this.context.translate(bullet.targetX, bullet.targetY)
        this.context.globalAlpha = 0.26 + progress * 0.5
        this.context.strokeStyle = bullet.color
        this.context.fillStyle = `${bullet.color}18`
        this.context.lineWidth = 2
        this.context.setLineDash([8, 6])
        this.context.beginPath()
        this.context.arc(0, 0, bullet.splash, 0, TAU)
        this.context.fill()
        this.context.stroke()
        this.context.setLineDash([])
        this.context.globalAlpha = 0.72
        this.context.beginPath()
        this.context.arc(0, 0, Math.max(8, (1 - progress) * 34), 0, TAU)
        this.context.stroke()
        this.context.restore()
      }

      this.context.save()
      this.context.translate(bullet.x, bullet.y)
      this.context.rotate(angle)
      this.context.globalAlpha = 0.28
      this.context.fillStyle = bullet.color
      roundRectPath(
        this.context,
        -bullet.radius * 4.2,
        -bullet.radius * 0.7,
        bullet.radius * 4.7,
        bullet.radius * 1.4,
        bullet.radius * 0.7,
      )
      this.context.fill()
      this.context.globalAlpha = 1
      this.context.shadowBlur = this.game.effectQuality > 0.6 ? 13 : 0
      this.context.shadowColor = bullet.color
      this.context.fillStyle = bullet.color
      this.context.beginPath()
      this.context.arc(0, 0, bullet.radius, 0, TAU)
      this.context.fill()
      this.context.shadowBlur = 0

      if (bullet.type === 'mortar' || bullet.type === 'enemyMortar') {
        const progress = clamp(1 - bullet.life / bullet.maxLife, 0, 1)
        this.context.globalAlpha = 0.55
        this.context.strokeStyle = bullet.color
        this.context.lineWidth = 1.5
        this.context.beginPath()
        this.context.arc(0, 0, 12 + progress * 18, 0, TAU)
        this.context.stroke()
      } else if (bullet.type === 'enemyPulse') {
        this.context.globalAlpha = 0.68
        this.context.strokeStyle = '#d8ffe2'
        this.context.lineWidth = 1.2
        this.context.beginPath()
        this.context.arc(0, 0, bullet.radius * 2.35, 0, TAU)
        this.context.stroke()
      }
      this.context.restore()
    }
  }

  /** Performs the draw particles operation. */
  private drawParticles(): void {
    this.context.save()
    this.context.globalCompositeOperation = 'lighter'
    for (const particle of this.game.particles) {
      if (!this.game.isCircleVisible(particle.x, particle.y, particle.size, 30)) continue
      this.context.globalAlpha = clamp(particle.life / particle.maxLife, 0, 1)
      this.context.fillStyle = particle.color
      if (particle.kind === 'debris') {
        this.context.save()
        this.context.translate(particle.x, particle.y)
        this.context.rotate(particle.rotation)
        this.context.fillRect(
          -particle.size * 0.8,
          -particle.size * 0.45,
          particle.size * 1.6,
          particle.size * 0.9,
        )
        this.context.restore()
      } else {
        this.context.beginPath()
        this.context.arc(particle.x, particle.y, particle.size, 0, TAU)
        this.context.fill()
      }
    }
    this.context.restore()
    this.context.globalAlpha = 1
  }

  /** Performs the draw crosshair operation. */
  private drawCrosshair(): void {
    if (IS_COARSE_POINTER || !this.game.input.mouseSeen || !this.game.running) return
    const x = this.game.input.mouseX
    const y = this.game.input.mouseY
    this.context.save()
    this.context.strokeStyle = this.game.getEffectiveWeapon(this.game.player.weaponIndex).color
    this.context.lineWidth = 1.5
    this.context.globalAlpha = 0.8
    this.context.beginPath()
    this.context.arc(x, y, 10, 0, TAU)
    this.context.moveTo(x - 16, y)
    this.context.lineTo(x - 6, y)
    this.context.moveTo(x + 6, y)
    this.context.lineTo(x + 16, y)
    this.context.moveTo(x, y - 16)
    this.context.lineTo(x, y - 6)
    this.context.moveTo(x, y + 6)
    this.context.lineTo(x, y + 16)
    this.context.stroke()
    this.context.restore()
  }

  /** Performs the draw boss bar operation. */
  private drawBossBar(): void {
    const boss = this.game.enemies.find((enemy) => enemy.boss)
    if (!boss) return
    const width = Math.min(520, this.game.viewWidth * 0.58)
    const x = (this.game.viewWidth - width) * 0.5
    let y = 88
    if (this.game.viewWidth < 760) y = 180
    else if (this.game.viewHeight < 620) y = 78
    const ratio = clamp(boss.health / boss.maxHealth, 0, 1)
    this.context.save()
    this.context.fillStyle = 'rgba(3,8,13,0.82)'
    roundRectPath(this.context, x - 12, y - 22, width + 24, 48, 12)
    this.context.fill()
    this.context.fillStyle = 'rgba(255,255,255,0.12)'
    roundRectPath(this.context, x, y, width, 10, 5)
    this.context.fill()
    const gradient = this.context.createLinearGradient(x, 0, x + width, 0)
    gradient.addColorStop(0, '#ff5f88')
    gradient.addColorStop(1, '#ffba67')
    this.context.fillStyle = gradient
    roundRectPath(this.context, x, y, width * ratio, 10, 5)
    this.context.fill()
    this.context.fillStyle = '#ffe8ef'
    this.context.font = '900 12px ui-sans-serif, system-ui, sans-serif'
    this.context.textAlign = 'center'
    this.context.fillText(
      `${this.game.bossName} · PHASE ${boss.bossPhase}`,
      this.game.viewWidth * 0.5,
      y - 7,
    )
    this.context.restore()
  }

  /** Performs the draw combo indicator operation. */
  private drawComboIndicator(): void {
    const pulse = 1 + Math.sin(performance.now() * 0.012) * 0.035
    this.context.save()
    this.context.translate(this.game.viewWidth * 0.5, Math.max(94, this.game.viewHeight * 0.16))
    this.context.scale(pulse, pulse)
    this.context.textAlign = 'center'
    this.context.shadowBlur = 20
    this.context.shadowColor = this.game.theme.accent
    this.context.fillStyle = this.game.theme.accent
    this.context.font = '950 24px ui-sans-serif, system-ui, sans-serif'
    this.context.fillText(`${this.game.comboCount} HIT COMBO`, 0, 0)
    this.context.shadowBlur = 0
    this.context.fillStyle = 'rgba(235,250,255,0.8)'
    this.context.font = '800 12px ui-sans-serif, system-ui, sans-serif'
    this.context.fillText(`SCORE ×${this.game.comboMultiplier.toFixed(1)}`, 0, 19)
    this.context.restore()
  }

  /** Performs the draw touch controls operation. */
  private drawTouchControls(): void {
    if (!IS_COARSE_POINTER) return
    this.drawStick(this.game.input.moveTouch, 0.5)
    this.drawStick(this.game.input.aimTouch, 0.62)
  }

  /** Performs the draw stick operation. */
  private drawStick(stick: TouchStick, alpha: number): void {
    if (!stick.active) return
    this.context.save()
    this.context.globalAlpha = alpha
    this.context.strokeStyle = '#9bf7ff'
    this.context.lineWidth = 2
    this.context.fillStyle = 'rgba(11, 35, 46, 0.56)'
    this.context.beginPath()
    this.context.arc(stick.originX, stick.originY, 58, 0, TAU)
    this.context.fill()
    this.context.stroke()
    this.context.fillStyle = 'rgba(132, 248, 255, 0.28)'
    this.context.beginPath()
    this.context.arc(stick.x, stick.y, 24, 0, TAU)
    this.context.fill()
    this.context.stroke()
    this.context.restore()
  }
}

/** Rounded rectangle path helper with broad browser support. */
function roundRectPath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width * 0.5, height * 0.5)
  context.beginPath()
  context.moveTo(x + r, y)
  context.arcTo(x + width, y, x + width, y + height, r)
  context.arcTo(x + width, y + height, x, y + height, r)
  context.arcTo(x, y + height, x, y, r)
  context.arcTo(x, y, x + width, y, r)
  context.closePath()
}
