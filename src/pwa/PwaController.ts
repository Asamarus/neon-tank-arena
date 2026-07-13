interface AppBuild {
  /** Version value. */
  version: string
  /** Remote version url value. */
  remoteVersionUrl: string
  /** Local version url value. */
  localVersionUrl: string
  /** Update interval ms value. */
  updateIntervalMs: number
}

interface RemoteVersion {
  /** Version value. */
  version?: string
}

interface InstallChoice {
  /** Outcome value. */
  outcome: 'accepted' | 'dismissed'
  /** Platform value. */
  platform: string
}

interface BeforeInstallPromptEvent extends Event {
  /** Callback used to provide prompt. */
  prompt: () => Promise<void>
  /** User choice value. */
  userChoice: Promise<InstallChoice>
}

interface NavigatorWithStandalone extends Navigator {
  /** Whether standalone. */
  standalone?: boolean
}

interface WorkerMessage {
  /** Type value. */
  type?: string
  /** Version value. */
  version?: string
}

/** Returns an element when it exists, allowing PWA controls to stay optional. */
function findElement<T extends Element>(selector: string): T | null {
  return document.querySelector<T>(selector)
}

/** Manages installation, connectivity feedback, and safe service-worker updates. */
export class PwaController {
  /** Stores the build. */
  private readonly build: AppBuild
  /** Stores the install button. */
  private readonly installButton = findElement<HTMLButtonElement>('#installButton')
  /** Stores the update button. */
  private readonly updateButton = findElement<HTMLButtonElement>('#updateButton')
  /** Stores the status. */
  private readonly status = findElement<HTMLElement>('#pwaStatus')
  /** Stores the deferred install prompt. */
  private deferredInstallPrompt: BeforeInstallPromptEvent | null = null
  /** Stores the registration. */
  private registration: ServiceWorkerRegistration | null = null
  /** Stores the refreshing. */
  private refreshing = false
  /** Stores the has controller. */
  private hasController = Boolean(navigator.serviceWorker?.controller)
  /** Stores the status timer. */
  private statusTimer = 0

  /** Creates a new PwaController instance. */
  public constructor(build: AppBuild) {
    this.build = build
    const versionMeta = findElement<HTMLMetaElement>('meta[name="app-version"]')
    if (versionMeta) versionMeta.content = build.version
  }

  /** Activates the PWA lifecycle when the browser supports secure workers. */
  public initialize(): void {
    this.bindInstallEvents()
    this.bindConnectivityEvents()
    this.updateConnectivityUi()

    if (!('serviceWorker' in navigator)) {
      this.showStatus('THIS BROWSER DOES NOT SUPPORT OFFLINE INSTALLATION', true)
      return
    }
    if (!window.isSecureContext) {
      this.showStatus('PWA INSTALLATION REQUIRES HTTPS', true)
      return
    }

    this.bindServiceWorkerEvents()
    void this.registerServiceWorker()
  }

