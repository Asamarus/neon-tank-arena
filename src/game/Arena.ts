import { TAU, THEMES } from './config.ts'
import {
  circleIntersectsRect,
  clamp,
  distanceSquared,
  randomInt,
  randomRange,
  rectanglesOverlap,
  resolveCircleRect,
  segmentIntersectsRect,
} from './geometry.ts'
import type {
  CircleBody,
  Hazard,
  Obstacle,
  Point,
  RandomSource,
  Rectangle,
  TerrainEffect,
  Theme,
} from './types.ts'

/** Owns procedural arena layout, collision queries, terrain, and floor texture. */
export class Arena {
  /** Width of the generated arena in world units. */
  public worldWidth = 1800
  /** Height of the generated arena in world units. */
  public worldHeight = 1200
  /** Visual and hazard theme active for the current level. */
  public theme: Theme = THEMES[0]
  /** Cached hue used by lightweight rendering effects. */
  public themeHue = this.theme.hue
  /** Solid and destructible arena walls. */
  public readonly obstacles: Obstacle[] = []
  /** Theme-specific terrain hazard zones. */
  public readonly hazards: Hazard[] = []
  /** Repeating floor pattern regenerated with each theme. */
  public floorPattern: CanvasPattern | null = null
  /** Canvas context used only to create the repeating floor pattern. */
  private readonly context: CanvasRenderingContext2D

  /** Creates an arena manager for the game's canvas context. */
  public constructor(context: CanvasRenderingContext2D) {
    this.context = context
  }

  /** Generates deterministic walls and hazards for one campaign level. */
  public generate(level: number, random: RandomSource): Point {
    this.worldWidth = Math.min(2500, 1500 + level * 34)
    this.worldHeight = Math.min(1750, 980 + level * 25)
    this.theme = THEMES[(level - 1) % THEMES.length]
    this.themeHue = this.theme.hue
    this.obstacles.length = 0
    this.hazards.length = 0

    const spawn = { x: this.worldWidth * 0.5, y: this.worldHeight * 0.5 }
    const spawnSafe = { x: spawn.x - 170, y: spawn.y - 170, w: 340, h: 340 }
    this.generateWalls(level, random, spawnSafe)
    this.generateHazards(level, random, spawnSafe)
    this.buildFloorPattern()
    return spawn
  }

