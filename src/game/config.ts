import type { BonusType, EnemyType, GadgetDefinition, Theme, UpgradeStat, WeaponDefinition } from './types.ts';

/** Defines the shared tau. */
export const TAU = Math.PI * 2;
/** Defines the shared fixed step. */
export const FIXED_STEP = 1 / 60;
/** Defines the shared max frame. */
export const MAX_FRAME = 0.1;
/** Defines the shared is coarse pointer. */
export const IS_COARSE_POINTER = matchMedia('(pointer: coarse)').matches;

/** @type {Record<string, string>} */
export const PALETTE = {
  background: '#071019',
  grid: 'rgba(120, 226, 255, 0.055)',
  gridStrong: 'rgba(120, 226, 255, 0.105)',
  wall: '#172b38',
  wallTop: '#244453',
  wallEdge: '#0d1a23',
  player: '#65efff',
  playerDark: '#147f94',
  shadow: 'rgba(0, 0, 0, 0.30)',
  white: '#eafcff',
};

/** Weapon definitions shared by input, HUD, and firing logic. */
export const WEAPONS: WeaponDefinition[] = [
  {
    name: 'Cannon', cooldown: 0.42, speed: 720, damage: 38, radius: 5,
    life: 1.7, spread: 0, count: 1, bounce: 1, color: '#7ff7ff', type: 'shell',
  },
  {
    name: 'Pulse', cooldown: 0.095, speed: 920, damage: 10, radius: 3,
    life: 1.2, spread: 0.035, count: 1, bounce: 0, color: '#9cff98', type: 'pulse',
  },
  {
    name: 'Scatter', cooldown: 0.68, speed: 690, damage: 12, radius: 3,
    life: 0.72, spread: 0.30, count: 7, bounce: 0, color: '#ffd67c', type: 'pellet',
  },
  {
    name: 'Seeker', cooldown: 0.95, speed: 420, damage: 52, radius: 7,
    life: 3.0, spread: 0, count: 1, bounce: 0, color: '#ff8dc9', type: 'rocket',
    splash: 92, turnRate: 3.2,
  },
  {
    name: 'Mortar', cooldown: 1.16, speed: 470, damage: 72, radius: 8,
    life: 1.4, spread: 0, count: 1, bounce: 0, color: '#d4a0ff', type: 'mortar',
    splash: 125,
  },
];

