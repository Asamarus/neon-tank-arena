/** A deterministic random-number source returning a value from zero to one. */
export type RandomSource = () => number

export interface Point {
  /** Horizontal world coordinate. */
  x: number
  /** Vertical world coordinate. */
  y: number
}

export interface Rectangle extends Point {
  /** Width in world units. */
  w: number
  /** Height in world units. */
  h: number
}

export interface Obstacle extends Rectangle {
  /** Whether destructible. */
  destructible: boolean
  /** Current hit points. */
  hp: number
  /** Maximum hit points. */
  maxHp: number
}

export interface CircleBody extends Point {
  /** Radius value. */
  radius: number
}

export interface TankBody extends CircleBody {
  /** Body angle value. */
  bodyAngle: number
}

export interface Player extends TankBody {
  /** Horizontal velocity. */
  vx: number
  /** Vertical velocity. */
  vy: number
  /** Speed value. */
  speed: number
  /** Turret angle value. */
  turretAngle: number
  /** Health value. */
  health: number
  /** Max health value. */
  maxHealth: number
  /** Fire cooldown value. */
  fireCooldown: number
  /** Weapon index value. */
  weaponIndex: number
  /** Dead timer value. */
  deadTimer: number
  /** Invulnerable value. */
  invulnerable: number
  /** Rapid timer value. */
  rapidTimer: number
  /** Turbo timer value. */
  turboTimer: number
  /** Damage timer value. */
  damageTimer: number
  /** Armor timer value. */
  armorTimer: number
  /** Vampire timer value. */
  vampireTimer: number
  /** Magnet timer value. */
  magnetTimer: number
  /** Directional shield timer value. */
  directionalShieldTimer: number
  /** Time warp timer value. */
  timeWarpTimer: number
  /** Multi shot timer value. */
  multiShotTimer: number
  /** Combo lock timer value. */
  comboLockTimer: number
  /** Hazard cooldown value. */
  hazardCooldown: number
  /** Recoil value. */
  recoil: number
  /** Track timer value. */
  trackTimer: number
}

export type EnemyWeapon =
  | 'single'
  | 'pulse'
  | 'sniper'
  | 'triple'
  | 'mortar'
  | 'rocket'
  | 'cloakPulse'
  | 'mineLayer'
  | 'repair'
  | 'boss'

export type EnemyBehavior = 'orbit' | 'pressure' | 'kite' | 'support' | 'boss'

export interface EnemyType {
  /** Name value. */
  name: string
  /** Color value. */
  color: string
  /** Dark value. */
  dark: string
  /** Current hit points. */
  hp: number
  /** Speed value. */
  speed: number
  /** Radius value. */
  radius: number
  /** Preferred value. */
  preferred: number
  /** Fire rate value. */
  fireRate: number
  /** Bullet speed value. */
  bulletSpeed: number
  /** Damage value. */
  damage: number
  /** Accuracy value. */
  accuracy: number
  /** Score value. */
  score: number
  /** Behavior value. */
  behavior: EnemyBehavior
  /** Weapon value. */
  weapon: EnemyWeapon
  /** Unlock level value. */
  unlockLevel: number
  /** Turret speed value. */
  turretSpeed: number
  /** Min range value. */
  minRange?: number
  /** Max range value. */
  maxRange?: number
  /** Marker value. */
  marker?: string
  /** Whether boss. */
  boss?: boolean
}

export interface HitRecord {
  /** Whether ricocheted. */
  ricocheted: boolean
  /** Whether critical. */
  critical: boolean
  /** Source type value. */
  sourceType: string
  /** Distance value. */
  distance: number
  /** Weapon index value. */
  weaponIndex: number
}

export interface Enemy extends TankBody {
  /** Type index value. */
  typeIndex: number
  /** Health value. */
  health: number
  /** Max health value. */
  maxHealth: number
  /** Turret angle value. */
  turretAngle: number
  /** Fire cooldown value. */
  fireCooldown: number
  /** Decision timer value. */
  decisionTimer: number
  /** Steer angle value. */
  steerAngle: number
  /** Orbit direction value. */
  orbitDirection: number
  /** Flash value. */
  flash: number
  /** Whether dead. */
  dead: boolean
  /** Whether elite. */
  elite: boolean
  /** Whether boss. */
  boss: boolean
  /** Speed multiplier value. */
  speedMultiplier: number
  /** Damage multiplier value. */
  damageMultiplier: number
  /** Fire rate multiplier value. */
  fireRateMultiplier: number
  /** Recoil value. */
  recoil: number
  /** Track timer value. */
  trackTimer: number
  /** Last hit value. */
  lastHit: HitRecord | null
  /** Cloak timer value. */
  cloakTimer: number
  /** Cloak alpha value. */
  cloakAlpha: number
  /** Mine timer value. */
  mineTimer: number
  /** Repair timer value. */
  repairTimer: number
  /** Stun timer value. */
  stunTimer: number
  /** Hazard cooldown value. */
  hazardCooldown: number
  /** Boss phase value. */
  bossPhase: number
  /** Whether spawned wave2. */
  spawnedWave2: boolean
  /** Whether spawned wave3. */
  spawnedWave3: boolean
  /** Stuck timer value. */
  stuckTimer: number
  /** Recovery timer value. */
  recoveryTimer: number
  /** Recovery angle value. */
  recoveryAngle: number
  /** Collision timer value. */
  collisionTimer: number
}

