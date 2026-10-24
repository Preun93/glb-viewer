/**
 * Startknopf für die AR-Session (Passthrough).
 *
 * Anders als three.js' ARButton wird kein "local-floor"-Raum angefordert:
 * Der löst auf der Quest die stationäre Begrenzung aus (Kreis am Boden,
 * außerhalb verschwindet der Inhalt). Stattdessen wird "unbounded" genutzt,
 * mit Rückfall auf "local". Die Bodenhöhe ermittelt dann `FloorEstimator`.
 */
export function createARButton(renderer, { optionalFeatures = [] } = {}) {
  const button = document.createElement('button');
  button.id = 'ar-button';
  button.disabled = true;

  if (!('xr' in navigator)) {
    button.textContent = window.isSecureContext ? 'WEBXR NICHT VERFÜGBAR' : 'WEBXR BRAUCHT HTTPS';
    return button;
  }

  let session = null;

  async function start() {
    const s = await navigator.xr.requestSession('immersive-ar', {
      optionalFeatures: ['unbounded', ...optionalFeatures],
    });

    let type = 'local';
    try {
      await s.requestReferenceSpace('unbounded');
      type = 'unbounded';
    } catch {
      console.warn('Raumtyp "unbounded" nicht verfügbar, nutze "local".');
    }

    renderer.xr.setReferenceSpaceType(type);
    await renderer.xr.setSession(s);
    session = s;
    button.textContent = 'AR BEENDEN';
    s.addEventListener('end', () => {
      session = null;
      button.textContent = 'START AR';
    });
  }

  button.addEventListener('click', () => {
    if (session) {
      session.end();
      return;
    }
    start().catch((err) => {
      console.error(err);
      button.textContent = 'AR-START FEHLGESCHLAGEN';
      setTimeout(() => (button.textContent = 'START AR'), 3000);
    });
  });

  navigator.xr
    .isSessionSupported('immersive-ar')
    .then((supported) => {
      button.disabled = !supported;
      button.textContent = supported ? 'START AR' : 'AR NICHT UNTERSTÜTZT';
    })
    .catch(() => (button.textContent = 'AR NICHT UNTERSTÜTZT'));

  return button;
}