/** Enemy archetypes. Each type declares the level where it enters the roster. */
export const ENEMY_TYPES: EnemyType[] = [
  {
    name: 'Scout', color: '#ff6b7a', dark: '#9e2635', hp: 48, speed: 155,
    radius: 19, preferred: 270, fireRate: 0.72, bulletSpeed: 510,
    damage: 14, accuracy: 0.10, score: 110, behavior: 'orbit', weapon: 'single',
    unlockLevel: 1, turretSpeed: 4.6,
  },
  {
    name: 'Hunter', color: '#ffb15a', dark: '#9c5622', hp: 76, speed: 115,
    radius: 21, preferred: 350, fireRate: 1.0, bulletSpeed: 570,
    damage: 20, accuracy: 0.055, score: 170, behavior: 'pressure', weapon: 'single',
    unlockLevel: 1, turretSpeed: 4.2,
  },
  {
    name: 'Pulse Striker', color: '#79ff9d', dark: '#248e50', hp: 66, speed: 138,
    radius: 20, preferred: 315, fireRate: 0.28, bulletSpeed: 880,
    damage: 6, accuracy: 0.075, score: 230, behavior: 'orbit', weapon: 'pulse',
    unlockLevel: 1, turretSpeed: 5.6, maxRange: 730, marker: 'P',
  },
  {
    name: 'Sniper', color: '#d98cff', dark: '#74359b', hp: 58, speed: 88,
    radius: 20, preferred: 600, fireRate: 1.65, bulletSpeed: 820,
    damage: 34, accuracy: 0.018, score: 240, behavior: 'kite', weapon: 'sniper',
    unlockLevel: 2, turretSpeed: 3.5,
  },
  {
    name: 'Heavy', color: '#ffdf66', dark: '#9a7d1d', hp: 145, speed: 62,
    radius: 26, preferred: 320, fireRate: 1.36, bulletSpeed: 430,
    damage: 13, accuracy: 0.11, score: 330, behavior: 'pressure', weapon: 'triple',
    unlockLevel: 3, turretSpeed: 2.1,
  },
  {
    name: 'Mortar Carrier', color: '#bd8cff', dark: '#684091', hp: 112, speed: 68,
    radius: 25, preferred: 560, fireRate: 2.55, bulletSpeed: 390,
    damage: 48, accuracy: 0.09, score: 440, behavior: 'kite', weapon: 'mortar',
    unlockLevel: 3, turretSpeed: 2.5, minRange: 170, maxRange: 830, marker: 'M',
  },
  {
    name: 'Rocketeer', color: '#ff77bd', dark: '#9b2a69', hp: 92, speed: 78,
    radius: 22, preferred: 440, fireRate: 1.82, bulletSpeed: 320,
    damage: 28, accuracy: 0.04, score: 390, behavior: 'kite', weapon: 'rocket',
    unlockLevel: 4, turretSpeed: 3.2,
  },
  {
    name: 'Bulwark', color: '#62d4ff', dark: '#246b91', hp: 142, speed: 78,
    radius: 25, preferred: 285, fireRate: 1.24, bulletSpeed: 520,
    damage: 18, accuracy: 0.07, score: 450, behavior: 'pressure', weapon: 'single',
    unlockLevel: 4, turretSpeed: 3.1, marker: 'B',
  },
  {
    name: 'Cloaker', color: '#88a6ff', dark: '#354b9b', hp: 78, speed: 128,
    radius: 20, preferred: 340, fireRate: 0.78, bulletSpeed: 650,
    damage: 17, accuracy: 0.045, score: 520, behavior: 'orbit', weapon: 'cloakPulse',
    unlockLevel: 5, turretSpeed: 5.0, marker: 'C',
  },
  {
    name: 'Mine Layer', color: '#ff9f67', dark: '#914322', hp: 118, speed: 92,
    radius: 23, preferred: 410, fireRate: 2.15, bulletSpeed: 430,
    damage: 25, accuracy: 0.09, score: 590, behavior: 'kite', weapon: 'mineLayer',
    unlockLevel: 6, turretSpeed: 3.3, marker: 'L',
  },
  {
    name: 'Repair Drone', color: '#75ffd1', dark: '#237e68', hp: 70, speed: 132,
    radius: 18, preferred: 260, fireRate: 2.1, bulletSpeed: 0,
    damage: 0, accuracy: 0, score: 610, behavior: 'support', weapon: 'repair',
    unlockLevel: 7, turretSpeed: 4.8, marker: '+',
  },
  {
    name: 'Siege Titan', color: '#ff5f88', dark: '#7f1739', hp: 1450, speed: 55,
    radius: 48, preferred: 430, fireRate: 1.1, bulletSpeed: 530,
    damage: 24, accuracy: 0.045, score: 3500, behavior: 'boss', weapon: 'boss',
    unlockLevel: 999, turretSpeed: 2.7, marker: 'Ω', boss: true,
  },
];

/** Mystery-crate bonuses. Selection is weighted so utility boosts stay common. */
export const BONUS_TYPES: BonusType[] = [
  { id: 'repair', name: 'ARMOR REPAIR', color: '#63f5ad', symbol: '+', weight: 1.25 },
  { id: 'shield', name: 'ENERGY SHIELD', color: '#70e8ff', symbol: 'S', weight: 1.0 },
  { id: 'directional', name: 'FRONT DEFLECTOR', color: '#58cfff', symbol: 'D', weight: 1.05 },
  { id: 'rapid', name: 'RAPID FIRE', color: '#ffe66d', symbol: 'R', weight: 0.9 },
  { id: 'turbo', name: 'TURBO DRIVE', color: '#ff9e5e', symbol: 'T', weight: 0.85 },
  { id: 'damage', name: 'POWER SHOT', color: '#ff72c4', symbol: 'P', weight: 0.78 },
  { id: 'score', name: 'SCORE CACHE', color: '#c9ff75', symbol: '$', weight: 0.72 },
  { id: 'weapon', name: 'WEAPON ROULETTE', color: '#c89cff', symbol: '?', weight: 0.62 },
  { id: 'armor', name: 'REACTIVE ARMOR', color: '#72a8ff', symbol: 'A', weight: 0.72 },
  { id: 'vampire', name: 'VAMPIRIC ROUNDS', color: '#ff667f', symbol: 'V', weight: 0.58 },
  { id: 'magnet', name: 'CRATE MAGNET', color: '#ffca6b', symbol: 'M', weight: 0.62 },
  { id: 'timewarp', name: 'TIME WARP', color: '#b589ff', symbol: '⏱', weight: 0.52 },
  { id: 'multishot', name: 'OVERCHARGE', color: '#73fff2', symbol: '×', weight: 0.52 },
  { id: 'gadget', name: 'GADGET REFILL', color: '#ffdb8a', symbol: 'G', weight: 0.66 },
  { id: 'emp', name: 'EMP NOVA', color: '#95c8ff', symbol: 'E', weight: 0.42 },
  { id: 'combo', name: 'COMBO LOCK', color: '#ff9df0', symbol: 'C', weight: 0.42 },
];


