// Mega Mart PWA + push setup — include this on every page, after the
// Supabase client (window.supabaseClient) is created and currentUser is
// known. Call MegaMartPWA.init(supabaseClient, currentUser) once auth
// resolves.

const VAPID_PUBLIC_KEY = 'BFsMkZyVynjugn7a6J_A7MSMSl8wEqCtdTwvLhY2NMXL2V017DC5DcZYB0F8LPAMthi7kPZo4kGYSEkPQxBtL_Y';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

const MegaMartPWA = {
  deferredInstallPrompt: null,

  async registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return null;
    return navigator.serviceWorker.register('/service-worker.js');
  },

  // Wires up a custom "Install App" button (id="install_app_btn") if one
  // exists on the page. Chrome/Android fires beforeinstallprompt; iOS
  // Safari never does (it has no install prompt API), so we show manual
  // instructions there instead.
  setupInstallPrompt() {
    const btn = document.getElementById('install_app_btn');
    if (!btn) return;

    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;

    if (isStandalone) { btn.classList.add('hidden'); return; }

    if (isIos) {
      btn.classList.remove('hidden');
      btn.addEventListener('click', () => {
        alert('To install: tap the Share icon, then "Add to Home Screen".');
      });
      return;
    }

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredInstallPrompt = e;
      btn.classList.remove('hidden');
    });

    btn.addEventListener('click', async () => {
      if (!this.deferredInstallPrompt) return;
      this.deferredInstallPrompt.prompt();
      await this.deferredInstallPrompt.userChoice;
      this.deferredInstallPrompt = null;
      btn.classList.add('hidden');
    });

    window.addEventListener('appinstalled', () => btn.classList.add('hidden'));
  },

  // Asks for notification permission and stores the push subscription
  // against the current user, so the server knows where to send pushes.
  async subscribeToPush(supabaseClient, currentUser) {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    if (!currentUser) return;

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;

    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      });
    }

    const sub = subscription.toJSON();
    await supabaseClient.from('push_subscriptions').upsert({
      user_id: currentUser.id,
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth
    }, { onConflict: 'endpoint' });
  },

  async init(supabaseClient, currentUser) {
    await this.registerServiceWorker();
    this.setupInstallPrompt();
    // Don't force the permission prompt on page load — call
    // subscribeToPush() from a button tap (e.g. a "Turn on notifications"
    // toggle in settings) so it isn't an unexpected browser popup.
  }
};

window.MegaMartPWA = MegaMartPWA;
