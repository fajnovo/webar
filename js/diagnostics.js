// Diagnostický panel: skutočný stav AR, chyby enginu, dostupnosť hitTest, rozmery plátna.
// Text sa dá skopírovať a poslať vývojárovi.

export function createDiagnostics(outputs) {
  const state = new Map();
  const logs = [];
  const t0 = performance.now();
  let errorCount = 0;

  const stamp = () => ((performance.now() - t0) / 1000).toFixed(1).padStart(6, ' ') + ' s';
  const push = (msg) => {
    logs.push(`${stamp()}  ${msg}`);
    if (logs.length > 60) logs.shift();
  };

  const api = {
    set(key, value) { state.set(key, String(value)); },
    get(key) { return state.get(key); },
    log(msg) { push(msg); },
    error(msg) {
      errorCount += 1;
      state.set('počet chýb', String(errorCount));
      push('CHYBA: ' + msg);
    },
    text() {
      const lines = ['=== STAV ==='];
      for (const [k, v] of state) lines.push(`${k}: ${v}`);
      lines.push('', '=== UDALOSTI (posledných 60) ===', ...logs);
      return lines.join('\n');
    },
    render() {
      const t = api.text();
      for (const el of outputs) if (el) el.textContent = t;
    },
    async copy() {
      const t = api.text();
      try {
        await navigator.clipboard.writeText(t);
        return true;
      } catch (e) {
        const ta = document.createElement('textarea');
        ta.value = t;
        document.body.appendChild(ta);
        ta.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
        ta.remove();
        return ok;
      }
    },
  };

  window.addEventListener('error', (e) => {
    const file = (e.filename || '').split('/').pop();
    api.error(`JS: ${e.message} (${file}:${e.lineno})`);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    api.error('Promise: ' + (r && r.message ? r.message : r));
  });

  setInterval(api.render, 500);
  return api;
}

export function collectEnvironment(diag) {
  const update = () => {
    const vv = window.visualViewport;
    diag.set(
      'okno',
      `${window.innerWidth}×${window.innerHeight} css px, viewport ` +
        `${vv ? Math.round(vv.width) + '×' + Math.round(vv.height) : 'n/a'}, dpr ${window.devicePixelRatio}`
    );
    diag.set(
      'obrazovka',
      `${screen.width}×${screen.height}, orientácia ${(screen.orientation && screen.orientation.type) || 'n/a'}`
    );
  };
  update();
  window.addEventListener('resize', update);
  window.addEventListener('orientationchange', update);

  diag.set('verzia testu', '2');
  diag.set('HTTPS', window.isSecureContext ? 'áno' : 'NIE (kamera nemusí fungovať)');
  diag.set('prehliadač', navigator.userAgent);
  diag.set('senzory pohybu', 'DeviceMotionEvent' in window ? 'dostupné' : 'CHÝBAJÚ');
  diag.set('WebXR AR', 'zisťujem…');
  if (navigator.xr && navigator.xr.isSessionSupported) {
    navigator.xr.isSessionSupported('immersive-ar').then(
      (ok) => diag.set('WebXR AR', ok ? 'podporované' : 'nepodporované v tomto prehliadači'),
      (e) => diag.set('WebXR AR', 'chyba: ' + e.message)
    );
  } else {
    diag.set('WebXR AR', 'nedostupné (navigator.xr chýba)');
  }
}