  /** Places collision walls while preserving a clear central spawn area. */
  private generateWalls(level: number, random: RandomSource, spawnSafe: Rectangle): void {
    const wallCount = Math.min(34, 11 + Math.floor(level * 1.35))
    for (let index = 0; index < wallCount; index += 1) {
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const wall = this.createWall(level, random)
        if (!this.canPlaceWall(wall, spawnSafe)) continue
        this.obstacles.push(wall)
        break
      }
    }
  }

  /** Creates one candidate wall aligned to the arena grid. */
  private createWall(level: number, random: RandomSource): Obstacle {
    const horizontal = random() > 0.45
    const grid = 48
    const width = horizontal ? randomInt(random, 2, 5) * grid : randomInt(random, 1, 2) * grid
    const height = horizontal ? randomInt(random, 1, 2) * grid : randomInt(random, 2, 5) * grid
    const destructible = random() < Math.min(0.62, 0.36 + level * 0.012)
    const maxHp = Math.round(48 + (width * height) / 780 + level * 2.5)
    return {
      x: Math.round(randomRange(random, 90, this.worldWidth - width - 90) / grid) * grid,
      y: Math.round(randomRange(random, 90, this.worldHeight - height - 90) / grid) * grid,
      w: width,
      h: height,
      destructible,
      hp: destructible ? maxHp : Infinity,
      maxHp: destructible ? maxHp : Infinity,
    }
  }

  /** Returns whether a candidate wall preserves spawn and wall clearances. */
  private canPlaceWall(wall: Obstacle, spawnSafe: Rectangle): boolean {
    return (
      !rectanglesOverlap(wall, spawnSafe, 30) &&
      !this.obstacles.some((other) => rectanglesOverlap(wall, other, 34))
    )
  }

  /** Generates theme hazards without overlapping walls or the player spawn. */
  private generateHazards(level: number, random: RandomSource, spawnSafe: Rectangle): void {
    const count = Math.min(7, 2 + Math.floor(level / 3))
    for (let index = 0; index < count; index += 1) {
      for (let attempt = 0; attempt < 70; attempt += 1) {
        const hazard = this.createHazard(random)
        if (!this.canPlaceHazard(hazard, spawnSafe)) continue
        this.hazards.push(hazard)
        break
      }
    }
  }

  /** Creates one candidate hazard for the active arena theme. */
  private createHazard(random: RandomSource): Hazard {
    const circular = this.theme.hazard !== 'conveyor' && random() < 0.62
    const width = circular ? randomRange(random, 110, 190) : randomRange(random, 150, 270)
    const height = circular ? width : randomRange(random, 62, 110)
    return {
      x: randomRange(random, 70, this.worldWidth - width - 70),
      y: randomRange(random, 70, this.worldHeight - height - 70),
      w: width,
      h: height,
      kind: this.theme.hazard,
      circular,
      phase: random() * TAU,
      direction: random() * TAU,
    }
  }

  /** Returns whether a candidate hazard preserves all arena clearances. */
  private canPlaceHazard(hazard: Hazard, spawnSafe: Rectangle): boolean {
    return (
      !rectanglesOverlap(hazard, spawnSafe, 80) &&
      !this.obstacles.some((wall) => rectanglesOverlap(hazard, wall, 12)) &&
      !this.hazards.some((other) => rectanglesOverlap(hazard, other, 55))
    )
  }

  /** Finds an open spawn point separated from a reference position. */
  public findOpenPoint(
    random: RandomSource,
    radius: number,
    minDistance: number,
    referenceX: number,
    referenceY: number,
  ): Point {
    const margin = radius + 60
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const x = randomRange(random, margin, this.worldWidth - margin)
      const y = randomRange(random, margin, this.worldHeight - margin)
      if (distanceSquared(x, y, referenceX, referenceY) < minDistance * minDistance) continue
      if (this.obstacles.some((wall) => circleIntersectsRect(x, y, radius + 16, wall))) continue
      return { x, y }
    }
    return this.findFallbackPoint(radius, minDistance, referenceX, referenceY)
  }

  /** Searches outward from the center when random spawn attempts are exhausted. */
  private findFallbackPoint(
    radius: number,
    minDistance: number,
    referenceX: number,
    referenceY: number,
  ): Point {
    const margin = radius + 60
    const centerX = this.worldWidth * 0.5
    const centerY = this.worldHeight * 0.5
    for (let ring = 0; ring < 8; ring += 1) {
      const searchRadius = ring * 72
      const samples = ring === 0 ? 1 : 12 + ring * 4
      for (let sample = 0; sample < samples; sample += 1) {
        const angle = samples === 1 ? 0 : (sample / samples) * TAU
        const x = clamp(centerX + Math.cos(angle) * searchRadius, margin, this.worldWidth - margin)
        const y = clamp(centerY + Math.sin(angle) * searchRadius, margin, this.worldHeight - margin)
        if (distanceSquared(x, y, referenceX, referenceY) < minDistance * minDistance) continue
        if (!this.isBlocked(x, y, radius + 16)) return { x, y }
      }
    }
    return { x: centerX, y: centerY }
  }

  /** Rebuilds the small repeating floor texture for the current theme. */
  public buildFloorPattern(): void {
    const tile = document.createElement('canvas')
    const size = 192
    tile.width = size
    tile.height = size
    const tileContext = tile.getContext('2d', { alpha: false })
    if (!tileContext) return
    tileContext.fillStyle = this.theme.floor
    tileContext.fillRect(0, 0, size, size)
    tileContext.strokeStyle = this.theme.grid
    tileContext.lineWidth = 1
    for (let offset = 0; offset <= size; offset += 48) {
      tileContext.beginPath()
      tileContext.moveTo(offset + 0.5, 0)
      tileContext.lineTo(offset + 0.5, size)
      tileContext.stroke()
      tileContext.beginPath()
      tileContext.moveTo(0, offset + 0.5)
      tileContext.lineTo(size, offset + 0.5)
      tileContext.stroke()
    }
    tileContext.strokeStyle = `${this.theme.accent}24`
    tileContext.strokeRect(0.5, 0.5, size - 1, size - 1)
    this.floorPattern = this.context.createPattern(tile, 'repeat')
  }

  /** Tests whether a circle overlaps the current camera viewport. */
  public isCircleVisible(
    x: number,
    y: number,
    radius: number,
    margin: number,
    viewport: Rectangle,
  ): boolean {
    return (
      x + radius >= viewport.x - margin &&
      y + radius >= viewport.y - margin &&
      x - radius <= viewport.x + viewport.w + margin &&
      y - radius <= viewport.y + viewport.h + margin
    )
  }

  /** Tests whether a rectangle overlaps the current camera viewport. */
  public isRectVisible(rectangle: Rectangle, margin: number, viewport: Rectangle): boolean {
    return (
      rectangle.x + rectangle.w >= viewport.x - margin &&
      rectangle.y + rectangle.h >= viewport.y - margin &&
      rectangle.x <= viewport.x + viewport.w + margin &&
      rectangle.y <= viewport.y + viewport.h + margin
    )
  }

  /** Returns the combined movement and damage modifiers at a world point. */
  public getTerrainEffect(x: number, y: number): TerrainEffect {
    const effect = { speed: 1, turn: 1, pushX: 0, pushY: 0, damage: 0, active: false }
    for (const hazard of this.hazards) {
      if (!this.pointInHazard(x, y, hazard)) continue
      effect.active = true
      this.applyHazardEffect(effect, hazard)
    }
    return effect
  }

  /** Applies one hazard's movement and damage modifiers. */
  private applyHazardEffect(effect: TerrainEffect, hazard: Hazard): void {
    if (hazard.kind === 'lava') {
      effect.speed *= 0.82
      effect.damage += 14
    } else if (hazard.kind === 'electric') {
      if (Math.sin(performance.now() * 0.004 + hazard.phase) > 0.15) effect.damage += 18
    } else if (hazard.kind === 'ice') {
      effect.speed *= 1.18
      effect.turn *= 0.48
    } else if (hazard.kind === 'conveyor') {
      effect.pushX += Math.cos(hazard.direction) * 105
      effect.pushY += Math.sin(hazard.direction) * 105
    } else if (hazard.kind === 'sludge') {
      effect.speed *= 0.56
      effect.turn *= 0.72
    } else if (hazard.kind === 'wind') {
      effect.pushX += Math.cos(hazard.direction) * 58
      effect.pushY += Math.sin(hazard.direction) * 58
      effect.speed *= 0.94
    }
  }

  /** Tests whether a point lies inside a rectangular or circular hazard. */
  private pointInHazard(x: number, y: number, hazard: Hazard, padding = 0): boolean {
    if (hazard.circular) {
      const radius = Math.min(hazard.w, hazard.h) * 0.5 + padding
      return (
        distanceSquared(x, y, hazard.x + hazard.w * 0.5, hazard.y + hazard.h * 0.5) <=
        radius * radius
      )
    }
    return (
      x >= hazard.x - padding &&
      x <= hazard.x + hazard.w + padding &&
      y >= hazard.y - padding &&
      y <= hazard.y + hazard.h + padding
    )
  }

  /** Clamps a circular body to arena bounds and resolves wall penetration. */
  public resolveTankWorld(tank: CircleBody): boolean {
    const beforeX = tank.x
    const beforeY = tank.y
    tank.x = clamp(tank.x, tank.radius, this.worldWidth - tank.radius)
    tank.y = clamp(tank.y, tank.radius, this.worldHeight - tank.radius)
    let collided = tank.x !== beforeX || tank.y !== beforeY
    for (const obstacle of this.obstacles) {
      if (resolveCircleRect(tank, tank.radius, obstacle)) collided = true
    }
    return collided
  }

  /** Reports whether a circle overlaps arena bounds or a wall. */
  public isBlocked(x: number, y: number, radius: number): boolean {
    if (
      x - radius < 0 ||
      y - radius < 0 ||
      x + radius > this.worldWidth ||
      y + radius > this.worldHeight
    ) {
      return true
    }
    return this.obstacles.some((wall) => circleIntersectsRect(x, y, radius, wall))
  }

  /** Reports whether a line segment reaches its target without crossing a wall. */
  public hasLineOfSight(x1: number, y1: number, x2: number, y2: number): boolean {
    return !this.obstacles.some((wall) => segmentIntersectsRect(x1, y1, x2, y2, wall))
  }
}
