import type { Point, RandomSource, Rectangle } from './types.ts'

/** @param {number} value @param {number} min @param {number} max */
export const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value))

/** @param {number} a @param {number} b @param {number} t */
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

/** Normalize an angle to the -PI..PI interval. */
export function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle))
}

/** Turn an angle toward a target by at most maxStep radians. */
export function turnToward(current: number, target: number, maxStep: number): number {
  const delta = normalizeAngle(target - current)
  return current + clamp(delta, -maxStep, maxStep)
}

/** @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2 */
export function distanceSquared(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1
  const dy = y2 - y1
  return dx * dx + dy * dy
}

/** Squared distance from a point to a finite line segment. */
export function pointSegmentDistanceSquared(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1
  const dy = y2 - y1
  const length2 = dx * dx + dy * dy || 1
  const t = clamp(((px - x1) * dx + (py - y1) * dy) / length2, 0, 1)
  return distanceSquared(px, py, x1 + dx * t, y1 + dy * t)
}

/** Deterministic PRNG used for repeatable procedural levels. */
export function mulberry32(seed: number): RandomSource {
  return function random() {
    let t = (seed += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** @param {() => number} random @param {number} min @param {number} max */
export function randomRange(random: RandomSource, min: number, max: number): number {
  return min + (max - min) * random()
}

/** @param {() => number} random @param {number} min @param {number} max */
export function randomInt(random: RandomSource, min: number, max: number): number {
  return Math.floor(randomRange(random, min, max + 1))
}

/** True when two padded axis-aligned rectangles overlap. */
export function rectanglesOverlap(a: Rectangle, b: Rectangle, padding = 0): boolean {
  return !(
    a.x + a.w + padding < b.x ||
    b.x + b.w + padding < a.x ||
    a.y + a.h + padding < b.y ||
    b.y + b.h + padding < a.y
  )
}

/** True when a circle overlaps a rectangle. */
export function circleIntersectsRect(
  x: number,
  y: number,
  radius: number,
  rect: Rectangle,
): boolean {
  const nx = clamp(x, rect.x, rect.x + rect.w)
  const ny = clamp(y, rect.y, rect.y + rect.h)
  return distanceSquared(x, y, nx, ny) < radius * radius
}

/**
 * Push a circle out of a rectangle in-place.
 * @param {{x:number,y:number}} circle
 * @param {number} radius
 * @param {{x:number,y:number,w:number,h:number}} rect
 * @returns {boolean} whether a collision occurred
 */
export function resolveCircleRect(circle: Point, radius: number, rect: Rectangle): boolean {
  const nx = clamp(circle.x, rect.x, rect.x + rect.w)
  const ny = clamp(circle.y, rect.y, rect.y + rect.h)
  let dx = circle.x - nx
  let dy = circle.y - ny
  const dist2 = dx * dx + dy * dy

  if (dist2 >= radius * radius) return false

  if (dist2 > 0.0001) {
    const dist = Math.sqrt(dist2)
    const push = radius - dist
    circle.x += (dx / dist) * push
    circle.y += (dy / dist) * push
    return true
  }

  // Circle center is inside the rectangle: choose the shortest exit direction.
  const left = Math.abs(circle.x - rect.x)
  const right = Math.abs(rect.x + rect.w - circle.x)
  const top = Math.abs(circle.y - rect.y)
  const bottom = Math.abs(rect.y + rect.h - circle.y)
  const smallest = Math.min(left, right, top, bottom)

  if (smallest === left) circle.x = rect.x - radius
  else if (smallest === right) circle.x = rect.x + rect.w + radius
  else if (smallest === top) circle.y = rect.y - radius
  else circle.y = rect.y + rect.h + radius
  return true
}

/** Mutable parameter interval used by Liang-Barsky clipping. */
interface ClipRange {
  /** Earliest visible point along the segment. */
  start: number
  /** Latest visible point along the segment. */
  end: number
}

/** Narrows a segment's visible parameter interval against one rectangle edge. */
function clipAgainstEdge(direction: number, distance: number, range: ClipRange): boolean {
  if (direction === 0) return distance >= 0

  const ratio = distance / direction
  if (direction < 0) {
    if (ratio > range.end) return false
    range.start = Math.max(range.start, ratio)
  } else {
    if (ratio < range.start) return false
    range.end = Math.min(range.end, ratio)
  }
  return true
}

/** Liang-Barsky-style segment/rectangle intersection. */
export function segmentIntersectsRect(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  rect: Rectangle,
): boolean {
  const deltaX = x2 - x1
  const deltaY = y2 - y1
  const range = { start: 0, end: 1 }

  return (
    clipAgainstEdge(-deltaX, x1 - rect.x, range) &&
    clipAgainstEdge(deltaX, rect.x + rect.w - x1, range) &&
    clipAgainstEdge(-deltaY, y1 - rect.y, range) &&
    clipAgainstEdge(deltaY, rect.y + rect.h - y1, range)
  )
}
