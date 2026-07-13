/**
 * Neon Tank Arena
 * A dependency-free, high-DPI Canvas arena game designed for CodePen.
 *
 * Performance notes:
 * - Fixed-timestep simulation keeps gameplay consistent across refresh rates.
 * - Bullets and particles use object pools to reduce garbage collection.
 * - Collision checks use simple shapes and swap-removal instead of array splices.
 * - Rendering culls obstacles outside the camera viewport.
 */
import { SynthAudio } from '../audio/SynthAudio.ts'
import { ObjectPool } from '../core/ObjectPool.ts'
import { randomUnit } from '../core/RandomSource.ts'
import { InputManager } from '../input/InputManager.ts'
import { Arena } from './Arena.ts'
import { GameEffects } from './GameEffects.ts'
import { GameRenderer } from './GameRenderer.ts'
import { WeaponSystem } from './WeaponSystem.ts'
import {
  BONUS_TYPES,
  ENEMY_TYPES,
  FIXED_STEP,
  GADGETS,
  IS_COARSE_POINTER,
  MAX_FRAME,
  PALETTE,
  TAU,
  UPGRADE_CRATE_COLOR,
  UPGRADE_MAX_RANK,
  UPGRADE_MAX_TOTAL,
  UPGRADE_STATS,
  WEAPONS,
} from './config.ts'
import {
  circleIntersectsRect,
  clamp,
  distanceSquared,
  lerp,
  mulberry32,
  normalizeAngle,
  pointSegmentDistanceSquared,
  randomInt,
  randomRange,
  turnToward,
} from './geometry.ts'
import type {
  BonusBox,
  BonusCollectionSource,
  Bullet,
  BulletSpawnOptions,
  DamageSource,
  EffectiveWeapon,
  Enemy,
  EnemyMine,
  EnemyShotOverrides,
  EnemyType,
  Hazard,
  Obstacle,
  Particle,
  Player,
  PlayerTrap,
  Point,
  RandomSource,
  Rectangle,
  ScorchMark,
  TerrainEffect,
  Theme,
  TrackMark,
  UpgradeBox,
  UpgradeOffer,
} from './types.ts'

/** Browser navigator with the optional device-memory hint used for render scaling. */
interface NavigatorWithMemory extends Navigator {
  /** Approximate device memory in gibibytes. */
  deviceMemory?: number
}

/** Open rescue point paired with the movement heading used to reach it. */
interface SteeringPoint extends Point {
  /** Movement heading in radians. */
  angle: number
}

/** Finds a required DOM element and fails early when the game shell is incomplete. */
function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (!element) throw new Error(`Missing required game element: ${selector}`)
  return element
}

// ---------------------------------------------------------------------------
// DOM and constants
// ---------------------------------------------------------------------------

/** Defines the shared canvas. */
const canvas = requireElement<HTMLCanvasElement>('#gameCanvas')
/** Defines the shared context. */
const context = canvas.getContext('2d', { alpha: false })
if (!context) throw new Error('This browser does not support the 2D canvas API.')
/** Defines the shared ctx. */
const ctx = context
/** Defines the shared level value. */
const levelValue = requireElement<HTMLElement>('#levelValue')
/** Defines the shared score value. */
const scoreValue = requireElement<HTMLElement>('#scoreValue')
/** Defines the shared enemy value. */
const enemyValue = requireElement<HTMLElement>('#enemyValue')
/** Defines the shared health value. */
const healthValue = requireElement<HTMLElement>('#healthValue')
/** Defines the shared health fill. */
const healthFill = requireElement<HTMLElement>('#healthFill')
/** Defines the shared bonus value. */
const bonusValue = requireElement<HTMLElement>('#bonusValue')
/** Defines the shared combo value. */
const comboValue = requireElement<HTMLElement>('#comboValue')
/** Defines the shared theme value. */
const themeValue = requireElement<HTMLElement>('#themeValue')
/** Defines the shared upgrade level labels. */
const upgradeLevelLabels = [...document.querySelectorAll<HTMLElement>('[data-upgrade-level]')]
/** Defines the shared sound button. */
const soundButton = requireElement<HTMLButtonElement>('#soundButton')
/** Defines the shared pause button. */
const pauseButton = requireElement<HTMLButtonElement>('#pauseButton')
/** Defines the shared start button. */
const startButton = requireElement<HTMLButtonElement>('#startButton')
/** Defines the shared new game button. */
const newGameButton = requireElement<HTMLButtonElement>('#newGameButton')
/** Defines the shared message panel. */
const messagePanel = requireElement<HTMLElement>('#messagePanel')
/** Defines the shared toast. */
const toast = requireElement<HTMLElement>('#toast')
/** Defines the shared weapon buttons. */
const weaponButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-weapon]')]
/** Defines the shared gadget buttons. */
const gadgetButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-gadget]')]

// ---------------------------------------------------------------------------
// Math and collision helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Reusable object pool
// ---------------------------------------------------------------------------

/** Defines the shared bullet pool. */
const bulletPool = new ObjectPool<Bullet>(() => ({
  x: 0,
  y: 0,
  prevX: 0,
  prevY: 0,
  vx: 0,
  vy: 0,
  radius: 4,
  damage: 1,
  life: 1,
  maxLife: 1,
  owner: 'player',
  color: '#fff',
  type: 'shell',
  bounce: 0,
  splash: 0,
  turnRate: 0,
  targetX: 0,
  targetY: 0,
  ignoresWalls: false,
  ricocheted: false,
  sourceX: 0,
  sourceY: 0,
  weaponIndex: -1,
  critical: false,
  sourceType: 'weapon',
  pierce: 0,
  chain: 0,
  chainProcessed: false,
  cluster: 0,
  clustered: false,
  enemyWeaponRank: 0,
}))

// ---------------------------------------------------------------------------
// Game
// ---------------------------------------------------------------------------

class Game {
  /** Stores the view width. */
  public viewWidth: number
  /** Stores the view height. */
  public viewHeight: number
  /** Stores the dpr. */
  public dpr: number
  /** Stores the camera x. */
  public cameraX: number
  /** Stores the camera y. */
  public cameraY: number
  /** Stores the level. */
  private level: number
  /** Stores the score. */
  private score: number
  /** Stores the running. */
  public running: boolean
  /** Stores the paused. */
  public paused: boolean
  /** Stores the level complete timer. */
  private levelCompleteTimer: number
  /** Stores the toast timer. */
  private toastTimer: number
  /** Stores the last hud update. */
  private lastHudUpdate: number
  /** Stores the screen shake. */
  public screenShake: number
  /** Stores the flash alpha. */
  public flashAlpha: number
  /** Stores the slow mo timer. */
  private slowMoTimer: number
  /** Stores the enemies. */
  public readonly enemies: Enemy[]
  /** Stores the bonus boxes. */
  public readonly bonusBoxes: BonusBox[]
  /** Stores the upgrade boxes. */
  public readonly upgradeBoxes: UpgradeBox[]
  /** Stores the player traps. */
  public readonly playerTraps: PlayerTrap[]
  /** Stores the enemy mines. */
  public readonly enemyMines: EnemyMine[]
  /** Stores the bonus spawn timer. */
  private bonusSpawnTimer: number
  /** Stores the bullets. */
  public readonly bullets: Bullet[]
  /** Stores the combo count. */
  public comboCount: number
  /** Stores the combo timer. */
  public comboTimer: number
  /** Stores the combo multiplier. */
  public comboMultiplier: number
  /** Stores the multi kill count. */
  private multiKillCount: number
  /** Stores the multi kill timer. */
  private multiKillTimer: number
  /** Stores the last damage time. */
  private lastDamageTime: number
  /** Stores the boss active. */
  public bossActive: boolean
  /** Stores the boss name. */
  public bossName: string
  /** Stores the gadget charges. */
  private gadgetCharges: number[]
  /** Permanent player upgrades and derived weapon profiles. */
  private readonly weapons: WeaponSystem
  /** Stores the frame average. */
  public frameAverage: number
  /** Stores the effect quality. */
  public effectQuality: number
  /** Stores the audio. */
  private readonly audio: SynthAudio
  /** Stores the input. */
  public readonly input: InputManager
  /** Stores the player. */
  public readonly player: Player
  /** Stores the last render time. */
  public lastRenderTime?: number
  /** Dedicated canvas renderer. */
  private readonly renderer: GameRenderer
  /** Procedural layout, terrain, and collision manager. */
  private readonly arena: Arena
  /** Pooled particle and surface-mark manager. */
  private readonly effects: GameEffects

  /** Creates a new Game instance. */
  public constructor() {
    this.viewWidth = innerWidth
    this.viewHeight = innerHeight
    this.dpr = 1
    this.cameraX = 0
    this.cameraY = 0
    this.level = 1
    this.score = 0
    this.running = false
    this.paused = false
    this.levelCompleteTimer = -1
    this.toastTimer = 0
    this.lastHudUpdate = 0
    this.screenShake = 0
    this.flashAlpha = 0
    this.slowMoTimer = 0
    this.enemies = []
    this.bonusBoxes = []
    this.upgradeBoxes = []
    this.playerTraps = []
    this.enemyMines = []
    this.bonusSpawnTimer = 0
    this.bullets = []
    this.comboCount = 0
    this.comboTimer = 0
    this.comboMultiplier = 1
    this.multiKillCount = 0
    this.multiKillTimer = 0
    this.lastDamageTime = -999
    this.bossActive = false
    this.bossName = ''
    this.gadgetCharges = GADGETS.map((gadget) => gadget.maxCharges)
    this.weapons = new WeaponSystem()
    this.frameAverage = 16.7
    this.effectQuality = IS_COARSE_POINTER ? 0.72 : 1
    this.audio = new SynthAudio(soundButton)
    this.input = new InputManager(canvas, {
      getPlayerWeaponIndex: () => this.player.weaponIndex,
      getViewWidth: () => this.viewWidth,
      selectWeapon: (index) => this.selectWeapon(index),
      deployGadget: (id) => {
        this.deployGadget(id)
      },
      togglePause: () => this.togglePause(),
    })
    this.player = this.createPlayer()
    this.arena = new Arena(ctx)
    this.effects = new GameEffects({
      getEffectQuality: () => this.effectQuality,
      getTheme: () => this.theme,
      raiseFlash: (alpha) => {
        this.flashAlpha = Math.max(this.flashAlpha, alpha)
      },
    })
    this.renderer = new GameRenderer(this, ctx)
    this.resize()
    this.bindUI()
    this.generateLevel(1)
  }

  /** Returns the generated arena width in world units. */
  public get worldWidth(): number {
    return this.arena.worldWidth
  }

  /** Returns the generated arena height in world units. */
  public get worldHeight(): number {
    return this.arena.worldHeight
  }

  /** Returns the active arena theme. */
  public get theme(): Theme {
    return this.arena.theme
  }

  /** Returns the hue cached for lightweight visual effects. */
  public get themeHue(): number {
    return this.arena.themeHue
  }

  /** Returns the current arena walls. */
  public get obstacles(): Obstacle[] {
    return this.arena.obstacles
  }

  /** Returns the current environmental hazard zones. */
  public get hazards(): Hazard[] {
    return this.arena.hazards
  }

  /** Returns the repeating floor texture for the active theme. */
  public get floorPattern(): CanvasPattern | null {
    return this.arena.floorPattern
  }

  /** Returns active pooled particles for rendering. */
  public get particles(): Particle[] {
    return this.effects.particles
  }

  /** Returns active tank tread marks for rendering. */
  public get trackMarks(): TrackMark[] {
    return this.effects.trackMarks
  }

  /** Returns persistent explosion scorch marks for rendering. */
  public get scorchMarks(): ScorchMark[] {
    return this.effects.scorchMarks
  }

  /** Creates the player's mutable tank state. */
  private createPlayer(): Player {
    return {
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      radius: 22,
      speed: 220,
      bodyAngle: 0,
      turretAngle: 0,
      health: 100,
      maxHealth: 100,
      fireCooldown: 0,
      weaponIndex: 0,
      deadTimer: 0,
      invulnerable: 0,
      rapidTimer: 0,
      turboTimer: 0,
      damageTimer: 0,
      armorTimer: 0,
      vampireTimer: 0,
      magnetTimer: 0,
      directionalShieldTimer: 0,
      timeWarpTimer: 0,
      multiShotTimer: 0,
      comboLockTimer: 0,
      hazardCooldown: 0,
      recoil: 0,
      trackTimer: 0,
    }
  }

