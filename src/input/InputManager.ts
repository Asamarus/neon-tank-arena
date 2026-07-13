import type { Player, Point } from '../game/types.ts'

/** Mutable state for one side of the mobile twin-stick controller. */
export interface TouchStick extends Point {
  /** Id value. */
  id: number
  /** Whether active. */
  active: boolean
  /** Origin x value. */
  originX: number
  /** Origin y value. */
  originY: number
}

/** Commands that keyboard and pointer input can send to the game. */
export interface GameInputCommands {
  /** Callback used to provide get player weapon index. */
  getPlayerWeaponIndex: () => number
  /** Callback used to provide get view width. */
  getViewWidth: () => number
  /** Callback used to provide select weapon. */
  selectWeapon: (index: number) => void
  /** Callback used to provide deploy gadget. */
  deployGadget: (id: string) => void
  /** Callback used to provide toggle pause. */
  togglePause: () => void
}

/** Coordinates keyboard, mouse, pen, and touch controls for the arena. */
export class InputManager {
  /** Stores the canvas. */
  private readonly canvas: HTMLCanvasElement
  /** Stores the commands. */
  private readonly commands: GameInputCommands
  /** Stores the move touch. */
  public readonly moveTouch: TouchStick
  /** Stores the aim touch. */
  public readonly aimTouch: TouchStick
  /** Stores the keys. */
  public readonly keys = new Set<string>()
  /** Stores the mouse x. */
  public mouseX = 0
  /** Stores the mouse y. */
  public mouseY = 0
  /** Stores the mouse down. */
  public mouseDown = false
  /** Stores the mouse seen. */
  public mouseSeen = false

  /** Creates a new InputManager instance. */
  public constructor(canvas: HTMLCanvasElement, commands: GameInputCommands) {
    this.canvas = canvas
    this.commands = commands
    this.moveTouch = InputManager.makeStick()
    this.aimTouch = InputManager.makeStick()
    this.bindEvents()
  }

  /** Performs the make stick operation. */
  private static makeStick(): TouchStick {
    return { id: -1, active: false, originX: 0, originY: 0, x: 0, y: 0 }
  }

  /** Performs the bind events operation. */
  private bindEvents(): void {
    window.addEventListener('keydown', (event) => this.onKeyDown(event))
    window.addEventListener('keyup', (event) => {
      this.keys.delete(event.key.toLowerCase())
      this.keys.delete(event.code.toLowerCase())
    })
    window.addEventListener('blur', () => {
      this.keys.clear()
      this.mouseDown = false
      this.resetTouches()
    })

    this.canvas.addEventListener('pointerdown', (event) => this.onPointerDown(event))
    this.canvas.addEventListener('pointermove', (event) => this.onPointerMove(event))
    this.canvas.addEventListener('pointerup', (event) => this.onPointerUp(event))
    this.canvas.addEventListener('pointercancel', (event) => this.onPointerUp(event))
    this.canvas.addEventListener('contextmenu', (event) => event.preventDefault())
  }

  /** Performs the on key down operation. */
  private onKeyDown(event: KeyboardEvent): void {
    const key = event.key.toLowerCase()
    const code = event.code.toLowerCase()
    this.keys.add(key)
    this.keys.add(code)
    const movementKeys = [
      'arrowup',
      'arrowdown',
      'arrowleft',
      'arrowright',
      ' ',
      'w',
      'a',
      's',
      'd',
    ]
    if (movementKeys.includes(key) || code.startsWith('key')) event.preventDefault()

    if (key >= '1' && key <= '5') this.commands.selectWeapon(Number(key) - 1)
    if (key === 'q' || code === 'keyq') this.cycleWeapon(-1)
    if (key === 'e' || code === 'keye') this.cycleWeapon(1)
    if (!event.repeat && (key === 'z' || code === 'keyz')) this.commands.deployGadget('mine')
    if (!event.repeat && (key === 'x' || code === 'keyx')) this.commands.deployGadget('stasis')
    if (!event.repeat && (key === 'c' || code === 'keyc')) this.commands.deployGadget('barrier')
    if (key === 'p' || key === 'escape' || code === 'keyp') this.commands.togglePause()
  }

  /** Performs the cycle weapon operation. */
  private cycleWeapon(direction: -1 | 1): void {
    const weaponCount = 5
    const next = (this.commands.getPlayerWeaponIndex() + direction + weaponCount) % weaponCount
    this.commands.selectWeapon(next)
  }