/** Arena themes rotate by level and define a matching environmental hazard. */
export const THEMES: Theme[] = [
  { id: 'desert', name: 'DESERT OUTPOST', hue: 38, floor: '#151109', grid: 'rgba(255,205,110,0.07)', wall: '#493621', top: '#72532f', edge: '#24190f', accent: '#ffc86b', hazard: 'wind' },
  { id: 'ice', name: 'CRYO FORTRESS', hue: 194, floor: '#07151c', grid: 'rgba(135,236,255,0.08)', wall: '#183a49', top: '#2b6577', edge: '#0b202a', accent: '#9ff4ff', hazard: 'ice' },
  { id: 'factory', name: 'IRON FOUNDRY', hue: 28, floor: '#12100e', grid: 'rgba(255,170,82,0.065)', wall: '#3d3832', top: '#625a4f', edge: '#201d1a', accent: '#ffad52', hazard: 'conveyor' },
  { id: 'space', name: 'ORBITAL GRID', hue: 265, floor: '#070712', grid: 'rgba(180,142,255,0.075)', wall: '#27223e', top: '#453b69', edge: '#121020', accent: '#be9cff', hazard: 'electric' },
  { id: 'jungle', name: 'JUNGLE RELAY', hue: 132, floor: '#08140d', grid: 'rgba(120,255,151,0.06)', wall: '#243c2a', top: '#3d6847', edge: '#102016', accent: '#87f59f', hazard: 'sludge' },
  { id: 'volcanic', name: 'MAGMA CITADEL', hue: 8, floor: '#160806', grid: 'rgba(255,103,74,0.075)', wall: '#44211d', top: '#713129', edge: '#240d0b', accent: '#ff755d', hazard: 'lava' },
];

/** Permanent weapon upgrades found inside rare arena crates. */
export const UPGRADE_MAX_RANK = 5;
/** Defines the shared upgrade max total. */
export const UPGRADE_MAX_TOTAL = UPGRADE_MAX_RANK * 6;
/** Defines the shared upgrade crate color. */
export const UPGRADE_CRATE_COLOR = '#ffcf68';
/** Defines the shared upgrade stats. */
export const UPGRADE_STATS: UpgradeStat[] = [
  { id: 'damage', name: 'DAMAGE CORE', description: '+11% weapon damage per rank.' },
  { id: 'cooldown', name: 'CYCLING ARRAY', description: '+6% fire rate per rank.' },
  { id: 'speed', name: 'VELOCITY COIL', description: '+7% projectile speed per rank.' },
  { id: 'special', name: 'SPECIALIST MOD', description: 'Improves the weapon’s unique trait.' },
  { id: 'critical', name: 'CRITICAL MATRIX', description: '+4% critical-hit chance per rank.' },
  { id: 'sustain', name: 'SUSTAINED PAYLOAD', description: 'Longer range, larger payload, and more piercing.' },
];


/**
 * Enemy weapon families mirror the nearest player weapon. Their effective
 * rank rises every map and also follows 82% of the matching player weapon's
 * permanent rank, preventing an early maxed weapon from trivializing later
 * arenas while keeping the many-enemies-vs-one-player balance reasonable.
 */
export const ENEMY_WEAPON_PARITY: Readonly<Record<EnemyType['weapon'], number>> = Object.freeze({
  single: 0,
  sniper: 0,
  triple: 2,
  pulse: 1,
  cloakPulse: 1,
  mortar: 4,
  rocket: 3,
  mineLayer: 4,
  repair: 0,
  boss: 0,
});

/** Player-deployed secondary systems. */
export const GADGETS: GadgetDefinition[] = [
  { id: 'mine', name: 'PROXIMITY MINE', key: 'Z', color: '#ffca6b', maxCharges: 4 },
  { id: 'stasis', name: 'STASIS FIELD', key: 'X', color: '#9f8cff', maxCharges: 2 },
  { id: 'barrier', name: 'LASER BARRIER', key: 'C', color: '#67efff', maxCharges: 2 },
];