  /** Performs the bind ui operation. */
  private bindUI(): void {
    addEventListener('resize', () => this.resize(), { passive: true })
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.running) this.setPaused(true)
    })
    pauseButton.addEventListener('click', () => this.togglePause())
    startButton.addEventListener('click', () => this.start())
    newGameButton.addEventListener('click', () => this.startNewGame())
    weaponButtons.forEach((button) => {
      button.addEventListener('click', () => this.selectWeapon(Number(button.dataset.weapon)))
    })
    gadgetButtons.forEach((button) => {
      button.addEventListener('click', () => this.deployGadget(String(button.dataset.gadget)))
    })
  }

  /** Performs the start operation. */
  private start(): void {
    this.audio.unlock()
    this.audio.ui()
    this.running = true
    this.paused = false
    messagePanel.classList.remove('is-visible')
    pauseButton.textContent = 'Ⅱ'
    canvas.focus({ preventScroll: true })
    this.showToast(`LEVEL ${this.level} · ${this.theme.name}`)
  }

  /** Resets all campaign progression and starts again at level one. */
  private startNewGame(): void {
    this.audio.unlock()
    this.audio.ui()
    this.weapons.reset()
    Object.assign(this.player, this.createPlayer())
    this.score = 0
    this.screenShake = 0
    this.flashAlpha = 0
    this.slowMoTimer = 0
    this.lastDamageTime = -999
    this.running = true
    this.paused = false
    this.generateLevel(1)
    startButton.hidden = true
    messagePanel.classList.remove('is-visible')
    pauseButton.textContent = 'Ⅱ'
    canvas.focus({ preventScroll: true })
    this.showToast(`NEW GAME · ${this.theme.name}`)
  }

  /** Performs the toggle pause operation. */
  private togglePause(): void {
    if (!this.running) {
      this.startNewGame()
      return
    }
    this.setPaused(!this.paused)
  }

  /** Performs the set paused operation. */
  private setPaused(value: boolean): void {
    this.paused = value
    this.audio.ui()
    pauseButton.textContent = value ? '▶' : 'Ⅱ'
    if (value) {
      requireElement<HTMLHeadingElement>('#messagePanel h1').textContent = 'PAUSED'
      requireElement<HTMLParagraphElement>('#messagePanel p').textContent =
        'The arena is frozen. Your unlimited lives are safe.'
      startButton.textContent = 'RESUME'
      startButton.hidden = false
      messagePanel.classList.add('is-visible')
    } else {
      messagePanel.classList.remove('is-visible')
    }
  }

  /** Performs the resize operation. */
  private resize(): void {
    this.viewWidth = Math.max(320, innerWidth)
    this.viewHeight = Math.max(320, innerHeight)
    const memory = (navigator as NavigatorWithMemory).deviceMemory ?? 4
    const dprCap = IS_COARSE_POINTER || memory <= 4 ? 1.5 : 2
    this.dpr = Math.min(devicePixelRatio || 1, dprCap)
    canvas.width = Math.round(this.viewWidth * this.dpr)
    canvas.height = Math.round(this.viewHeight * this.dpr)
    canvas.style.width = `${this.viewWidth}px`
    canvas.style.height = `${this.viewHeight}px`
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    this.arena.buildFloorPattern()
  }

  /** Performs the select weapon operation. */
  public selectWeapon(index: number): void {
    this.player.weaponIndex = clamp(index, 0, WEAPONS.length - 1)
    weaponButtons.forEach((button, buttonIndex) => {
      button.classList.toggle('is-active', buttonIndex === this.player.weaponIndex)
    })
    this.updateWeaponUpgradeLabels()
    this.showToast(WEAPONS[this.player.weaponIndex].name.toUpperCase())
    if (this.running) this.audio.ui()
  }

  /** Returns a weapon definition after permanent upgrades are applied. */
  public getEffectiveWeapon(index: number): EffectiveWeapon {
    return this.weapons.getEffectiveWeapon(index)
  }

  /** Refreshes permanent-rank labels in the weapon toolbar. */
  private updateWeaponUpgradeLabels(): void {
    upgradeLevelLabels.forEach((label, index) => {
      const total = this.weapons.getUpgradeTotal(index)
      const maxed = total >= UPGRADE_MAX_TOTAL
      label.textContent = maxed ? 'MAX' : `L${total}/${UPGRADE_MAX_TOTAL}`
      label.classList.toggle('is-maxed', maxed)
    })
  }

  /** Chooses a valid permanent upgrade, favoring the equipped weapon. */
  private buildUpgradeOffer(
    random: RandomSource = randomUnit,
    preferredWeaponIndex = this.player.weaponIndex,
  ): UpgradeOffer | null {
    return this.weapons.buildUpgradeOffer(this.upgradeBoxes, preferredWeaponIndex, random)
  }

  /** Add an obstacle-free permanent-upgrade crate to the arena. */
  private spawnUpgradeBox(random: RandomSource = randomUnit): boolean {
    if (this.upgradeBoxes.length >= 2) return false
    const offer = this.buildUpgradeOffer(random)
    if (!offer) return false

    for (let attempt = 0; attempt < 80; attempt += 1) {
      const point = this.arena.findOpenPoint(random, 25, 170, this.player.x, this.player.y)
      const blockedByTank = this.enemies.some(
        (enemy) => distanceSquared(point.x, point.y, enemy.x, enemy.y) < (enemy.radius + 78) ** 2,
      )
      const blockedByBonus = this.bonusBoxes.some(
        (box) => distanceSquared(point.x, point.y, box.x, box.y) < 92 ** 2,
      )
      const blockedByUpgrade = this.upgradeBoxes.some(
        (box) => distanceSquared(point.x, point.y, box.x, box.y) < 110 ** 2,
      )
      if (blockedByTank || blockedByBonus || blockedByUpgrade) continue
      this.upgradeBoxes.push({
        x: point.x,
        y: point.y,
        size: 24,
        phase: random() * TAU,
        weaponIndex: offer.weaponIndex,
        statId: offer.statId,
        statIndex: offer.statIndex,
      })
      return true
    }
    return false
  }

  /** Drop a valid upgrade crate at a defeated elite's position. */
  private spawnUpgradeBoxAt(x: number, y: number, random: RandomSource = randomUnit): boolean {
    if (this.upgradeBoxes.length >= 2) return false
    const offer = this.buildUpgradeOffer(random)
    if (!offer) return false
    this.upgradeBoxes.push({
      x,
      y,
      size: 24,
      phase: random() * TAU,
      weaponIndex: offer.weaponIndex,
      statId: offer.statId,
      statIndex: offer.statIndex,
    })
    return true
  }

  /** Apply one capped permanent weapon upgrade from a collected crate. */
  private collectUpgradeBox(index: number, _source: BonusCollectionSource): void {
    const box = this.upgradeBoxes[index]
    if (!box) return
    const stat = UPGRADE_STATS[box.statIndex]
    const last = this.upgradeBoxes.pop()
    if (last && index < this.upgradeBoxes.length) this.upgradeBoxes[index] = last

    const result = this.weapons.applyUpgrade(box.weaponIndex, box.statId)
    if (result.maxed) {
      this.score += 400
      this.showToast(`UPGRADE MAXED · +400 SCORE`)
    } else {
      this.score += 150
      this.showToast(
        `${WEAPONS[box.weaponIndex].name.toUpperCase()} · ${stat.name} ${result.rank}/${UPGRADE_MAX_RANK}`,
      )
    }

    this.effects.spawnExplosion(box.x, box.y, UPGRADE_CRATE_COLOR, 24)
    this.audio.pickup()
    this.flashAlpha = Math.max(this.flashAlpha, 0.16)
    this.updateWeaponUpgradeLabels()
    this.updateHud(true)
  }

  /** Generate an arena using a deterministic seed based on the level number. */
  private generateLevel(level: number): void {
    this.level = level
    const random = mulberry32((level * 0x9e3779b1) ^ 0xa531f127)
    const spawn = this.arena.generate(level, random)
    this.resetLevelState(level, spawn)
    const eligibleTypes = this.getEligibleEnemyTypes(level)
    this.spawnLevelEnemies(level, random, spawn, eligibleTypes)

    const initialCrates = Math.min(9, 4 + Math.floor(level / 3))
    for (let index = 0; index < initialCrates; index += 1) this.spawnBonusBox(random)
    this.spawnUpgradeBox(random)
    this.bonusSpawnTimer = randomRange(random, 5.5, 8.5)

    this.cameraX = clamp(
      this.player.x - this.viewWidth * 0.5,
      0,
      Math.max(0, this.worldWidth - this.viewWidth),
    )
    this.cameraY = clamp(
      this.player.y - this.viewHeight * 0.5,
      0,
      Math.max(0, this.worldHeight - this.viewHeight),
    )
    themeValue.textContent = this.theme.name
    document.documentElement.style.setProperty('--accent', this.theme.accent)
    this.updateGadgetButtons()
    this.updateHud(true)
    this.selectWeapon(this.player.weaponIndex)
  }

  /** Clears transient combat state and positions the player for a generated level. */
  private resetLevelState(level: number, spawn: Point): void {
    this.bonusBoxes.length = 0
    this.upgradeBoxes.length = 0
    this.playerTraps.length = 0
    this.enemyMines.length = 0
    this.effects.reset()
    this.comboCount = 0
    this.comboTimer = 0
    this.comboMultiplier = 1
    this.multiKillCount = 0
    this.multiKillTimer = 0
    this.bossActive = level % 5 === 0
    this.bossName = this.bossActive ? 'SIEGE TITAN' : ''
    this.gadgetCharges = GADGETS.map((gadget) => gadget.maxCharges + Math.floor(level / 12))
    this.clearPooledArray(this.bullets, bulletPool)
    this.enemies.length = 0
    this.levelCompleteTimer = -1

    Object.assign(this.player, {
      x: spawn.x,
      y: spawn.y,
      vx: 0,
      vy: 0,
      health: this.player.maxHealth,
      deadTimer: 0,
      invulnerable: 1.5,
      fireCooldown: 0,
      rapidTimer: 0,
      turboTimer: 0,
      damageTimer: 0,
      armorTimer: 0,
      vampireTimer: 0,
      magnetTimer: 0,
      directionalShieldTimer: 0,
      timeWarpTimer: 0,
      multiShotTimer: 0,
      comboLockTimer: 0,
      hazardCooldown: 0,
      recoil: 0,
      trackTimer: 0,
    })
  }

  /** Returns indexes of regular enemy types unlocked for a level. */
  private getEligibleEnemyTypes(level: number): number[] {
    const eligibleTypes: number[] = []
    for (const [typeIndex, type] of ENEMY_TYPES.entries()) {
      if (!type.boss && type.unlockLevel <= level) eligibleTypes.push(typeIndex)
    }
    return eligibleTypes
  }

  /** Populates either a boss encounter or a regular combat wave. */
  private spawnLevelEnemies(
    level: number,
    random: RandomSource,
    spawn: Point,
    eligibleTypes: number[],
  ): void {
    if (this.bossActive) {
      this.spawnBossEncounter(level, random, spawn, eligibleTypes)
    } else {
      this.spawnRegularEncounter(level, random, spawn, eligibleTypes)
    }
  }

  /** Spawns the campaign boss and its escort tanks. */
  private spawnBossEncounter(
    level: number,
    random: RandomSource,
    spawn: Point,
    eligibleTypes: number[],
  ): void {
    const bossIndex = ENEMY_TYPES.findIndex((type) => type.boss)
    const bossPoint = this.arena.findOpenPoint(
      random,
      ENEMY_TYPES[bossIndex].radius + 18,
      520,
      spawn.x,
      spawn.y,
    )
    this.enemies.push(this.createEnemy(bossIndex, bossPoint.x, bossPoint.y, random, true, true))
    const escortCount = Math.min(4, 1 + Math.floor(level / 10))
    for (let index = 0; index < escortCount; index += 1) {
      const typeIndex = eligibleTypes[randomInt(random, 0, eligibleTypes.length - 1)]
      const point = this.arena.findOpenPoint(
        random,
        ENEMY_TYPES[typeIndex].radius + 8,
        390,
        spawn.x,
        spawn.y,
      )
      this.enemies.push(this.createEnemy(typeIndex, point.x, point.y, random, index === 0))
    }
  }

  /** Spawns a regular wave with level-specific guaranteed enemy roles. */
  private spawnRegularEncounter(
    level: number,
    random: RandomSource,
    spawn: Point,
    eligibleTypes: number[],
  ): void {
    const enemyCount = Math.min(100, 3 + Math.floor(level * 1.62))
    const guaranteedTypes = [ENEMY_TYPES.findIndex((type) => type.weapon === 'pulse')]
    if (level >= 3) guaranteedTypes.push(ENEMY_TYPES.findIndex((type) => type.weapon === 'mortar'))
    if (level >= 6)
      guaranteedTypes.push(ENEMY_TYPES.findIndex((type) => type.weapon === 'mineLayer'))
    if (level >= 7) guaranteedTypes.push(ENEMY_TYPES.findIndex((type) => type.weapon === 'repair'))

    for (let index = 0; index < enemyCount; index += 1) {
      const typeIndex =
        guaranteedTypes[index] ?? eligibleTypes[randomInt(random, 0, eligibleTypes.length - 1)]
      const point = this.arena.findOpenPoint(
        random,
        ENEMY_TYPES[typeIndex].radius + 8,
        420,
        spawn.x,
        spawn.y,
      )
      const forceElite = level >= 2 && index === guaranteedTypes.length
      this.enemies.push(this.createEnemy(typeIndex, point.x, point.y, random, forceElite))
    }
  }

  /** Tests whether a circle overlaps the visible camera area. */
  public isCircleVisible(x: number, y: number, radius = 0, margin = 70): boolean {
    return this.arena.isCircleVisible(x, y, radius, margin, {
      x: this.cameraX,
      y: this.cameraY,
      w: this.viewWidth,
      h: this.viewHeight,
    })
  }

  /** Tests whether a rectangle overlaps the visible camera area. */
  public isRectVisible(rectangle: Rectangle, margin = 70): boolean {
    return this.arena.isRectVisible(rectangle, margin, {
      x: this.cameraX,
      y: this.cameraY,
      w: this.viewWidth,
      h: this.viewHeight,
    })
  }

  /** Performs the update gadget buttons operation. */
  private updateGadgetButtons(): void {
    gadgetButtons.forEach((button, index) => {
      const count = this.gadgetCharges[index] || 0
      const label = button.querySelector('small')
      if (label) label.textContent = `×${count}`
      button.disabled = count <= 0
    })
  }

  /** Deploy a mine, stasis field, or temporary laser barrier. */
  private deployGadget(id: string): boolean {
    const index = GADGETS.findIndex((gadget) => gadget.id === id)
    if (index < 0 || !this.running || this.paused || this.player.deadTimer > 0) return false
    if (this.gadgetCharges[index] <= 0) {
      this.showToast(`${GADGETS[index].name} · EMPTY`)
      return false
    }
    const p = this.player
    this.gadgetCharges[index] -= 1
    if (id === 'mine') {
      this.playerTraps.push({
        kind: 'mine',
        x: p.x,
        y: p.y,
        radius: 18,
        trigger: 88,
        splash: 122,
        damage: 105,
        arm: 0.45,
        life: 30,
        phase: 0,
        angle: 0,
        halfLength: 0,
        tick: 0,
      })
    } else if (id === 'stasis') {
      const x = clamp(p.x + Math.cos(p.turretAngle) * 115, 80, this.worldWidth - 80)
      const y = clamp(p.y + Math.sin(p.turretAngle) * 115, 80, this.worldHeight - 80)
      this.playerTraps.push({
        kind: 'stasis',
        x,
        y,
        radius: 158,
        life: 8.5,
        phase: 0,
        trigger: 0,
        splash: 0,
        damage: 0,
        arm: 0,
        angle: 0,
        halfLength: 0,
        tick: 0,
      })
    } else {
      const x = clamp(p.x + Math.cos(p.turretAngle) * 105, 100, this.worldWidth - 100)
      const y = clamp(p.y + Math.sin(p.turretAngle) * 105, 100, this.worldHeight - 100)
      this.playerTraps.push({
        kind: 'barrier',
        x,
        y,
        angle: p.turretAngle + Math.PI * 0.5,
        halfLength: 105,
        life: 7.5,
        tick: 0,
        phase: 0,
        radius: 0,
        trigger: 0,
        splash: 0,
        damage: 0,
        arm: 0,
      })
    }
    this.effects.spawnExplosion(p.x, p.y, GADGETS[index].color, 10)
    this.audio.pickup()
    this.showToast(`${GADGETS[index].name} DEPLOYED`)
    this.updateGadgetButtons()
    return true
  }

  /** Simulate player traps, enemy mines, and barrier projectile interception. */
  private updateTraps(dt: number): void {
    for (let i = this.playerTraps.length - 1; i >= 0; i -= 1) {
      const trap = this.playerTraps[i]
      if (this.updatePlayerTrap(trap, dt)) this.playerTraps.splice(i, 1)
    }

    this.updateEnemyMines(dt)
  }

  /** Updates one player trap and reports whether it has expired or detonated. */
  private updatePlayerTrap(trap: PlayerTrap, dt: number): boolean {
    trap.life -= dt
    trap.phase += dt
    trap.arm = Math.max(0, trap.arm - dt)
    if (trap.life <= 0) return true
    if (trap.kind === 'mine' && trap.arm <= 0) return this.tryDetonatePlayerMine(trap)
    if (trap.kind === 'barrier') this.updateBarrierTrap(trap, dt)
    return false
  }

  /** Detonates an armed player mine when an enemy enters its trigger radius. */
  private tryDetonatePlayerMine(trap: PlayerTrap): boolean {
    const triggered = this.enemies.some(
      (enemy) =>
        distanceSquared(trap.x, trap.y, enemy.x, enemy.y) <= (trap.trigger + enemy.radius) ** 2,
    )
    if (!triggered) return false

    const radiusSquared = trap.splash * trap.splash
    for (const enemy of this.enemies) {
      const distanceToMine = distanceSquared(trap.x, trap.y, enemy.x, enemy.y)
      if (distanceToMine > radiusSquared) continue
      const falloff = 1 - Math.sqrt(distanceToMine) / trap.splash
      this.damageEnemy(enemy, trap.damage * (0.45 + falloff * 0.55), {
        sourceX: trap.x,
        sourceY: trap.y,
        weaponIndex: -1,
        sourceType: 'trap',
        ricocheted: false,
        critical: false,
      })
    }
    this.effects.spawnExplosion(trap.x, trap.y, '#ffca6b', 30)
    this.audio.explosion(1)
    return true
  }

  /** Blocks enemy projectiles and periodically damages tanks crossing a barrier. */
  private updateBarrierTrap(trap: PlayerTrap, dt: number): void {
    trap.tick -= dt
    const deltaX = Math.cos(trap.angle) * trap.halfLength
    const deltaY = Math.sin(trap.angle) * trap.halfLength
    const endpoints = [trap.x - deltaX, trap.y - deltaY, trap.x + deltaX, trap.y + deltaY] as const
    for (let index = this.bullets.length - 1; index >= 0; index -= 1) {
      const bullet = this.bullets[index]
      if (bullet.owner !== 'enemy') continue
      if (pointSegmentDistanceSquared(bullet.x, bullet.y, ...endpoints) > (bullet.radius + 7) ** 2)
        continue
      this.effects.spawnImpact(bullet.x, bullet.y, '#67efff', 7)
      this.removeBullet(index)
    }
    if (trap.tick > 0) return

    trap.tick = 0.22
    for (const enemy of this.enemies) {
      if (pointSegmentDistanceSquared(enemy.x, enemy.y, ...endpoints) > (enemy.radius + 8) ** 2)
        continue
      this.damageEnemy(enemy, 18, {
        sourceX: trap.x,
        sourceY: trap.y,
        weaponIndex: -1,
        sourceType: 'barrier',
        ricocheted: false,
        critical: false,
      })
    }
  }

  /** Ages enemy mines and detonates those triggered by the player. */
  private updateEnemyMines(dt: number): void {
    for (let i = this.enemyMines.length - 1; i >= 0; i -= 1) {
      const mine = this.enemyMines[i]
      mine.life -= dt
      mine.arm -= dt
      if (mine.life <= 0) {
        this.enemyMines.splice(i, 1)
        continue
      }
      const p = this.player
      if (
        mine.arm <= 0 &&
        p.deadTimer <= 0 &&
        distanceSquared(mine.x, mine.y, p.x, p.y) <= (mine.trigger + p.radius) ** 2
      ) {
        this.damagePlayer(mine.damage)
        this.effects.spawnExplosion(mine.x, mine.y, '#ff765f', 22)
        this.audio.explosion(0.8)
        this.enemyMines.splice(i, 1)
      }
    }
  }

  /** Performs the create enemy operation. */
  private createEnemy(
    typeIndex: number,
    x: number,
    y: number,
    random: RandomSource,
    forceElite = false,
    forceBoss = false,
  ): Enemy {
    const type = ENEMY_TYPES[typeIndex]
    const difficulty = 1 + Math.min(0.65, (this.level - 1) * 0.035)
    const eliteChance = Math.min(0.28, 0.075 + this.level * 0.012)
    const boss = forceBoss || Boolean(type.boss)
    const elite = !boss && (forceElite || (this.level >= 2 && random() < eliteChance))
    let hpMultiplier = 1
    if (boss) hpMultiplier = 1 + Math.min(0.8, this.level * 0.035)
    else if (elite) hpMultiplier = 1.75
    let speedMultiplier = 1
    let damageMultiplier = 1
    let fireRateMultiplier = 1
    if (boss) {
      damageMultiplier = 1.3
      fireRateMultiplier = 0.9
    } else if (elite) {
      speedMultiplier = 1.12
      damageMultiplier = 1.35
      fireRateMultiplier = 0.72
    }
    const maxHealth = Math.round(type.hp * difficulty * hpMultiplier)
    const initialAngle = randomRange(random, -Math.PI, Math.PI)
    return {
      typeIndex,
      x,
      y,
      radius: type.radius * (elite ? 1.08 : 1),
      health: maxHealth,
      maxHealth,
      bodyAngle: initialAngle,
      turretAngle: 0,
      fireCooldown: randomRange(random, 0.3, type.fireRate + 0.5),
      decisionTimer: randomRange(random, 0.15, 0.6),
      steerAngle: initialAngle,
      orbitDirection: random() < 0.5 ? -1 : 1,
      flash: 0,
      dead: false,
      elite,
      boss,
      speedMultiplier,
      damageMultiplier,
      fireRateMultiplier,
      recoil: 0,
      trackTimer: random() * 0.12,
      lastHit: null,
      cloakTimer: random() * 2,
      cloakAlpha: 1,
      mineTimer: 1 + random() * 2,
      repairTimer: 0.5 + random(),
      stunTimer: 0,
      hazardCooldown: 0,
      bossPhase: 1,
      spawnedWave2: false,
      spawnedWave3: false,
      stuckTimer: 0,
      recoveryTimer: 0,
      recoveryAngle: initialAngle,
      collisionTimer: 0,
    }
  }

  /** Select a bonus using the weights in BONUS_TYPES. */
  private pickBonusIndex(random: RandomSource): number {
    const totalWeight = BONUS_TYPES.reduce((sum, bonus) => sum + bonus.weight, 0)
    let roll = random() * totalWeight
    for (let i = 0; i < BONUS_TYPES.length; i += 1) {
      roll -= BONUS_TYPES[i].weight
      if (roll <= 0) return i
    }
    return BONUS_TYPES.length - 1
  }

  /** Add one obstacle-free mystery crate, capped to keep collision work tiny. */
  private spawnBonusBox(random: RandomSource = randomUnit): boolean {
    const maxBoxes = Math.min(12, 6 + Math.floor(this.level / 2))
    if (this.bonusBoxes.length >= maxBoxes) return false

    for (let attempt = 0; attempt < 80; attempt += 1) {
      const point = this.arena.findOpenPoint(random, 24, 130, this.player.x, this.player.y)
      const blockedByTank = this.enemies.some(
        (enemy) => distanceSquared(point.x, point.y, enemy.x, enemy.y) < (enemy.radius + 72) ** 2,
      )
      const blockedByBox = this.bonusBoxes.some(
        (box) => distanceSquared(point.x, point.y, box.x, box.y) < 90 ** 2,
      )
      const blockedByUpgrade = this.upgradeBoxes.some(
        (box) => distanceSquared(point.x, point.y, box.x, box.y) < 96 ** 2,
      )
      if (blockedByTank || blockedByBox || blockedByUpgrade) continue

      this.bonusBoxes.push({
        x: point.x,
        y: point.y,
        size: 22,
        bonusIndex: this.pickBonusIndex(random),
        phase: random() * TAU,
      })
      return true
    }
    return false
  }

  /** Spawn a guaranteed bonus crate at a defeated elite's position. */
  private spawnBonusBoxAt(x: number, y: number, random: RandomSource = randomUnit): boolean {
    const bonusIndex = this.pickBonusIndex(random)
    this.bonusBoxes.push({ x, y, size: 22, bonusIndex, phase: random() * TAU })
    return true
  }

  /** Update timed crate spawning and player/crate contact collection. */
  private updateBonuses(dt: number): void {
    this.bonusSpawnTimer -= dt
    if (this.bonusSpawnTimer <= 0) {
      this.spawnBonusBox(randomUnit)
      this.bonusSpawnTimer = 5.5 + randomUnit() * 4
    }

    const p = this.player
    if (p.deadTimer > 0) return
    for (let i = this.bonusBoxes.length - 1; i >= 0; i -= 1) {
      const box = this.bonusBoxes[i]
      if (p.magnetTimer > 0) {
        const dx = p.x - box.x
        const dy = p.y - box.y
        const dist = Math.hypot(dx, dy) || 1
        if (dist < 360) {
          box.x += (dx / dist) * 190 * dt
          box.y += (dy / dist) * 190 * dt
        }
      }
      const collectRadius = p.radius + box.size
      if (distanceSquared(p.x, p.y, box.x, box.y) <= collectRadius * collectRadius) {
        this.collectBonusBox(i, 'COLLECTED')
      }
    }
    for (let i = this.upgradeBoxes.length - 1; i >= 0; i -= 1) {
      const box = this.upgradeBoxes[i]
      const collectRadius = p.radius + box.size
      if (distanceSquared(p.x, p.y, box.x, box.y) <= collectRadius * collectRadius) {
        this.collectUpgradeBox(i, 'COLLECTED')
      }
    }
  }

  /**
   * Remove a crate and apply its predetermined random bonus.
   * @param {number} index
   * @param {'COLLECTED'|'CRATE SHOT'|'BLAST OPENED'} source
   */
  private collectBonusBox(index: number, source: BonusCollectionSource): void {
    const box = this.bonusBoxes[index]
    if (!box) return
    const bonus = BONUS_TYPES[box.bonusIndex]
    const last = this.bonusBoxes.pop()
    if (last && index < this.bonusBoxes.length) this.bonusBoxes[index] = last

    const p = this.player
    switch (bonus.id) {
      case 'repair': {
        const before = p.health
        p.health = Math.min(p.maxHealth, p.health + 48)
        if (p.health === before) this.score += 250
        break
      }
      case 'shield':
        p.invulnerable = Math.max(p.invulnerable, 6)
        break
      case 'directional':
        p.directionalShieldTimer = Math.max(p.directionalShieldTimer, 14)
        break
      case 'rapid':
        p.rapidTimer = Math.max(p.rapidTimer, 9)
        break
      case 'turbo':
        p.turboTimer = Math.max(p.turboTimer, 9)
        break
      case 'damage':
        p.damageTimer = Math.max(p.damageTimer, 9)
        break
      case 'armor':
        p.armorTimer = Math.max(p.armorTimer, 12)
        break
      case 'vampire':
        p.vampireTimer = Math.max(p.vampireTimer, 12)
        break
      case 'magnet':
        p.magnetTimer = Math.max(p.magnetTimer, 14)
        break
      case 'timewarp':
        p.timeWarpTimer = Math.max(p.timeWarpTimer, 10)
        break
      case 'multishot':
        p.multiShotTimer = Math.max(p.multiShotTimer, 10)
        break
      case 'gadget':
        this.gadgetCharges = this.gadgetCharges.map((count, gadgetIndex) =>
          Math.min(count + 2, GADGETS[gadgetIndex].maxCharges + 4),
        )
        this.updateGadgetButtons()
        break
      case 'emp':
        this.enemies.forEach((enemy) => {
          enemy.stunTimer = Math.max(enemy.stunTimer, enemy.boss ? 2.6 : 4.5)
        })
        break
      case 'combo':
        p.comboLockTimer = Math.max(p.comboLockTimer, 12)
        this.comboTimer = Math.max(this.comboTimer, 12)
        break
      case 'score':
        this.score += 500 + this.level * 50
        break
      case 'weapon': {
        let nextWeapon = randomInt(randomUnit, 0, WEAPONS.length - 1)
        if (nextWeapon === p.weaponIndex) nextWeapon = (nextWeapon + 1) % WEAPONS.length
        this.selectWeapon(nextWeapon)
        break
      }
      default:
        break
    }

    this.score += 75
    this.effects.spawnExplosion(box.x, box.y, bonus.color, 18)
    this.audio.pickup()
    this.showToast(`${bonus.name} · ${source}`)
    this.bonusSpawnTimer = Math.min(this.bonusSpawnTimer, 4.5)
    this.updateHud(true)
  }

  /** Release every pooled item in an active array. */
  private clearPooledArray<T extends object>(array: T[], pool: ObjectPool<T>): void {
    while (array.length > 0) {
      const item = array.pop()
      if (item) pool.release(item)
    }
  }

  /** Performs the update operation. */
  public update(dt: number): void {
    if (!this.running || this.paused) return
    this.toastTimer = Math.max(0, this.toastTimer - dt)
    if (this.toastTimer === 0) toast.classList.remove('is-visible')
    this.screenShake = Math.max(0, this.screenShake - dt * 16)
    this.flashAlpha = Math.max(0, this.flashAlpha - dt * 2.8)

    if (this.comboTimer > 0 && this.player.comboLockTimer <= 0) {
      this.comboTimer = Math.max(0, this.comboTimer - dt)
      if (this.comboTimer === 0) {
        this.comboCount = 0
        this.comboMultiplier = 1
      }
    }
    this.multiKillTimer = Math.max(0, this.multiKillTimer - dt)
    if (this.multiKillTimer === 0) this.multiKillCount = 0
    const slowMotionActive = this.slowMoTimer > 0
    this.slowMoTimer = Math.max(0, this.slowMoTimer - dt)
    const simDt = slowMotionActive ? dt * 0.38 : dt

    this.updatePlayer(simDt)
    this.updateBonuses(simDt)
    this.updateTraps(simDt)
    this.updateEnemies(simDt)
    this.updateBullets(simDt)
    this.effects.updateParticles(simDt)
    this.effects.updateSurfaceEffects(simDt)
    this.updateCamera(simDt)
    this.checkLevelComplete(simDt)
    this.updateHud(false)
  }

  /** Fade capped track-mark data while scorch marks persist for the level. */
  private updatePlayer(dt: number): void {
    const p = this.player
    p.fireCooldown = Math.max(0, p.fireCooldown - dt)
    p.invulnerable = Math.max(0, p.invulnerable - dt)
    p.rapidTimer = Math.max(0, p.rapidTimer - dt)
    p.turboTimer = Math.max(0, p.turboTimer - dt)
    p.damageTimer = Math.max(0, p.damageTimer - dt)
    p.armorTimer = Math.max(0, p.armorTimer - dt)
    p.vampireTimer = Math.max(0, p.vampireTimer - dt)
    p.magnetTimer = Math.max(0, p.magnetTimer - dt)
    p.directionalShieldTimer = Math.max(0, p.directionalShieldTimer - dt)
    p.timeWarpTimer = Math.max(0, p.timeWarpTimer - dt)
    p.multiShotTimer = Math.max(0, p.multiShotTimer - dt)
    p.comboLockTimer = Math.max(0, p.comboLockTimer - dt)
    p.hazardCooldown = Math.max(0, p.hazardCooldown - dt)
    p.recoil = Math.max(0, p.recoil - dt * 44)
    p.trackTimer -= dt
    p.vx = 0
    p.vy = 0

    if (p.deadTimer > 0) {
      p.deadTimer -= dt
      if (p.deadTimer <= 0) this.respawnPlayer()
      return
    }

    const terrain = this.arena.getTerrainEffect(p.x, p.y)
    const movement = this.input.getMovement()
    const movementLength = Math.hypot(movement.x, movement.y)
    if (movementLength > 0.05) {
      const moveAngle = Math.atan2(movement.y, movement.x)
      p.bodyAngle = turnToward(p.bodyAngle, moveAngle, 8.5 * terrain.turn * dt)
      const speedMultiplier = (p.turboTimer > 0 ? 1.42 : 1) * terrain.speed
      p.vx = movement.x * p.speed * speedMultiplier
      p.vy = movement.y * p.speed * speedMultiplier
      p.x += (p.vx + terrain.pushX) * dt
      p.y += (p.vy + terrain.pushY) * dt
      this.arena.resolveTankWorld(p)
      if (p.trackTimer <= 0) {
        this.effects.spawnTrackMarks(p, 'rgba(7, 13, 17, 0.38)')
        p.trackTimer = 0.075
      }
    } else if (terrain.pushX || terrain.pushY) {
      p.x += terrain.pushX * dt
      p.y += terrain.pushY * dt
      this.arena.resolveTankWorld(p)
    }
    if (terrain.damage > 0 && p.hazardCooldown <= 0) {
      p.hazardCooldown = 0.5
      this.damagePlayer(terrain.damage * 0.5)
    }

    p.turretAngle = turnToward(
      p.turretAngle,
      this.input.getAimAngle(p, this.cameraX, this.cameraY),
      12 * dt,
    )

    if (this.input.shouldFire()) this.firePlayerWeapon()
  }

  /** Score several look-ahead headings and choose one that remains open. */
  private chooseEnemySteering(enemy: Enemy, desiredAngle: number): number {
    const margin = enemy.radius + 62
    const nearLeft = enemy.x < margin
    const nearRight = enemy.x > this.worldWidth - margin
    const nearTop = enemy.y < margin
    const nearBottom = enemy.y > this.worldHeight - margin
    const inCorner = (nearLeft || nearRight) && (nearTop || nearBottom)
    const centerAngle = Math.atan2(
      this.worldHeight * 0.5 - enemy.y,
      this.worldWidth * 0.5 - enemy.x,
    )
    if (inCorner) desiredAngle = lerpAngle(desiredAngle, centerAngle, 0.86)

    const offsets = [0, 0.42, -0.42, 0.82, -0.82, 1.22, -1.22, Math.PI]
    let bestAngle = desiredAngle
    let bestScore = -Infinity
    for (let i = 0; i < offsets.length; i += 1) {
      const angle = desiredAngle + offsets[i] * (i === 0 ? 1 : enemy.orbitDirection)
      let score = Math.cos(normalizeAngle(angle - desiredAngle)) * 1.35
      const probes = [44, 82, 126]
      for (const [probeIndex, distance] of probes.entries()) {
        const blocked = this.arena.isBlocked(
          enemy.x + Math.cos(angle) * distance,
          enemy.y + Math.sin(angle) * distance,
          enemy.radius + 3,
        )
        score += blocked ? -(3.6 - probeIndex * 0.7) : 1.15 + probeIndex * 0.42
      }
      score += Math.cos(normalizeAngle(angle - centerAngle)) * (inCorner ? 2.8 : 0.16)
      if (score > bestScore) {
        bestScore = score
        bestAngle = angle
      }
    }
    return bestAngle
  }

  /** Find a nearby rescue point after steering has failed for several seconds. */
  private findNearbyOpenPoint(enemy: Enemy): SteeringPoint | null {
    const baseAngle = Math.atan2(this.worldHeight * 0.5 - enemy.y, this.worldWidth * 0.5 - enemy.x)
    const radii = [76, 112, 154, 208]
    for (const radius of radii) {
      for (let sample = 0; sample < 16; sample += 1) {
        const offset = ((sample + 1) >> 1) * 0.34 * (sample % 2 ? -1 : 1) * enemy.orbitDirection
        const angle = baseAngle + offset
        const x = clamp(
          enemy.x + Math.cos(angle) * radius,
          enemy.radius + 18,
          this.worldWidth - enemy.radius - 18,
        )
        const y = clamp(
          enemy.y + Math.sin(angle) * radius,
          enemy.radius + 18,
          this.worldHeight - enemy.radius - 18,
        )
        if (!this.arena.isBlocked(x, y, enemy.radius + 8)) return { x, y, angle }
      }
    }
    return null
  }

  /** Performs the fire player weapon operation. */
  private firePlayerWeapon(): void {
    const p = this.player
    const weapon = this.getEffectiveWeapon(p.weaponIndex)
    if (p.deadTimer > 0 || p.fireCooldown > 0) return
    p.fireCooldown = weapon.cooldown * (p.rapidTimer > 0 ? 0.52 : 1)

    // Mouse supplies an exact world target. Keyboard-only and touch play use
    // the current turret direction so arcing weapons keep a sensible range.
    const hasPointerTarget = this.input.mouseSeen && !this.input.aimTouch.active
    const targetX = hasPointerTarget
      ? this.input.mouseX + this.cameraX
      : p.x + Math.cos(p.turretAngle) * 520
    const targetY = hasPointerTarget
      ? this.input.mouseY + this.cameraY
      : p.y + Math.sin(p.turretAngle) * 520
    const count = weapon.count + (p.multiShotTimer > 0 ? 1 : 0)
    for (let index = 0; index < count; index += 1) {
      this.spawnPlayerProjectile(weapon, index, count, targetX, targetY)
    }
    this.applyPlayerWeaponFeedback(weapon)
  }

  /** Spawns one projectile from the player's current multishot volley. */
  private spawnPlayerProjectile(
    weapon: EffectiveWeapon,
    index: number,
    count: number,
    targetX: number,
    targetY: number,
  ): void {
    const player = this.player
    const centeredIndex = index - (count - 1) * 0.5
    const spread =
      count > 1
        ? centeredIndex * (weapon.spread / Math.max(1, count - 1)) * 2
        : (randomUnit() - 0.5) * weapon.spread
    const angle = player.turretAngle + spread
    const muzzle = player.radius + 16
    const aimDistance = clamp(Math.hypot(targetX - player.x, targetY - player.y), 120, 660)
    const life = weapon.type === 'mortar' ? aimDistance / weapon.speed : weapon.life
    const critical = randomUnit() < weapon.critChance
    this.spawnBullet({
      x: player.x + Math.cos(angle) * muzzle,
      y: player.y + Math.sin(angle) * muzzle,
      angle,
      speed: weapon.speed,
      damage:
        weapon.damage * (player.damageTimer > 0 ? 1.6 : 1) * (critical ? weapon.critMultiplier : 1),
      radius: weapon.radius,
      life,
      owner: 'player',
      color: weapon.color,
      type: weapon.type,
      bounce: weapon.bounce,
      splash: weapon.splash || 0,
      turnRate: weapon.turnRate || 0,
      targetX,
      targetY,
      ignoresWalls: weapon.type === 'mortar',
      sourceX: player.x,
      sourceY: player.y,
      weaponIndex: player.weaponIndex,
      ricocheted: false,
      critical,
      sourceType: 'weapon',
      pierce: weapon.pierce || 0,
      chain: weapon.chain || 0,
      cluster: weapon.cluster || 0,
    })
  }

  /** Applies recoil, audiovisual feedback, and camera shake for a player shot. */
  private applyPlayerWeaponFeedback(weapon: EffectiveWeapon): void {
    const p = this.player
    p.recoil = 7
    if (weapon.type === 'mortar') p.recoil = 13
    else if (weapon.type === 'rocket') p.recoil = 10
    this.flashAlpha = Math.max(this.flashAlpha, weapon.type === 'mortar' ? 0.14 : 0.045)
    this.effects.spawnMuzzleFlash(
      p.x,
      p.y,
      p.turretAngle,
      weapon.color,
      weapon.type === 'mortar' ? 10 : 6,
    )
    this.audio.playerShot(p.weaponIndex)
    this.screenShake = Math.max(this.screenShake, weapon.type === 'mortar' ? 5 : 2.2)
  }

  /** Performs the update enemies operation. */
  private updateEnemies(dt: number): void {
    const p = this.player
    const globalEnemyScale = p.timeWarpTimer > 0 ? 0.58 : 1
    for (let i = this.enemies.length - 1; i >= 0; i -= 1) {
      const enemy = this.enemies[i]
      if (enemy.dead) continue
      const type = ENEMY_TYPES[enemy.typeIndex]
      this.updateEnemyTimers(enemy, type, dt)
      if (enemy.boss) this.updateBossPhase(enemy)

      if (type.weapon === 'repair') this.updateRepairDrone(enemy, dt)

      const dx = p.x - enemy.x
      const dy = p.y - enemy.y
      const dist = Math.max(1, Math.hypot(dx, dy))
      const targetAngle = Math.atan2(dy, dx)
      if (type.weapon !== 'repair')
        enemy.turretAngle = turnToward(
          enemy.turretAngle,
          targetAngle,
          (type.turretSpeed || 4.2) * dt,
        )

      this.updateEnemySteering(enemy, type, targetAngle, dist)

      const terrain = this.arena.getTerrainEffect(enemy.x, enemy.y)
      this.moveEnemy(enemy, type, terrain, dist, globalEnemyScale, dt)
      this.applyEnemyTerrainDamage(enemy, terrain)
      if (enemy.dead) continue
      this.updateEnemyTracks(enemy)
      this.separateTanks(enemy, p)

      if (type.weapon === 'mineLayer') this.updateMineLayer(enemy, type, dist, dt)
      this.tryFireEnemyWeapon(enemy, type, targetAngle, dist)
    }
  }

  /** Ages enemy cooldowns and updates cloaking visibility. */
  private updateEnemyTimers(enemy: Enemy, type: EnemyType, dt: number): void {
    enemy.stunTimer = Math.max(0, enemy.stunTimer - dt)
    enemy.hazardCooldown = Math.max(0, enemy.hazardCooldown - dt)
    enemy.fireCooldown -= dt
    enemy.decisionTimer -= dt
    enemy.flash = Math.max(0, enemy.flash - dt * 7)
    enemy.recoil = Math.max(0, enemy.recoil - dt * 40)
    enemy.trackTimer -= dt
    enemy.recoveryTimer = Math.max(0, enemy.recoveryTimer - dt)
    if (type.weapon !== 'cloakPulse') {
      enemy.cloakAlpha = 1
      return
    }
    enemy.cloakTimer = (enemy.cloakTimer + dt) % 6.2
    enemy.cloakAlpha = enemy.cloakTimer > 1.35 && enemy.cloakTimer < 4.9 ? 0.2 : 1
  }

  /** Advances boss phases and creates their one-time reinforcement waves. */
  private updateBossPhase(enemy: Enemy): void {
    const ratio = enemy.health / enemy.maxHealth
    enemy.bossPhase = 3
    if (ratio > 0.66) enemy.bossPhase = 1
    else if (ratio > 0.33) enemy.bossPhase = 2
    if (ratio <= 0.66 && !enemy.spawnedWave2) {
      enemy.spawnedWave2 = true
      this.spawnBossReinforcements(enemy, 3)
      this.showToast('BOSS PHASE 2 · REINFORCEMENTS')
    }
    if (ratio <= 0.33 && !enemy.spawnedWave3) {
      enemy.spawnedWave3 = true
      this.spawnBossReinforcements(enemy, 4)
      this.showToast('BOSS PHASE 3 · OVERDRIVE')
      this.slowMoTimer = Math.max(this.slowMoTimer, 0.25)
    }
  }

  /** Steers a repair drone toward the most damaged nearby ally and heals it. */
  private updateRepairDrone(enemy: Enemy, dt: number): void {
    enemy.repairTimer -= dt
    let patient: Enemy | null = null
    let greatestDamage = 0
    for (const ally of this.enemies) {
      if (ally === enemy || ally.dead) continue
      const missingHealth = ally.maxHealth - ally.health
      const nearby = distanceSquared(enemy.x, enemy.y, ally.x, ally.y) < 460 ** 2
      if (nearby && missingHealth > greatestDamage) {
        greatestDamage = missingHealth
        patient = ally
      }
    }
    if (!patient) return
    const patientAngle = Math.atan2(patient.y - enemy.y, patient.x - enemy.x)
    enemy.steerAngle = patientAngle + enemy.orbitDirection * 0.7
    enemy.turretAngle = turnToward(enemy.turretAngle, patientAngle, 5 * dt)
    if (
      enemy.repairTimer > 0 ||
      distanceSquared(enemy.x, enemy.y, patient.x, patient.y) >= 250 ** 2
    )
      return
    patient.health = Math.min(patient.maxHealth, patient.health + (patient.boss ? 18 : 28))
    enemy.repairTimer = 1.25
    this.effects.spawnImpact(patient.x, patient.y, '#75ffd1', 9)
  }

  /** Recomputes an enemy's desired heading when its decision timer expires. */
  private updateEnemySteering(
    enemy: Enemy,
    type: EnemyType,
    targetAngle: number,
    distance: number,
  ): void {
    if (enemy.decisionTimer > 0 && enemy.recoveryTimer <= 0) return
    enemy.decisionTimer = enemy.boss ? 0.13 : 0.18 + randomUnit() * 0.3
    const preferredAngle = this.getEnemyMoveAngle(enemy, type, targetAngle, distance)
    const moveAngle = this.chooseEnemySteering(enemy, preferredAngle)
    if (type.weapon !== 'repair' || enemy.recoveryTimer > 0 || !Number.isFinite(enemy.steerAngle)) {
      enemy.steerAngle = moveAngle
    }
  }

  /** Selects a preferred heading for an enemy behavior and distance band. */
  private getEnemyMoveAngle(
    enemy: Enemy,
    type: EnemyType,
    targetAngle: number,
    distance: number,
  ): number {
    if (enemy.recoveryTimer > 0) return enemy.recoveryAngle
    if (type.behavior === 'orbit') return this.getOrbitMoveAngle(enemy, type, targetAngle, distance)
    if (type.behavior === 'kite' || type.behavior === 'support') {
      if (distance < type.preferred * 0.82) return targetAngle + Math.PI
      if (distance < type.preferred * 1.18)
        return targetAngle + enemy.orbitDirection * Math.PI * 0.5
      return targetAngle
    }
    if (type.behavior === 'boss') {
      return distance > type.preferred
        ? targetAngle
        : targetAngle + enemy.orbitDirection * Math.PI * 0.45
    }
    if (distance < type.preferred * 0.72) return targetAngle + Math.PI
    if (distance < type.preferred * 1.08) return targetAngle + enemy.orbitDirection * Math.PI * 0.5
    return targetAngle
  }

  /** Selects a circling heading while correcting excessive or insufficient range. */
  private getOrbitMoveAngle(
    enemy: Enemy,
    type: EnemyType,
    targetAngle: number,
    distance: number,
  ): number {
    let angle = targetAngle + enemy.orbitDirection * Math.PI * 0.46
    if (distance > type.preferred * 1.25) angle = lerpAngle(angle, targetAngle, 0.58)
    if (distance < type.preferred * 0.68) angle = targetAngle + Math.PI
    return angle
  }

  /** Moves an unstunned enemy and updates its stuck-state recovery counters. */
  private moveEnemy(
    enemy: Enemy,
    type: EnemyType,
    terrain: TerrainEffect,
    distance: number,
    globalEnemyScale: number,
    dt: number,
  ): void {
    if (enemy.stunTimer > 0) return
    const beforeX = enemy.x
    const beforeY = enemy.y
    enemy.bodyAngle = turnToward(enemy.bodyAngle, enemy.steerAngle, 5.5 * terrain.turn * dt)
    const speedScale = distance < 100 ? 0.25 : 1
    const speed =
      type.speed *
      enemy.speedMultiplier *
      speedScale *
      terrain.speed *
      globalEnemyScale *
      this.getEnemyStasisScale(enemy)
    enemy.x += (Math.cos(enemy.bodyAngle) * speed + terrain.pushX) * dt
    enemy.y += (Math.sin(enemy.bodyAngle) * speed + terrain.pushY) * dt
    const collided = this.arena.resolveTankWorld(enemy)
    const moved = Math.hypot(enemy.x - beforeX, enemy.y - beforeY)
    const expected = Math.max(0.1, speed * dt)
    const isStuck = moved < Math.max(0.22, expected * 0.18)
    if (isStuck) {
      const collisionMultiplier = collided ? 2.1 : 1
      enemy.stuckTimer += dt * collisionMultiplier
    } else {
      enemy.stuckTimer = Math.max(0, enemy.stuckTimer - dt * 2.7)
    }
    enemy.collisionTimer = collided
      ? Math.min(2, enemy.collisionTimer + dt)
      : Math.max(0, enemy.collisionTimer - dt * 2)
    this.recoverStuckEnemy(enemy, type)
  }

  /** Returns the speed multiplier applied by an overlapping stasis field. */
  private getEnemyStasisScale(enemy: Enemy): number {
    const isInsideStasis = this.playerTraps.some(
      (trap) =>
        trap.kind === 'stasis' &&
        distanceSquared(enemy.x, enemy.y, trap.x, trap.y) <= (trap.radius + enemy.radius) ** 2,
    )
    return isInsideStasis ? 0.34 : 1
  }

  /** Reorients or safely relocates an enemy that cannot make progress. */
  private recoverStuckEnemy(enemy: Enemy, type: EnemyType): void {
    if (enemy.stuckTimer > 0.42 && enemy.recoveryTimer <= 0) {
      const centerAngle = Math.atan2(
        this.worldHeight * 0.5 - enemy.y,
        this.worldWidth * 0.5 - enemy.x,
      )
      enemy.orbitDirection *= -1
      enemy.recoveryAngle = this.chooseEnemySteering(
        enemy,
        centerAngle + enemy.orbitDirection * (0.28 + randomUnit() * 0.48),
      )
      enemy.recoveryTimer = 0.85 + randomUnit() * 0.55
      enemy.decisionTimer = 0
    }
    if (enemy.stuckTimer <= 2.15) return
    const rescue = this.findNearbyOpenPoint(enemy)
    if (rescue) {
      Object.assign(enemy, {
        x: rescue.x,
        y: rescue.y,
        bodyAngle: rescue.angle,
        steerAngle: rescue.angle,
        recoveryAngle: rescue.angle,
      })
      this.effects.spawnImpact(enemy.x, enemy.y, type.color, 5)
    }
    enemy.stuckTimer = 0
    enemy.collisionTimer = 0
    enemy.recoveryTimer = 0.9
  }

  /** Applies periodic arena-hazard damage to an enemy. */
  private applyEnemyTerrainDamage(enemy: Enemy, terrain: TerrainEffect): void {
    if (terrain.damage <= 0 || enemy.hazardCooldown > 0) return
    enemy.hazardCooldown = 0.65
    this.damageEnemy(enemy, terrain.damage * 0.42, {
      sourceX: enemy.x,
      sourceY: enemy.y,
      weaponIndex: -1,
      sourceType: 'hazard',
      critical: false,
      ricocheted: false,
    })
  }

  /** Emits enemy tread marks at an adaptive cadence. */
  private updateEnemyTracks(enemy: Enemy): void {
    if (enemy.trackTimer > 0 || enemy.stunTimer > 0) return
    const color = enemy.elite || enemy.boss ? 'rgba(255,210,91,0.25)' : 'rgba(0,0,0,0.27)'
    this.effects.spawnTrackMarks(enemy, color)
    enemy.trackTimer = enemy.boss ? 0.075 : 0.11
  }

  /** Drops a mine when a mine-layer is ready and near enough to the player. */
  private updateMineLayer(enemy: Enemy, type: EnemyType, distance: number, dt: number): void {
    enemy.mineTimer -= dt
    if (enemy.mineTimer > 0 || distance >= 760) return
    const profile = this.weapons.getEnemyWeaponProfile(enemy, type, this.level)
    this.enemyMines.push({
      x: enemy.x - Math.cos(enemy.bodyAngle) * enemy.radius,
      y: enemy.y - Math.sin(enemy.bodyAngle) * enemy.radius,
      arm: 0.8,
      life: 22,
      trigger: 68 * profile.splash,
      damage: (32 + this.level * 0.5) * profile.damage,
      phase: randomUnit() * TAU,
    })
    if (this.enemyMines.length > 28) this.enemyMines.shift()
    enemy.mineTimer = 2.7 + randomUnit() * 1.5
  }

  /** Fires an enemy weapon when range, aim, sight, and cooldown permit. */
  private tryFireEnemyWeapon(
    enemy: Enemy,
    type: EnemyType,
    targetAngle: number,
    distance: number,
  ): void {
    const firesOverWalls = type.weapon === 'mortar' || type.weapon === 'boss'
    const hasSight =
      this.player.deadTimer <= 0 &&
      (firesOverWalls || this.arena.hasLineOfSight(enemy.x, enemy.y, this.player.x, this.player.y))
    const aimError = Math.abs(normalizeAngle(enemy.turretAngle - targetAngle))
    const aimTolerance = firesOverWalls ? 0.24 : 0.13
    const inRange = distance >= (type.minRange || 0) && distance < (type.maxRange || 900)
    if (
      type.weapon === 'repair' ||
      enemy.stunTimer > 0 ||
      !hasSight ||
      aimError >= aimTolerance ||
      enemy.fireCooldown > 0 ||
      !inRange
    )
      return

    this.fireEnemyWeapon(enemy, type, targetAngle)
    const phaseRate = enemy.boss ? [1, 0.76, 0.56][enemy.bossPhase - 1] : 1
    const profile = this.weapons.getEnemyWeaponProfile(enemy, type, this.level)
    enemy.fireCooldown =
      type.fireRate *
      enemy.fireRateMultiplier *
      profile.cooldown *
      phaseRate *
      randomRange(randomUnit, 0.88, 1.18)
    if (type.weapon === 'cloakPulse') enemy.cloakTimer = 0
  }

  /** Spawn a small escort wave near a boss without placing tanks inside walls. */
  private spawnBossReinforcements(boss: Enemy, count: number): void {
    const random = randomUnit
    const eligible = ENEMY_TYPES.map((type, index) => ({ type, index })).filter(
      (entry) => !entry.type.boss && entry.type.unlockLevel <= this.level,
    )
    for (let i = 0; i < count; i += 1) {
      const entry = eligible[randomInt(random, 0, eligible.length - 1)]
      const point = this.arena.findOpenPoint(random, entry.type.radius + 8, 230, boss.x, boss.y)
      this.enemies.push(this.createEnemy(entry.index, point.x, point.y, random, false))
    }
  }

  /** Performs the separate tanks operation. */
  private separateTanks(a: Enemy, b: Player): void {
    if (b.deadTimer > 0) return
    const dx = a.x - b.x
    const dy = a.y - b.y
    const minDistance = a.radius + b.radius + 3
    const dist2 = dx * dx + dy * dy
    if (dist2 <= 0.001 || dist2 >= minDistance * minDistance) return
    const dist = Math.sqrt(dist2)
    const overlap = minDistance - dist
    a.x += (dx / dist) * overlap * 0.55
    a.y += (dy / dist) * overlap * 0.55
    b.x -= (dx / dist) * overlap * 0.45
    b.y -= (dy / dist) * overlap * 0.45
    this.arena.resolveTankWorld(a)
    this.arena.resolveTankWorld(b)
  }

  /** Performs the fire enemy weapon operation. */
  private fireEnemyWeapon(enemy: Enemy, type: EnemyType, baseAngle: number): void {
    const muzzle = enemy.radius + 14
    const profile = this.weapons.getEnemyWeaponProfile(enemy, type, this.level)
    const spawn = (angle: number, overrides: EnemyShotOverrides = {}): void => {
      this.spawnBullet({
        x: enemy.x + Math.cos(angle) * muzzle,
        y: enemy.y + Math.sin(angle) * muzzle,
        angle,
        speed: (overrides.speed ?? type.bulletSpeed) * profile.speed,
        damage: (overrides.damage ?? type.damage * enemy.damageMultiplier) * profile.damage,
        radius: (overrides.radius ?? 4) * (1 + (profile.splash - 1) * 0.16),
        life: (overrides.life ?? 2.6) * profile.life,
        owner: 'enemy',
        color: overrides.color ?? type.color,
        type: overrides.type ?? 'enemyShell',
        bounce: 0,
        splash: (overrides.splash ?? 0) * profile.splash,
        turnRate: (overrides.turnRate ?? 0) * profile.homing,
        targetX: overrides.targetX ?? this.player.x,
        targetY: overrides.targetY ?? this.player.y,
        ignoresWalls: overrides.ignoresWalls ?? false,
        enemyWeaponRank: profile.rank,
      })
    }

    const inaccurateAngle = baseAngle + (randomUnit() - 0.5) * type.accuracy * profile.accuracy
    if (type.weapon === 'boss') {
      this.fireBossWeapon(enemy, type, inaccurateAngle, spawn)
    } else if (type.weapon === 'triple') {
      spawn(inaccurateAngle - 0.13)
      spawn(inaccurateAngle)
      spawn(inaccurateAngle + 0.13)
    } else if (type.weapon === 'pulse' || type.weapon === 'cloakPulse') {
      spawn(inaccurateAngle, {
        radius: 3,
        life: 1.35,
        type: 'enemyPulse',
        color: '#8cffad',
      })
    } else if (type.weapon === 'mortar') {
      this.fireEnemyMortar(enemy, type, spawn)
    } else if (type.weapon === 'rocket') {
      spawn(inaccurateAngle, {
        speed: type.bulletSpeed,
        radius: 7,
        life: 3.4,
        type: 'enemyRocket',
        splash: 72,
        turnRate: 2.0,
      })
    } else if (type.weapon === 'sniper') {
      spawn(inaccurateAngle, { radius: 4.5, life: 1.8, type: 'sniper' })
    } else {
      spawn(inaccurateAngle)
    }
    enemy.recoil = 5
    if (type.weapon === 'mortar') enemy.recoil = 11
    else if (type.weapon === 'rocket') enemy.recoil = 8
    let flashSize = 4
    if (type.weapon === 'mortar') flashSize = 9
    else if (type.weapon === 'pulse') flashSize = 3
    this.effects.spawnMuzzleFlash(enemy.x, enemy.y, enemy.turretAngle, type.color, flashSize)
    this.audio.enemyShot(Math.hypot(enemy.x - this.player.x, enemy.y - this.player.y), type.weapon)
    if (type.weapon === 'mortar') this.screenShake = Math.max(this.screenShake, 3.5)
  }

  /** Fires the projectile pattern for the boss's current combat phase. */
  private fireBossWeapon(
    enemy: Enemy,
    type: EnemyType,
    angle: number,
    spawn: (angle: number, overrides?: EnemyShotOverrides) => void,
  ): void {
    if (enemy.bossPhase === 1) {
      for (let offset = -2; offset <= 2; offset += 1) {
        spawn(angle + offset * 0.12, { radius: 5.5, damage: type.damage * 0.9 })
      }
      return
    }
    if (enemy.bossPhase === 2) {
      for (let offset = -1; offset <= 1; offset += 1) {
        const targetX = clamp(
          this.player.x + this.player.vx * (0.45 + offset * 0.08) + offset * 95,
          50,
          this.worldWidth - 50,
        )
        const targetY = clamp(
          this.player.y + this.player.vy * 0.45 - offset * 55,
          50,
          this.worldHeight - 50,
        )
        const mortarAngle = Math.atan2(targetY - enemy.y, targetX - enemy.x)
        const travelDistance = Math.hypot(targetX - enemy.x, targetY - enemy.y)
        spawn(mortarAngle, {
          radius: 9,
          life: travelDistance / 410,
          speed: 410,
          type: 'enemyMortar',
          splash: 135,
          targetX,
          targetY,
          ignoresWalls: true,
          damage: type.damage * 1.5,
        })
      }
      return
    }
    spawn(angle - 0.17, {
      speed: 345,
      radius: 8,
      life: 3.7,
      type: 'enemyRocket',
      splash: 84,
      turnRate: 2.2,
      damage: type.damage * 1.25,
    })
    spawn(angle, {
      speed: 365,
      radius: 8,
      life: 3.7,
      type: 'enemyRocket',
      splash: 84,
      turnRate: 2.4,
      damage: type.damage * 1.25,
    })
    spawn(angle + 0.17, {
      speed: 345,
      radius: 8,
      life: 3.7,
      type: 'enemyRocket',
      splash: 84,
      turnRate: 2.2,
      damage: type.damage * 1.25,
    })
    for (let ring = 0; ring < 8; ring += 1) {
      spawn((ring / 8) * TAU, {
        speed: 430,
        radius: 3,
        life: 2,
        type: 'enemyPulse',
        damage: type.damage * 0.48,
        color: '#ff83a5',
      })
    }
  }

  /** Fires a telegraphed mortar shell that leads the player's current motion. */
  private fireEnemyMortar(
    enemy: Enemy,
    type: EnemyType,
    spawn: (angle: number, overrides?: EnemyShotOverrides) => void,
  ): void {
    const directDistance = Math.hypot(this.player.x - enemy.x, this.player.y - enemy.y)
    const estimatedFlight = clamp(directDistance / type.bulletSpeed, 0.65, 1.9)
    const targetX = clamp(
      this.player.x + this.player.vx * estimatedFlight * 0.42 + (randomUnit() - 0.5) * 34,
      38,
      this.worldWidth - 38,
    )
    const targetY = clamp(
      this.player.y + this.player.vy * estimatedFlight * 0.42 + (randomUnit() - 0.5) * 34,
      38,
      this.worldHeight - 38,
    )
    const mortarAngle = Math.atan2(targetY - enemy.y, targetX - enemy.x)
    const travelDistance = Math.hypot(targetX - enemy.x, targetY - enemy.y)
    spawn(mortarAngle, {
      radius: 8,
      life: travelDistance / type.bulletSpeed,
      type: 'enemyMortar',
      splash: 125,
      targetX,
      targetY,
      ignoresWalls: true,
    })
  }

  /** @param {object} options */
  private spawnBullet(options: BulletSpawnOptions): void {
    const bullet = bulletPool.acquire()
    const vx = Math.cos(options.angle) * options.speed
    const vy = Math.sin(options.angle) * options.speed
    Object.assign(
      bullet,
      {
        ricocheted: false,
        critical: false,
        sourceType: 'weapon',
        sourceX: options.x,
        sourceY: options.y,
        weaponIndex: -1,
        pierce: 0,
        chain: 0,
        chainProcessed: false,
        cluster: 0,
        clustered: false,
        enemyWeaponRank: 0,
      },
      options,
      {
        prevX: options.x,
        prevY: options.y,
        vx,
        vy,
        maxLife: options.life,
      },
    )
    this.bullets.push(bullet)
  }

  /** Performs the update bullets operation. */
  private updateBullets(dt: number): void {
    for (let i = this.bullets.length - 1; i >= 0; i -= 1) {
      const bullet = this.bullets[i]
      if (this.updateBullet(bullet, dt)) this.removeBullet(i)
    }

    // Projectiles from opposing teams can destroy each other. Limit this
    // optional effect to sane bullet counts to protect low-end phones.
    if (this.bullets.length < 150) this.resolveProjectileInterceptions()
  }

  /** Advances one projectile and reports whether it should be removed. */
  private updateBullet(bullet: Bullet, dt: number): boolean {
    bullet.life -= dt
    bullet.prevX = bullet.x
    bullet.prevY = bullet.y
    if (bullet.turnRate > 0) this.updateHomingBullet(bullet, dt)
    bullet.x += bullet.vx * dt
    bullet.y += bullet.vy * dt

    if (bullet.type === 'mortar' || bullet.type === 'enemyMortar') {
      const progress = 1 - bullet.life / bullet.maxLife
      bullet.radius = 5 + Math.sin(clamp(progress, 0, 1) * Math.PI) * 7
    }
    if (bullet.life <= 0) {
      if (bullet.splash > 0) this.explodeBullet(bullet)
      return true
    }
    if (!bullet.ignoresWalls && this.handleBulletWallCollision(bullet)) return true
    const hitTarget =
      bullet.owner === 'player'
        ? this.handlePlayerBulletHit(bullet)
        : this.handleEnemyBulletHit(bullet)
    return hitTarget || this.isBulletOutsideWorld(bullet)
  }

  /** Returns whether a projectile has crossed the arena cleanup margin. */
  private isBulletOutsideWorld(bullet: Bullet): boolean {
    return (
      bullet.x < -50 ||
      bullet.y < -50 ||
      bullet.x > this.worldWidth + 50 ||
      bullet.y > this.worldHeight + 50
    )
  }

  /** Performs the update homing bullet operation. */
  private updateHomingBullet(bullet: Bullet, dt: number): void {
    let target = null
    if (bullet.owner === 'player') {
      let best = 520 * 520
      for (const enemy of this.enemies) {
        if (enemy.cloakAlpha < 0.45) continue
        const d2 = distanceSquared(bullet.x, bullet.y, enemy.x, enemy.y)
        if (d2 < best) {
          best = d2
          target = enemy
        }
      }
    } else if (this.player.deadTimer <= 0) {
      target = this.player
    }

    if (!target) return
    const speed = Math.hypot(bullet.vx, bullet.vy)
    const current = Math.atan2(bullet.vy, bullet.vx)
    const desired = Math.atan2(target.y - bullet.y, target.x - bullet.x)
    const angle = turnToward(current, desired, bullet.turnRate * dt)
    bullet.vx = Math.cos(angle) * speed
    bullet.vy = Math.sin(angle) * speed
  }

  /** Performs the handle bullet wall collision operation. */
  private handleBulletWallCollision(bullet: Bullet): boolean {
    for (let i = 0; i < this.obstacles.length; i += 1) {
      const rect = this.obstacles[i]
      if (!circleIntersectsRect(bullet.x, bullet.y, bullet.radius, rect)) continue

      if (bullet.owner === 'player' && rect.destructible) {
        const strength = this.getWallDamageMultiplier(bullet.type)
        const destroyed = this.damageWall(
          i,
          bullet.damage * strength,
          bullet.x,
          bullet.y,
          bullet.color,
        )
        if (destroyed) return false
      }

      if (bullet.bounce > 0) {
        this.resolveBulletRicochet(bullet, rect)
        return false
      }

      this.finishBulletWallImpact(bullet)
      return true
    }
    return false
  }

  /** Returns how strongly a projectile archetype damages destructible walls. */
  private getWallDamageMultiplier(type: string): number {
    if (type === 'shell') return 1.1
    if (type === 'rocket' || type === 'mortar') return 1.4
    if (type === 'pellet') return 0.38
    return 0.2
  }

  /** Reflects a bouncing projectile away from the wall it struck. */
  private resolveBulletRicochet(bullet: Bullet, rectangle: Rectangle): void {
    const impactX = bullet.x
    const impactY = bullet.y
    bullet.x = bullet.prevX
    bullet.y = bullet.prevY
    const hitVertical = impactX < rectangle.x || impactX > rectangle.x + rectangle.w
    const hitHorizontal = impactY < rectangle.y || impactY > rectangle.y + rectangle.h
    if (hitVertical) bullet.vx *= -1
    if (hitHorizontal) bullet.vy *= -1
    if (!hitVertical && !hitHorizontal) {
      if (Math.abs(bullet.vx) > Math.abs(bullet.vy)) bullet.vx *= -1
      else bullet.vy *= -1
    }
    bullet.bounce -= 1
    bullet.ricocheted = true
    this.effects.spawnImpact(impactX, impactY, bullet.color, 5)
    this.audio.impact()
  }

  /** Emits the terminal effect for a non-bouncing wall impact. */
  private finishBulletWallImpact(bullet: Bullet): void {
    if (bullet.splash > 0) {
      this.explodeBullet(bullet)
      return
    }
    this.effects.spawnImpact(bullet.x, bullet.y, bullet.color, 5)
    this.audio.impact()
  }

  /** Damage and optionally remove one destructible wall. */
  private damageWall(
    index: number,
    amount: number,
    hitX: number,
    hitY: number,
    color = '#ffffff',
  ): boolean {
    const rect = this.obstacles[index]
    if (!rect?.destructible) return false
    rect.hp -= amount
    this.effects.spawnImpact(hitX, hitY, color, 5)
    if (rect.hp > 0) return false
    this.obstacles.splice(index, 1)
    this.effects.spawnWallDebris(rect)
    this.effects.spawnExplosion(rect.x + rect.w * 0.5, rect.y + rect.h * 0.5, this.theme.accent, 18)
    this.score += 35
    this.audio.explosion(0.55)
    this.screenShake = Math.max(this.screenShake, 5)
    return true
  }

  /** Performs the handle player bullet hit operation. */
  private handlePlayerBulletHit(bullet: Bullet): boolean {
    return this.tryHitUpgradeBox(bullet) || this.tryHitBonusBox(bullet) || this.tryHitEnemy(bullet)
  }

  /** Opens the first upgrade crate intersected by a player projectile. */
  private tryHitUpgradeBox(bullet: Bullet): boolean {
    for (let i = this.upgradeBoxes.length - 1; i >= 0; i -= 1) {
      const box = this.upgradeBoxes[i]
      const hitRadius = box.size + bullet.radius
      if (distanceSquared(bullet.x, bullet.y, box.x, box.y) > hitRadius * hitRadius) continue

      if (bullet.splash > 0) this.explodeBullet(bullet)
      else {
        this.collectUpgradeBox(i, 'CRATE SHOT')
        this.effects.spawnImpact(bullet.x, bullet.y, bullet.color, 9)
        this.audio.impact()
      }
      return true
    }
    return false
  }

  /** Opens the first bonus crate intersected by a player projectile. */
  private tryHitBonusBox(bullet: Bullet): boolean {
    for (let i = this.bonusBoxes.length - 1; i >= 0; i -= 1) {
      const box = this.bonusBoxes[i]
      const hitRadius = box.size + bullet.radius
      if (distanceSquared(bullet.x, bullet.y, box.x, box.y) > hitRadius * hitRadius) continue

      if (bullet.splash > 0) this.explodeBullet(bullet)
      else {
        this.collectBonusBox(i, 'CRATE SHOT')
        this.effects.spawnImpact(bullet.x, bullet.y, bullet.color, 8)
        this.audio.impact()
      }
      return true
    }
    return false
  }

  /** Damages the first enemy intersected by a player projectile. */
  private tryHitEnemy(bullet: Bullet): boolean {
    for (let i = this.enemies.length - 1; i >= 0; i -= 1) {
      const enemy = this.enemies[i]
      const hitRadius = enemy.radius + bullet.radius
      if (distanceSquared(bullet.x, bullet.y, enemy.x, enemy.y) > hitRadius * hitRadius) continue

      if (bullet.splash > 0) this.explodeBullet(bullet)
      else {
        this.damageEnemy(enemy, bullet.damage, bullet)
        this.effects.spawnImpact(
          bullet.x,
          bullet.y,
          bullet.critical ? '#ffffff' : bullet.color,
          bullet.critical ? 12 : 7,
        )
        if (bullet.pierce > 0) {
          bullet.pierce -= 1
          bullet.damage *= 0.78
          return false
        }
      }
      return true
    }
    return false
  }

  /** Performs the handle enemy bullet hit operation. */
  private handleEnemyBulletHit(bullet: Bullet): boolean {
    const p = this.player
    if (p.deadTimer > 0 || p.invulnerable > 0) return false
    const hitRadius = p.radius + bullet.radius
    if (distanceSquared(bullet.x, bullet.y, p.x, p.y) > hitRadius * hitRadius) return false

    if (bullet.splash > 0) this.explodeBullet(bullet)
    else this.damagePlayer(bullet.damage, bullet)
    this.effects.spawnImpact(bullet.x, bullet.y, bullet.color, 8)
    return true
  }

  /** Performs the resolve projectile interceptions operation. */
  private resolveProjectileInterceptions(): void {
    const cellSize = 72
    const buckets = this.buildBulletBuckets(cellSize)
    for (const [key, indexes] of buckets) {
      if (this.scanNeighborBulletBuckets(key, indexes, buckets)) return
    }
  }

  /** Groups projectiles into coarse spatial buckets for interception checks. */
  private buildBulletBuckets(cellSize: number): Map<string, number[]> {
    const buckets = new Map<string, number[]>()
    for (const [index, bullet] of this.bullets.entries()) {
      const key = `${Math.floor(bullet.x / cellSize)},${Math.floor(bullet.y / cellSize)}`
      const bucket = buckets.get(key)
      if (bucket) bucket.push(index)
      else buckets.set(key, [index])
    }
    return buckets
  }

  /** Searches the eight neighboring cells for one opposing projectile collision. */
  private scanNeighborBulletBuckets(
    key: string,
    indexes: number[],
    buckets: Map<string, number[]>,
  ): boolean {
    const [cellX, cellY] = key.split(',').map(Number)
    for (let neighborX = cellX - 1; neighborX <= cellX + 1; neighborX += 1) {
      for (let neighborY = cellY - 1; neighborY <= cellY + 1; neighborY += 1) {
        const neighbors = buckets.get(`${neighborX},${neighborY}`)
        if (neighbors && this.findBulletInterception(indexes, neighbors)) return true
      }
    }
    return false
  }

  /** Searches two spatial buckets for a colliding projectile pair. */
  private findBulletInterception(indexes: number[], neighbors: number[]): boolean {
    for (const firstIndex of indexes) {
      for (const secondIndex of neighbors) {
        if (this.tryInterceptBullets(firstIndex, secondIndex)) return true
      }
    }
    return false
  }

  /** Removes two opposing projectiles if their collision circles overlap. */
  private tryInterceptBullets(firstIndex: number, secondIndex: number): boolean {
    if (secondIndex >= firstIndex) return false
    const first = this.bullets[firstIndex]
    const second = this.bullets[secondIndex]
    if (!first || !second || first.owner === second.owner) return false
    const radius = first.radius + second.radius + 1
    if (distanceSquared(first.x, first.y, second.x, second.y) > radius * radius) return false
    this.effects.spawnImpact((first.x + second.x) * 0.5, (first.y + second.y) * 0.5, '#ffffff', 9)
    this.audio.impact()
    this.removeBullet(firstIndex)
    this.removeBullet(secondIndex)
    return true
  }

  /** Performs the explode bullet operation. */
  private explodeBullet(bullet: Bullet): void {
    this.effects.spawnExplosion(bullet.x, bullet.y, bullet.color, Math.round(bullet.splash * 0.16))
    this.audio.explosion(0.72)
    this.screenShake = Math.max(this.screenShake, 7)
    const radius2 = bullet.splash * bullet.splash

    if (bullet.owner === 'player') {
      this.applyPlayerExplosion(bullet, radius2)
    } else {
      this.applyEnemyExplosion(bullet, radius2)
    }
  }

  /** Applies a player explosion to walls, crates, enemies, and cluster charges. */
  private applyPlayerExplosion(bullet: Bullet, radiusSquared: number): void {
    this.damageWallsInExplosion(bullet, radiusSquared)
    this.openCratesInExplosion(bullet, radiusSquared)
    this.damageEnemiesInExplosion(bullet, radiusSquared)
    if (bullet.cluster > 0 && !bullet.clustered) this.detonateClusterCharges(bullet)
  }

  /** Damages destructible walls within a player explosion. */
  private damageWallsInExplosion(bullet: Bullet, radiusSquared: number): void {
    for (let index = this.obstacles.length - 1; index >= 0; index -= 1) {
      const rectangle = this.obstacles[index]
      if (!rectangle.destructible) continue
      const nearestX = clamp(bullet.x, rectangle.x, rectangle.x + rectangle.w)
      const nearestY = clamp(bullet.y, rectangle.y, rectangle.y + rectangle.h)
      const distance = distanceSquared(bullet.x, bullet.y, nearestX, nearestY)
      if (distance > radiusSquared) continue
      const falloff = 1 - Math.sqrt(distance) / bullet.splash
      this.damageWall(
        index,
        bullet.damage * (0.48 + falloff * 0.82),
        nearestX,
        nearestY,
        bullet.color,
      )
    }
  }

  /** Opens bonus and upgrade crates within a player explosion. */
  private openCratesInExplosion(bullet: Bullet, radiusSquared: number): void {
    for (let index = this.upgradeBoxes.length - 1; index >= 0; index -= 1) {
      const box = this.upgradeBoxes[index]
      if (distanceSquared(bullet.x, bullet.y, box.x, box.y) <= radiusSquared) {
        this.collectUpgradeBox(index, 'BLAST OPENED')
      }
    }
    for (let index = this.bonusBoxes.length - 1; index >= 0; index -= 1) {
      const box = this.bonusBoxes[index]
      if (distanceSquared(bullet.x, bullet.y, box.x, box.y) <= radiusSquared) {
        this.collectBonusBox(index, 'BLAST OPENED')
      }
    }
  }

  /** Applies radial damage falloff to enemies inside a player explosion. */
  private damageEnemiesInExplosion(bullet: Bullet, radiusSquared: number): void {
    for (const enemy of this.enemies) {
      const distance = distanceSquared(bullet.x, bullet.y, enemy.x, enemy.y)
      if (distance > radiusSquared) continue
      const falloff = 1 - Math.sqrt(distance) / bullet.splash
      this.damageEnemy(enemy, bullet.damage * (0.35 + falloff * 0.65), bullet)
    }
  }

  /** Detonates secondary cluster charges and applies their local damage. */
  private detonateClusterCharges(bullet: Bullet): void {
    bullet.clustered = true
    for (let index = 0; index < bullet.cluster; index += 1) {
      const angle = (index / bullet.cluster) * TAU + randomUnit() * 0.5
      const x = bullet.x + Math.cos(angle) * 48
      const y = bullet.y + Math.sin(angle) * 48
      this.effects.spawnExplosion(x, y, bullet.color, 8)
      for (const enemy of this.enemies) {
        if (distanceSquared(x, y, enemy.x, enemy.y) > 72 ** 2) continue
        this.damageEnemy(enemy, bullet.damage * 0.28, {
          ...bullet,
          cluster: 0,
          sourceX: bullet.x,
          sourceY: bullet.y,
          sourceType: 'cluster',
        })
      }
    }
  }

  /** Applies an enemy explosion to the player when damage is currently allowed. */
  private applyEnemyExplosion(bullet: Bullet, radiusSquared: number): void {
    if (this.player.invulnerable > 0 || this.player.deadTimer > 0) return
    const distance = distanceSquared(bullet.x, bullet.y, this.player.x, this.player.y)
    if (distance > radiusSquared) return
    const falloff = 1 - Math.sqrt(distance) / bullet.splash
    this.damagePlayer(bullet.damage * (0.35 + falloff * 0.65), bullet)
  }

  /** Performs the damage enemy operation. */
  private damageEnemy(enemy: Enemy, amount: number, bullet: DamageSource | null = null): void {
    if (enemy.dead) return
    const type = ENEMY_TYPES[enemy.typeIndex]
    const finalAmount = amount
    enemy.health -= finalAmount
    enemy.flash = 1
    if (bullet) this.recordEnemyHit(enemy, bullet)
    if (this.player.vampireTimer > 0 && bullet?.owner !== 'enemy') {
      this.player.health = Math.min(this.player.maxHealth, this.player.health + finalAmount * 0.075)
    }
    if (bullet) this.applyChainDamage(enemy, finalAmount, bullet)
    if (enemy.health > 0) {
      this.audio.hit()
      return
    }
    this.defeatEnemy(enemy, type)
  }

  /** Records the skill-shot metadata used by kill scoring. */
  private recordEnemyHit(enemy: Enemy, source: DamageSource): void {
    enemy.lastHit = {
      ricocheted: Boolean(source.ricocheted),
      critical: Boolean(source.critical),
      sourceType: source.sourceType || 'weapon',
      distance: Math.hypot(enemy.x - source.sourceX, enemy.y - source.sourceY),
      weaponIndex: source.weaponIndex,
    }
  }

  /** Propagates one chain-lightning hit to nearby living enemies. */
  private applyChainDamage(enemy: Enemy, amount: number, bullet: DamageSource): void {
    const chainLimit = bullet.chain ?? 0
    if (chainLimit <= 0 || bullet.chainProcessed || enemy.health <= 0) return
    bullet.chainProcessed = true
    let chained = 0
    for (const other of this.enemies) {
      if (chained >= chainLimit) return
      if (other === enemy || other.dead) continue
      if (distanceSquared(enemy.x, enemy.y, other.x, other.y) > 165 ** 2) continue
      this.effects.spawnImpact(other.x, other.y, '#a9ffb1', 7)
      this.damageEnemy(other, amount * 0.48, {
        ...bullet,
        chain: 0,
        sourceX: enemy.x,
        sourceY: enemy.y,
        sourceType: 'chain',
      })
      chained += 1
    }
  }

  /** Finalizes an enemy death, rewards drops, and removes the tank. */
  private defeatEnemy(enemy: Enemy, type: EnemyType): void {
    enemy.dead = true
    this.registerKill(enemy, type)
    this.effects.spawnExplosion(enemy.x, enemy.y, type.color, enemy.elite ? 38 : 24)
    if (enemy.elite || enemy.boss) this.dropEnemyRewards(enemy)
    let explosionScale = 0.9
    let shakeStrength = 9
    if (enemy.boss) {
      explosionScale = 1.5
      shakeStrength = 20
    } else if (enemy.elite) {
      explosionScale = 1.18
      shakeStrength = 13
    }
    this.audio.explosion(explosionScale)
    this.screenShake = Math.max(this.screenShake, shakeStrength)
    const index = this.enemies.indexOf(enemy)
    if (index >= 0) this.enemies.splice(index, 1)
  }

  /** Drops guaranteed elite/boss rewards and applies dramatic time effects. */
  private dropEnemyRewards(enemy: Enemy): void {
    this.spawnBonusBoxAt(enemy.x, enemy.y)
    if (enemy.boss || randomUnit() < 0.34) this.spawnUpgradeBoxAt(enemy.x + 30, enemy.y, randomUnit)
    if (enemy.boss) {
      this.spawnBonusBoxAt(enemy.x - 38, enemy.y + 18)
      this.spawnUpgradeBoxAt(enemy.x + 44, enemy.y - 20, randomUnit)
    }
    this.slowMoTimer = Math.max(this.slowMoTimer, enemy.boss ? 0.55 : 0.24)
    this.flashAlpha = Math.max(this.flashAlpha, enemy.boss ? 0.62 : 0.34)
  }

  /** Award score for kill chains, skill shots, elite tanks, and multikills. */
  private registerKill(enemy: Enemy, type: EnemyType): void {
    this.comboCount = this.comboTimer > 0 ? this.comboCount + 1 : 1
    this.comboTimer = this.player.comboLockTimer > 0 ? 12 : 5.1
    this.comboMultiplier = Math.min(8, 1 + Math.floor((this.comboCount - 1) / 3) * 0.5)

    if (this.multiKillTimer > 0) this.multiKillCount += 1
    else this.multiKillCount = 1
    this.multiKillTimer = 0.72

    const awards: string[] = []
    const baseScore = this.calculateKillScore(enemy, type, awards)

    const gained = Math.round(baseScore * this.comboMultiplier)
    this.score += gained
    if (this.comboCount > 1 || awards.length) {
      this.showToast(
        `${awards.join(' · ')}${awards.length ? ' · ' : ''}COMBO ${this.comboCount} · ×${this.comboMultiplier.toFixed(1)}`,
      )
    }
    if (this.multiKillCount >= 3) this.slowMoTimer = Math.max(this.slowMoTimer, 0.14)
  }

  /** Calculates one kill's score and appends its award labels. */
  private calculateKillScore(enemy: Enemy, type: EnemyType, awards: string[]): number {
    let score = this.applyEnemyRankAward(enemy, type, awards)
    score += this.getSkillAwardScore(enemy, awards)
    score += this.getSituationAwardScore(awards)
    return score
  }

  /** Applies the boss or elite score multiplier and award. */
  private applyEnemyRankAward(enemy: Enemy, type: EnemyType, awards: string[]): number {
    const baseScore = type.score + this.level * 10
    if (enemy.boss) {
      awards.push('BOSS BREAKER')
      return baseScore * 3
    }
    if (enemy.elite) {
      awards.push('ELITE')
      return baseScore * 2
    }
    return baseScore
  }

  /** Returns score earned from the killing hit's technique. */
  private getSkillAwardScore(enemy: Enemy, awards: string[]): number {
    let score = 0
    const lastHit = enemy.lastHit
    if (lastHit?.critical) {
      score += 175
      awards.push('CRITICAL')
    }
    if (lastHit?.sourceType === 'trap' || lastHit?.sourceType === 'barrier') {
      score += 210
      awards.push('TRAP MASTER')
    }
    if (lastHit?.sourceType === 'hazard') {
      score += 190
      awards.push('ENVIRONMENTAL')
    }
    if (lastHit?.sourceType === 'chain') {
      score += 135
      awards.push('CHAIN REACTION')
    }
    if (lastHit?.ricocheted) {
      score += 180
      awards.push('RICOCHET')
    }
    const hitDistance = lastHit?.distance || 0
    if (hitDistance > 520) {
      score += 160
      awards.push('LONG SHOT')
    } else if (hitDistance > 0 && hitDistance < 105) {
      score += 130
      awards.push('POINT BLANK')
    }
    return score
  }

  /** Returns score earned from the current combat situation. */
  private getSituationAwardScore(awards: string[]): number {
    let score = 0
    if (performance.now() - this.lastDamageTime > 10000) {
      score += 120
      awards.push('FLAWLESS')
    }
    if (this.player.health < this.player.maxHealth * 0.25) {
      score += 145
      awards.push('COMEBACK')
    }
    if (this.multiKillCount >= 2) {
      score += 120 * this.multiKillCount
      awards.push(`${this.multiKillCount}× MULTIKILL`)
    }
    return score
  }

  /** Performs the damage player operation. */
  private damagePlayer(amount: number, source: DamageSource | null = null): void {
    const p = this.player
    if (p.invulnerable > 0 || p.deadTimer > 0) return

    let reducedAmount = amount * (p.armorTimer > 0 ? 0.48 : 1)
    if (source && p.directionalShieldTimer > 0)
      reducedAmount = this.applyDirectionalShield(reducedAmount, source)
    if (reducedAmount <= 0.01) return
    p.health -= reducedAmount
    this.lastDamageTime = performance.now()
    this.comboCount = 0
    this.comboTimer = 0
    this.comboMultiplier = 1
    this.audio.damage()
    this.screenShake = Math.max(this.screenShake, 6)
    if (p.health > 0) return
    p.health = 0
    p.deadTimer = 1.45
    this.score = Math.max(0, this.score - 150)
    this.effects.spawnExplosion(p.x, p.y, PALETTE.player, 34)
    this.audio.explosion(1.25)
    this.showToast('TANK DESTROYED · RESPAWNING')
  }

  /** Reduces incoming damage when it strikes the player's forward shield arc. */
  private applyDirectionalShield(amount: number, source: DamageSource): number {
    const player = this.player
    const sourceX = source.x ?? source.sourceX
    const sourceY = source.y ?? source.sourceY
    const sourceSplash = source.splash ?? 0
    const incomingAngle = Math.atan2(sourceY - player.y, sourceX - player.x)
    if (Math.abs(normalizeAngle(incomingAngle - player.turretAngle)) >= 1.08) return amount
    const shieldX = player.x + Math.cos(player.turretAngle) * (player.radius + 11)
    const shieldY = player.y + Math.sin(player.turretAngle) * (player.radius + 11)
    this.effects.spawnImpact(shieldX, shieldY, '#64ddff', sourceSplash > 0 ? 12 : 9)
    this.audio.impact()
    this.screenShake = Math.max(this.screenShake, sourceSplash > 0 ? 2.5 : 1.5)
    return amount * (sourceSplash > 0 ? 0.32 : 0)
  }

  /** Performs the respawn player operation. */
  private respawnPlayer(): void {
    const random = mulberry32((this.level * 1777 + Math.floor(performance.now())) >>> 0)
    const point = this.arena.findOpenPoint(
      random,
      this.player.radius + 10,
      280,
      this.player.x,
      this.player.y,
    )
    this.player.x = point.x
    this.player.y = point.y
    this.player.vx = 0
    this.player.vy = 0
    this.player.health = this.player.maxHealth
    this.player.invulnerable = 2.2
    this.player.deadTimer = 0
    this.player.recoil = 0
    this.player.trackTimer = 0
    this.audio.respawn()
    this.showToast('RESPAWNED · 2s SHIELD')
  }

  /** Performs the remove bullet operation. */
  private removeBullet(index: number): void {
    const bullet = this.bullets[index]
    if (!bullet) return
    const last = this.bullets.pop()
    if (last && index < this.bullets.length) this.bullets[index] = last
    bulletPool.release(bullet)
  }

  /** Performs the update camera operation. */
  private updateCamera(dt: number): void {
    const targetX = clamp(
      this.player.x - this.viewWidth * 0.5,
      0,
      Math.max(0, this.worldWidth - this.viewWidth),
    )
    const targetY = clamp(
      this.player.y - this.viewHeight * 0.5,
      0,
      Math.max(0, this.worldHeight - this.viewHeight),
    )
    const follow = 1 - Math.pow(0.0002, dt)
    this.cameraX = lerp(this.cameraX, targetX, follow)
    this.cameraY = lerp(this.cameraY, targetY, follow)
  }

  /** Performs the check level complete operation. */
  private checkLevelComplete(dt: number): void {
    if (this.enemies.length > 0) {
      this.levelCompleteTimer = -1
      return
    }
    if (this.levelCompleteTimer < 0) {
      this.levelCompleteTimer = 2.1
      this.score += 500 + this.level * 100
      this.player.health = this.player.maxHealth
      this.audio.levelClear()
      this.showToast(`LEVEL ${this.level} CLEARED`)
    } else {
      this.levelCompleteTimer -= dt
      if (this.levelCompleteTimer <= 0) {
        const nextLevel = this.level + 1
        this.generateLevel(nextLevel)
        canvas.focus({ preventScroll: true })
        this.showToast(`LEVEL ${nextLevel} · ${this.theme.name}`)
      }
    }
  }

  /** Performs the show toast operation. */
  private showToast(text: string): void {
    toast.textContent = text
    toast.classList.add('is-visible')
    this.toastTimer = 1.65
  }

  /** Performs the update hud operation. */
  private updateHud(force: boolean): void {
    const now = performance.now()
    if (!force && now - this.lastHudUpdate < 80) return
    this.lastHudUpdate = now
    levelValue.textContent = String(this.level)
    scoreValue.textContent = this.score.toLocaleString()
    enemyValue.textContent = String(this.enemies.length)
    comboValue.textContent = `×${this.comboMultiplier.toFixed(1)}`
    comboValue.style.color = this.comboCount > 1 ? this.theme.accent : ''
    themeValue.textContent = this.theme.name
    const health = Math.max(0, Math.round(this.player.health))
    healthValue.textContent = String(health)
    const ratio = clamp(health / this.player.maxHealth, 0, 1)
    healthFill.style.transform = `scaleX(${ratio})`
    healthFill.style.filter = ratio < 0.3 ? 'hue-rotate(130deg)' : 'none'

    const activeBonuses = this.getActiveBonusLabels()
    bonusValue.textContent = activeBonuses.length
      ? activeBonuses.join(' · ')
      : `${this.bonusBoxes.length} BONUS · ${this.upgradeBoxes.length} UPGRADE`
  }

  /** Returns compact labels for every currently active player bonus. */
  private getActiveBonusLabels(): string[] {
    const bonuses: string[] = []
    if (this.player.invulnerable > 0) bonuses.push(`SHIELD ${Math.ceil(this.player.invulnerable)}s`)
    if (this.player.rapidTimer > 0) bonuses.push(`RAPID ${Math.ceil(this.player.rapidTimer)}s`)
    if (this.player.turboTimer > 0) bonuses.push(`TURBO ${Math.ceil(this.player.turboTimer)}s`)
    if (this.player.damageTimer > 0) bonuses.push(`POWER ${Math.ceil(this.player.damageTimer)}s`)
    if (this.player.armorTimer > 0) bonuses.push(`ARMOR ${Math.ceil(this.player.armorTimer)}s`)
    if (this.player.vampireTimer > 0) bonuses.push(`VAMP ${Math.ceil(this.player.vampireTimer)}s`)
    if (this.player.magnetTimer > 0) bonuses.push(`MAGNET ${Math.ceil(this.player.magnetTimer)}s`)
    if (this.player.directionalShieldTimer > 0)
      bonuses.push(`DEFLECT ${Math.ceil(this.player.directionalShieldTimer)}s`)
    if (this.player.timeWarpTimer > 0) bonuses.push(`WARP ${Math.ceil(this.player.timeWarpTimer)}s`)
    if (this.player.multiShotTimer > 0)
      bonuses.push(`MULTI ${Math.ceil(this.player.multiShotTimer)}s`)
    if (this.player.comboLockTimer > 0)
      bonuses.push(`LOCK ${Math.ceil(this.player.comboLockTimer)}s`)
    return bonuses
  }

  /** Delegates drawing to the dedicated renderer. */
  public render(): void {
    this.renderer.render()
  }
}

/** Interpolate angles without crossing the long way around the circle. */
function lerpAngle(a: number, b: number, t: number): number {
  return a + normalizeAngle(b - a) * t
}

/** Starts a fixed-timestep game session and its render loop. */
export function startGame() {
  const game = new Game()
  game.selectWeapon(0)

  let previousTime = performance.now()
  let accumulator = 0

  const frame = (now: number): void => {
    const frameTime = Math.min(MAX_FRAME, (now - previousTime) / 1000)
    previousTime = now
    accumulator += frameTime

    while (accumulator >= FIXED_STEP) {
      game.update(FIXED_STEP)
      accumulator -= FIXED_STEP
    }
    game.render()
    requestAnimationFrame(frame)
  }

  requestAnimationFrame(frame)
}