  /** Converts pointer coordinates to CSS-pixel canvas coordinates. */
  private localPoint(event: PointerEvent): Point {
    const rect = this.canvas.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  /** Performs the on pointer down operation. */
  private onPointerDown(event: PointerEvent): void {
    const point = this.localPoint(event)
    this.canvas.setPointerCapture(event.pointerId)

    if (event.pointerType === 'mouse' || event.pointerType === 'pen') {
      this.mouseSeen = true
      this.mouseX = point.x
      this.mouseY = point.y
      this.mouseDown = event.button === 0
      return
    }

    const stick = point.x < this.commands.getViewWidth() * 0.5 ? this.moveTouch : this.aimTouch
    if (!stick.active) {
      Object.assign(stick, {
        id: event.pointerId,
        active: true,
        originX: point.x,
        originY: point.y,
        x: point.x,
        y: point.y,
      })
    }
    event.preventDefault()
  }

  /** Performs the on pointer move operation. */
  private onPointerMove(event: PointerEvent): void {
    const point = this.localPoint(event)
    if (event.pointerType === 'mouse' || event.pointerType === 'pen') {
      this.mouseSeen = true
      this.mouseX = point.x
      this.mouseY = point.y
      if (event.buttons === 0) this.mouseDown = false
      return
    }

    const stick = this.findStick(event.pointerId)
    if (stick) {
      const dx = point.x - stick.originX
      const dy = point.y - stick.originY
      const length = Math.hypot(dx, dy) || 1
      const maxRadius = 58
      const scale = Math.min(1, maxRadius / length)
      stick.x = stick.originX + dx * scale
      stick.y = stick.originY + dy * scale
    }
    event.preventDefault()
  }

  /** Performs the find stick operation. */
  private findStick(pointerId: number): TouchStick | null {
    if (this.moveTouch.id === pointerId) return this.moveTouch
    if (this.aimTouch.id === pointerId) return this.aimTouch
    return null
  }

  /** Performs the on pointer up operation. */
  private onPointerUp(event: PointerEvent): void {
    if (event.pointerType === 'mouse' || event.pointerType === 'pen') {
      this.mouseDown = false
      return
    }

    if (this.moveTouch.id === event.pointerId)
      Object.assign(this.moveTouch, InputManager.makeStick())
    if (this.aimTouch.id === event.pointerId) Object.assign(this.aimTouch, InputManager.makeStick())
    event.preventDefault()
  }

  /** Performs the reset touches operation. */
  private resetTouches(): void {
    Object.assign(this.moveTouch, InputManager.makeStick())
    Object.assign(this.aimTouch, InputManager.makeStick())
  }

  /** Returns a normalized movement vector from the active input sources. */
  public getMovement(): Point {
    let x = 0
    let y = 0
    if (this.keys.has('a') || this.keys.has('keya') || this.keys.has('arrowleft')) x -= 1
    if (this.keys.has('d') || this.keys.has('keyd') || this.keys.has('arrowright')) x += 1
    if (this.keys.has('w') || this.keys.has('keyw') || this.keys.has('arrowup')) y -= 1
    if (this.keys.has('s') || this.keys.has('keys') || this.keys.has('arrowdown')) y += 1

    if (this.moveTouch.active) {
      x += (this.moveTouch.x - this.moveTouch.originX) / 58
      y += (this.moveTouch.y - this.moveTouch.originY) / 58
    }

    const length = Math.hypot(x, y)
    return length > 1 ? { x: x / length, y: y / length } : { x, y }
  }

  /** Returns the desired turret angle in world space. */
  public getAimAngle(player: Player, cameraX: number, cameraY: number): number {
    if (this.aimTouch.active) {
      const dx = this.aimTouch.x - this.aimTouch.originX
      const dy = this.aimTouch.y - this.aimTouch.originY
      if (dx * dx + dy * dy > 36) return Math.atan2(dy, dx)
    }
    if (this.mouseSeen) {
      return Math.atan2(this.mouseY + cameraY - player.y, this.mouseX + cameraX - player.x)
    }
    return player.turretAngle
  }

  /** Reports whether a keyboard, mouse, or touch fire control is active. */
  public shouldFire(): boolean {
    const aimDx = this.aimTouch.x - this.aimTouch.originX
    const aimDy = this.aimTouch.y - this.aimTouch.originY
    const touchFire = this.aimTouch.active && aimDx * aimDx + aimDy * aimDy > 225
    return this.mouseDown || this.keys.has(' ') || touchFire
  }
}