  /** Performs the bind install events operation. */
  private bindInstallEvents(): void {
    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault()
      this.deferredInstallPrompt = event as BeforeInstallPromptEvent
      const standalone =
        matchMedia('(display-mode: standalone)').matches ||
        (navigator as NavigatorWithStandalone).standalone === true
      if (this.installButton && !standalone) this.installButton.hidden = false
    })

    window.addEventListener('appinstalled', () => {
      this.deferredInstallPrompt = null
      if (this.installButton) this.installButton.hidden = true
      this.showStatus('APP INSTALLED · READY FOR OFFLINE PLAY')
    })

    this.installButton?.addEventListener('click', () => void this.promptInstall())
    this.updateButton?.addEventListener('click', () => this.activateUpdate())
  }

  /** Performs the bind connectivity events operation. */
  private bindConnectivityEvents(): void {
    window.addEventListener('offline', () => this.updateConnectivityUi())
    window.addEventListener('online', () => {
      this.updateConnectivityUi()
      this.showStatus('ONLINE · CHECKING FOR UPDATES')
      void this.checkForUpdates(true)
    })
  }

  /** Performs the bind service worker events operation. */
  private bindServiceWorkerEvents(): void {
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!this.hasController) {
        this.hasController = true
        this.showStatus(`OFFLINE READY · V${this.build.version}`)
        return
      }
      if (this.refreshing) return
      this.refreshing = true
      location.reload()
    })

    navigator.serviceWorker.addEventListener('message', (event: MessageEvent<WorkerMessage>) => {
      const data = event.data
      if (data.type === 'UPDATE_AVAILABLE') {
        this.showStatus(`V${data.version ?? '?'} FOUND · DOWNLOADING UPDATE`, true)
        void this.registration?.update()
      }
      if (data.type === 'SW_ACTIVATED' && data.version !== this.build.version) location.reload()
    })
  }

  /** Performs the register service worker operation. */
  private async registerServiceWorker(): Promise<void> {
    try {
      const registration = await navigator.serviceWorker.register('./sw.js', {
        scope: './',
        updateViaCache: 'none',
      })
      this.registration = registration
      this.watchRegistration(registration)
      registration.active?.postMessage({ type: 'CHECK_REMOTE_VERSION' })
      await this.checkForUpdates(true)
      window.setInterval(() => void this.checkForUpdates(true), this.build.updateIntervalMs)
    } catch (error: unknown) {
      this.showStatus('OFFLINE SETUP FAILED · ONLINE PLAY STILL WORKS', true)
      console.error('[PWA] Service worker registration failed:', error)
    }
  }

  /** Performs the watch registration operation. */
  private watchRegistration(registration: ServiceWorkerRegistration): void {
    if (registration.waiting) this.revealReadyUpdate(registration.waiting)
    if (registration.installing) this.watchInstallingWorker(registration.installing)
    registration.addEventListener('updatefound', () => {
      if (registration.installing) this.watchInstallingWorker(registration.installing)
    })
  }

  /** Performs the watch installing worker operation. */
  private watchInstallingWorker(worker: ServiceWorker): void {
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) {
        this.revealReadyUpdate(worker)
      }
    })
  }

  /** Performs the reveal ready update operation. */
  private revealReadyUpdate(worker: ServiceWorker): void {
    if (!this.updateButton) return
    this.updateButton.hidden = false
    this.updateButton.dataset.workerState = worker.state
    this.showStatus('UPDATE READY · TAP ↻ TO APPLY', true)
  }

  /** Performs the prompt install operation. */
  private async promptInstall(): Promise<void> {
    if (!this.deferredInstallPrompt) {
      this.showStatus('USE YOUR BROWSER MENU · INSTALL APP / ADD TO HOME SCREEN')
      return
    }
    await this.deferredInstallPrompt.prompt()
    await this.deferredInstallPrompt.userChoice
    this.deferredInstallPrompt = null
    if (this.installButton) this.installButton.hidden = true
  }

  /** Performs the activate update operation. */
  private activateUpdate(): void {
    const waiting = this.registration?.waiting
    if (!waiting) {
      void this.checkForUpdates(false)
      return
    }
    if (this.updateButton) this.updateButton.disabled = true
    this.showStatus('ACTIVATING UPDATE…', true)
    waiting.postMessage({ type: 'SKIP_WAITING' })
  }

  /** Performs the check for updates operation. */
  private async checkForUpdates(quiet: boolean): Promise<void> {
    if (!this.registration || !navigator.onLine) return
    try {
      const remote = await this.fetchRemoteVersion()
      if (!remote.version || remote.version === this.build.version) {
        if (!quiet) this.showStatus(`LATEST VERSION · V${this.build.version}`)
        return
      }
      this.showStatus(`V${remote.version} FOUND · DOWNLOADING UPDATE`, true)
      await this.registration.update()
      if (this.registration.waiting) this.revealReadyUpdate(this.registration.waiting)
    } catch (error: unknown) {
      if (!quiet) this.showStatus('UPDATE CHECK UNAVAILABLE · OFFLINE BUILD IS SAFE')
      console.info('[PWA] Update check skipped:', error)
    }
  }

  /** Performs the fetch remote version operation. */
  private async fetchRemoteVersion(): Promise<RemoteVersion> {
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 5000)
    try {
      const response = await fetch(this.getVersionEndpoint(), {
        cache: 'no-store',
        credentials: 'same-origin',
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      })
      if (!response.ok) throw new Error(`Version request returned ${response.status}`)
      return await PwaController.readRemoteVersion(response)
    } finally {
      window.clearTimeout(timeout)
    }
  }

  /** Performs the read remote version operation. */
  private static async readRemoteVersion(response: Response): Promise<RemoteVersion> {
    const value: unknown = await response.json()
    if (typeof value !== 'object' || value === null || !('version' in value)) return {}
    const version = Reflect.get(value, 'version')
    return typeof version === 'string' ? { version } : {}
  }

  /** Performs the get version endpoint operation. */
  private getVersionEndpoint(): string {
    const configured = this.build.remoteVersionUrl
    if (!configured) {
      return new URL(this.build.localVersionUrl || './version.json', location.href).href
    }
    return configured
  }

  /** Performs the update connectivity ui operation. */
  private updateConnectivityUi(): void {
    document.body.classList.toggle('is-offline', !navigator.onLine)
    if (!navigator.onLine) {
      this.showStatus(`OFFLINE MODE · V${this.build.version}`, true)
    } else if (this.status?.textContent?.startsWith('OFFLINE MODE')) {
      this.status.hidden = true
    }
  }

  /** Performs the show status operation. */
  private showStatus(message: string, sticky = false): void {
    if (!this.status) return
    window.clearTimeout(this.statusTimer)
    this.status.textContent = message
    this.status.hidden = false
    if (!sticky) {
      this.statusTimer = window.setTimeout(() => {
        if (this.status) this.status.hidden = true
      }, 3600)
    }
  }
}

/** Starts PWA support when version.js exposed valid build metadata. */
export function initializePwa(): void {
  const build = Reflect.get(globalThis, 'NTA_BUILD')
  if (!isAppBuild(build)) return
  new PwaController(build).initialize()
}

/** Returns whether an unknown global value contains valid application build metadata. */
function isAppBuild(value: unknown): value is AppBuild {
  if (typeof value !== 'object' || value === null) return false
  return (
    typeof Reflect.get(value, 'version') === 'string' &&
    typeof Reflect.get(value, 'remoteVersionUrl') === 'string' &&
    typeof Reflect.get(value, 'localVersionUrl') === 'string' &&
    typeof Reflect.get(value, 'updateIntervalMs') === 'number'
  )
}