export type ProjectileOwner = 'player' | 'enemy'

export interface DamageSource {
  /** Horizontal world coordinate. */
  x?: number
  /** Vertical world coordinate. */
  y?: number
  /** Source x value. */
  sourceX: number
  /** Source y value. */
  sourceY: number
  /** Weapon index value. */
  weaponIndex: number
  /** Source type value. */
  sourceType?: string
  /** Whether ricocheted. */
  ricocheted?: boolean
  /** Whether critical. */
  critical?: boolean
  /** Owner value. */
  owner?: ProjectileOwner
  /** Splash value. */
  splash?: number
  /** Chain value. */
  chain?: number
  /** Whether chain processed. */
  chainProcessed?: boolean
  /** Cluster value. */
  cluster?: number
  /** Whether clustered. */
  clustered?: boolean
}

export interface Bullet extends Point, DamageSource {
  /** Horizontal world coordinate. */
  x: number
  /** Vertical world coordinate. */
  y: number
  /** Prev x value. */
  prevX: number
  /** Prev y value. */
  prevY: number
  /** Horizontal velocity. */
  vx: number
  /** Vertical velocity. */
  vy: number
  /** Radius value. */
  radius: number
  /** Damage value. */
  damage: number
  /** Life value. */
  life: number
  /** Max life value. */
  maxLife: number
  /** Owner value. */
  owner: ProjectileOwner
  /** Color value. */
  color: string
  /** Type value. */
  type: string
  /** Bounce value. */
  bounce: number
  /** Splash value. */
  splash: number
  /** Turn rate value. */
  turnRate: number
  /** Target x value. */
  targetX: number
  /** Target y value. */
  targetY: number
  /** Whether ignores walls. */
  ignoresWalls: boolean
  /** Whether ricocheted. */
  ricocheted: boolean
  /** Whether critical. */
  critical: boolean
  /** Source type value. */
  sourceType: string
  /** Pierce value. */
  pierce: number
  /** Chain value. */
  chain: number
  /** Whether chain processed. */
  chainProcessed: boolean
  /** Cluster value. */
  cluster: number
  /** Whether clustered. */
  clustered: boolean
  /** Enemy weapon rank value. */
  enemyWeaponRank: number
}

export interface BulletSpawnOptions extends Point {
  /** Angle value. */
  angle: number
  /** Speed value. */
  speed: number
  /** Damage value. */
  damage: number
  /** Radius value. */
  radius: number
  /** Life value. */
  life: number
  /** Owner value. */
  owner: ProjectileOwner
  /** Color value. */
  color: string
  /** Type value. */
  type: string
  /** Bounce value. */
  bounce: number
  /** Splash value. */
  splash: number
  /** Turn rate value. */
  turnRate: number
  /** Target x value. */
  targetX: number
  /** Target y value. */
  targetY: number
  /** Whether ignores walls. */
  ignoresWalls: boolean
  /** Source x value. */
  sourceX?: number
  /** Source y value. */
  sourceY?: number
  /** Weapon index value. */
  weaponIndex?: number
  /** Whether ricocheted. */
  ricocheted?: boolean
  /** Whether critical. */
  critical?: boolean
  /** Source type value. */
  sourceType?: string
  /** Pierce value. */
  pierce?: number
  /** Chain value. */
  chain?: number
  /** Cluster value. */
  cluster?: number
  /** Enemy weapon rank value. */
  enemyWeaponRank?: number
}

export interface Particle extends Point {
  /** Horizontal velocity. */
  vx: number
  /** Vertical velocity. */
  vy: number
  /** Life value. */
  life: number
  /** Max life value. */
  maxLife: number
  /** Size value. */
  size: number
  /** Color value. */
  color: string
  /** Drag value. */
  drag: number
  /** Kind value. */
  kind: string
  /** Rotation value. */
  rotation: number
  /** Spin value. */
  spin: number
}

export type HazardKind = 'wind' | 'ice' | 'conveyor' | 'electric' | 'sludge' | 'lava'

export interface Hazard extends Rectangle {
  /** Kind value. */
  kind: HazardKind
  /** Whether circular. */
  circular: boolean
  /** Phase value. */
  phase: number
  /** Direction value. */
  direction: number
}

export interface TerrainEffect {
  /** Speed value. */
  speed: number
  /** Turn value. */
  turn: number
  /** Push x value. */
  pushX: number
  /** Push y value. */
  pushY: number
  /** Damage value. */
  damage: number
  /** Whether active. */
  active: boolean
}

