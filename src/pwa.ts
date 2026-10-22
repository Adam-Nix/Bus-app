import { registerSW } from 'virtual:pwa-register';

// Chrome, Edge and Samsung Internet fire this when the app can be installed.
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  // iPadOS reports itself as a Mac, so also check for touch support.
  return /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1);
}

export function initPwa(onInstallAvailable: () => void): void {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    onInstallAvailable();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    onInstallAvailable();
  });

  // New versions download in the background and are applied the next time
  // the app is hidden, so the page never reloads under someone reading it.
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      const apply = () => {
        if (document.visibilityState === 'hidden') void updateSW(true);
      };
      document.addEventListener('visibilitychange', apply);
    },
  });
}

export async function promptInstall(): Promise<void> {
  if (!deferredPrompt) return;
  const prompt = deferredPrompt;
  deferredPrompt = null;
  await prompt.prompt();
  await prompt.userChoice;
}

export function installSection(): string {
  if (isStandalone()) return '';
  if (deferredPrompt) {
    return `
      <h2>Install</h2>
      <p class="muted">Add Next Bus to your home screen so it opens like an app, even with no signal.</p>
      <button class="button primary" data-action="install">Install app</button>`;
  }
  if (isIos()) {
    return `
      <h2>Install</h2>
      <p class="muted">In Safari, tap the <strong>Share</strong> button, then <strong>Add to Home Screen</strong>.</p>`;
  }
  return '';
}
