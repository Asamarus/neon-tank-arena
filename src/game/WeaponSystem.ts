import {
  ENEMY_WEAPON_PARITY,
  UPGRADE_MAX_RANK,
  UPGRADE_MAX_TOTAL,
  UPGRADE_STATS,
  WEAPONS,
} from './config.ts'
import { clamp } from './geometry.ts'
import type {
  EffectiveWeapon,
  Enemy,
  EnemyType,
  EnemyWeaponProfile,
  RandomSource,
  UpgradeBox,
  UpgradeOffer,
  UpgradeStatId,
  WeaponUpgradeRanks,
} from './types.ts'

/** Result of applying one permanent weapon upgrade. */
export interface UpgradeResult {
  /** Rank after attempting to apply the upgrade. */
  rank: number
  /** Whether maxed. */
  maxed: boolean
}

/** Owns permanent weapon ranks and derived combat profiles. */
export class WeaponSystem {
  /** Permanent upgrade ranks for every player weapon. */
  private readonly upgrades: WeaponUpgradeRanks[]
  /** Cached effective definitions invalidated whenever a rank changes. */
  private readonly cache: Array<EffectiveWeapon | null>

  /** Creates empty rank tracks for every configured weapon. */
  public constructor() {
    this.upgrades = WEAPONS.map(() => WeaponSystem.createEmptyRanks())
    this.cache = new Array<EffectiveWeapon | null>(WEAPONS.length).fill(null)
  }

  /** Creates a zeroed set of all permanent upgrade tracks. */
  private static createEmptyRanks(): WeaponUpgradeRanks {
    return { damage: 0, cooldown: 0, speed: 0, special: 0, critical: 0, sustain: 0 }
  }

  /** Clears all permanent ranks for a brand-new campaign. */
  public reset(): void {
    for (let index = 0; index < this.upgrades.length; index += 1) {
      this.upgrades[index] = WeaponSystem.createEmptyRanks()
      this.cache[index] = null
    }
  }

  /** Returns the mutable rank record for one weapon. */
  public getRanks(index: number): WeaponUpgradeRanks {
    return this.upgrades[index]
  }

  /** Returns a weapon definition after all permanent upgrades are applied. */
  public getEffectiveWeapon(index: number): EffectiveWeapon {
    const cached = this.cache[index]
    if (cached) return cached
    const base = WEAPONS[index]
    const ranks = this.upgrades[index]
    const weapon: EffectiveWeapon = {
      ...base,
      damage: base.damage * (1 + ranks.damage * 0.11),
      cooldown: base.cooldown * Math.max(0.36, 1 - ranks.cooldown * 0.06),
      speed: base.speed * (1 + ranks.speed * 0.07),
      life: base.life * (1 + ranks.sustain * 0.08),
      radius: base.radius * (1 + ranks.sustain * 0.025),
      bounce: base.bounce,
      count: base.count,
      splash: (base.splash ?? 0) * (1 + ranks.sustain * 0.055),
      turnRate: base.turnRate ?? 0,
      critChance: ranks.critical * 0.04,
      critMultiplier: 1.75 + ranks.critical * 0.08,
      pierce: Math.floor(ranks.sustain / 3),
      chain: 0,
      cluster: 0,
    }
    WeaponSystem.applySpecialUpgrades(weapon, ranks)
    this.cache[index] = weapon
    return weapon
  }

  /** Applies upgrades unique to each projectile family. */
  private static applySpecialUpgrades(weapon: EffectiveWeapon, ranks: WeaponUpgradeRanks): void {
    if (weapon.type === 'shell') {
      weapon.bounce += Math.floor((ranks.special + 1) / 2)
      weapon.pierce += ranks.special >= 4 ? 1 : 0
    } else if (weapon.type === 'pulse') {
      weapon.count += Math.floor(ranks.special / 2)
      weapon.spread += Math.floor(ranks.special / 2) * 0.045
      weapon.chain = ranks.special >= 3 ? 1 + Math.floor((ranks.special - 3) / 2) : 0
    } else if (weapon.type === 'pellet') {
      weapon.count += ranks.special * 2
      weapon.spread = Math.max(0.16, weapon.spread - ranks.sustain * 0.018)
    } else if (weapon.type === 'rocket') {
      weapon.splash += ranks.special * 14
      weapon.turnRate += ranks.special * 0.36
      weapon.cluster = ranks.special >= 5 ? 3 : 0
    } else if (weapon.type === 'mortar') {
      weapon.splash += ranks.special * 18
      weapon.cluster = Math.floor(ranks.special / 2)
    }
  }