export interface Theme {
  /** Id value. */
  id: string
  /** Name value. */
  name: string
  /** Hue value. */
  hue: number
  /** Floor value. */
  floor: string
  /** Grid value. */
  grid: string
  /** Wall value. */
  wall: string
  /** Top value. */
  top: string
  /** Edge value. */
  edge: string
  /** Accent value. */
  accent: string
  /** Hazard value. */
  hazard: HazardKind
}

export interface WeaponDefinition {
  /** Name value. */
  name: string
  /** Cooldown value. */
  cooldown: number
  /** Speed value. */
  speed: number
  /** Damage value. */
  damage: number
  /** Radius value. */
  radius: number
  /** Life value. */
  life: number
  /** Spread value. */
  spread: number
  /** Count value. */
  count: number
  /** Bounce value. */
  bounce: number
  /** Color value. */
  color: string
  /** Type value. */
  type: string
  /** Splash value. */
  splash?: number
  /** Turn rate value. */
  turnRate?: number
}

export interface EffectiveWeapon extends Omit<WeaponDefinition, 'splash' | 'turnRate'> {
  /** Splash value. */
  splash: number
  /** Turn rate value. */
  turnRate: number
  /** Crit chance value. */
  critChance: number
  /** Crit multiplier value. */
  critMultiplier: number
  /** Pierce value. */
  pierce: number
  /** Chain value. */
  chain: number
  /** Cluster value. */
  cluster: number
}

export type UpgradeStatId = 'damage' | 'cooldown' | 'speed' | 'special' | 'critical' | 'sustain'
export type WeaponUpgradeRanks = Record<UpgradeStatId, number>

export interface UpgradeStat {
  /** Id value. */
  id: UpgradeStatId
  /** Name value. */
  name: string
  /** Description value. */
  description: string
}

export interface UpgradeOffer {
  /** Weapon index value. */
  weaponIndex: number
  /** Stat id value. */
  statId: UpgradeStatId
  /** Stat index value. */
  statIndex: number
}

export interface UpgradeBox extends Point, UpgradeOffer {
  /** Size value. */
  size: number
  /** Phase value. */
  phase: number
}

export interface BonusType {
  /** Id value. */
  id: string
  /** Name value. */
  name: string
  /** Color value. */
  color: string
  /** Symbol value. */
  symbol: string
  /** Weight value. */
  weight: number
}

export interface BonusBox extends Point {
  /** Size value. */
  size: number
  /** Bonus index value. */
  bonusIndex: number
  /** Phase value. */
  phase: number
}

export interface GadgetDefinition {
  /** Id value. */
  id: string
  /** Name value. */
  name: string
  /** Key value. */
  key: string
  /** Color value. */
  color: string
  /** Max charges value. */
  maxCharges: number
}

export interface PlayerTrap extends Point {
  /** Kind value. */
  kind: 'mine' | 'stasis' | 'barrier'
  /** Radius value. */
  radius: number
  /** Trigger value. */
  trigger: number
  /** Splash value. */
  splash: number
  /** Damage value. */
  damage: number
  /** Arm value. */
  arm: number
  /** Life value. */
  life: number
  /** Phase value. */
  phase: number
  /** Angle value. */
  angle: number
  /** Half length value. */
  halfLength: number
  /** Tick value. */
  tick: number
}

export interface EnemyMine extends Point {
  /** Arm value. */
  arm: number
  /** Life value. */
  life: number
  /** Trigger value. */
  trigger: number
  /** Damage value. */
  damage: number
  /** Phase value. */
  phase: number
}

export interface TrackMark extends Point {
  /** Angle value. */
  angle: number
  /** Life value. */
  life: number
  /** Max life value. */
  maxLife: number
  /** Color value. */
  color: string
}

export interface ScorchMark extends Point {
  /** Radius value. */
  radius: number
  /** Alpha value. */
  alpha: number
}

export interface EnemyWeaponProfile {
  /** Rank value. */
  rank: number
  /** Damage value. */
  damage: number
  /** Cooldown value. */
  cooldown: number
  /** Speed value. */
  speed: number
  /** Accuracy value. */
  accuracy: number
  /** Splash value. */
  splash: number
  /** Homing value. */
  homing: number
  /** Life value. */
  life: number
}

export interface EnemyShotOverrides {
  /** Speed value. */
  speed?: number
  /** Damage value. */
  damage?: number
  /** Radius value. */
  radius?: number
  /** Life value. */
  life?: number
  /** Color value. */
  color?: string
  /** Type value. */
  type?: string
  /** Splash value. */
  splash?: number
  /** Turn rate value. */
  turnRate?: number
  /** Target x value. */
  targetX?: number
  /** Target y value. */
  targetY?: number
  /** Whether ignores walls. */
  ignoresWalls?: boolean
}

export type BonusCollectionSource = 'COLLECTED' | 'CRATE SHOT' | 'BLAST OPENED'