  /** Returns the total permanent rank of one player weapon. */
  public getUpgradeTotal(index: number): number {
    const ranks = this.upgrades[index]
    return (
      ranks.damage + ranks.cooldown + ranks.speed + ranks.special + ranks.critical + ranks.sustain
    )
  }

  /** Builds the progression profile used by an enemy weapon family. */
  public getEnemyWeaponProfile(enemy: Enemy, type: EnemyType, level: number): EnemyWeaponProfile {
    const playerWeaponIndex = ENEMY_WEAPON_PARITY[type.weapon] ?? 0
    const playerRank = this.getUpgradeTotal(playerWeaponIndex)
    const mapRank = clamp(level, 0, UPGRADE_MAX_TOTAL)
    const parityRank = playerRank * 0.82
    const classBonus = enemy.elite ? 2 : 0
    const rank = clamp(Math.max(mapRank, parityRank) + classBonus, 0, UPGRADE_MAX_TOTAL)
    const progress = rank / UPGRADE_MAX_TOTAL
    return {
      rank,
      damage: 1 + progress * 0.55,
      cooldown: 1 - progress * 0.28,
      speed: 1 + progress * 0.28,
      accuracy: 1 - progress * 0.35,
      splash: 1 + progress * 0.25,
      homing: 1 + progress * 0.2,
      life: 1 + progress * 0.12,
    }
  }

  /** Returns every unreserved weapon/stat pair below its rank cap. */
  public getAvailableUpgrades(boxes: readonly UpgradeBox[]): UpgradeOffer[] {
    const options: UpgradeOffer[] = []
    const reserved = new Map<string, number>()
    for (const box of boxes) {
      const key = `${box.weaponIndex}:${box.statId}`
      reserved.set(key, (reserved.get(key) ?? 0) + 1)
    }
    for (let weaponIndex = 0; weaponIndex < WEAPONS.length; weaponIndex += 1) {
      const ranks = this.upgrades[weaponIndex]
      for (let statIndex = 0; statIndex < UPGRADE_STATS.length; statIndex += 1) {
        const stat = UPGRADE_STATS[statIndex]
        const reservedRanks = reserved.get(`${weaponIndex}:${stat.id}`) ?? 0
        if (ranks[stat.id] + reservedRanks < UPGRADE_MAX_RANK) {
          options.push({ weaponIndex, statId: stat.id, statIndex })
        }
      }
    }
    return options
  }

  /** Chooses a valid upgrade, favoring the currently equipped weapon. */
  public buildUpgradeOffer(
    boxes: readonly UpgradeBox[],
    preferredWeaponIndex: number,
    random: RandomSource,
  ): UpgradeOffer | null {
    const options = this.getAvailableUpgrades(boxes)
    if (options.length === 0) return null
    const preferred = options.filter((option) => option.weaponIndex === preferredWeaponIndex)
    const pool = preferred.length > 0 && random() < 0.58 ? preferred : options
    return pool[Math.floor(random() * pool.length)]
  }

  /** Applies one capped permanent rank and invalidates its derived weapon. */
  public applyUpgrade(weaponIndex: number, statId: UpgradeStatId): UpgradeResult {
    const ranks = this.upgrades[weaponIndex]
    const currentRank = ranks[statId]
    if (currentRank >= UPGRADE_MAX_RANK) return { rank: currentRank, maxed: true }
    const rank = Math.min(UPGRADE_MAX_RANK, currentRank + 1)
    ranks[statId] = rank
    this.cache[weaponIndex] = null
    return { rank, maxed: false }
  }
}
