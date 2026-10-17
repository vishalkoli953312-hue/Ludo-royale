// Boot sequence: storage -> UI -> Three.js -> renderer -> effects -> controller.

import { createStorage, readJSON, writeJSON } from './storage.js';
import { Earnings } from './earnings.js';
import { AudioFX } from './audio.js';
import { FX2D } from './fx2d.js';
import { UI } from './ui.js';
import { GameController } from './game.js';
import { Renderer3D } from './renderer3d.js';

const SETTINGS_KEY = 'ludo-royale:settings:v1';
const THREE_SOURCES = ['vendor/three.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js'];

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.crossOrigin = 'anonymous';
    s.onload = resolve; s.onerror = () => { s.remove(); reject(new Error(`Failed to load ${src}`)); };
    document.head.appendChild(s);
  });
}
async function loadThree() {
  if (window.THREE) return;
  for (const src of THREE_SOURCES) {
    try { await loadScript(src); if (window.THREE) return; } catch { /* try the next source */ }
  }
  throw new Error('three-missing');
}

async function boot() {
  const storage = createStorage();
  const defaults = { sound: true, assist: true, view: 'tilt', tier: 'bronze', opponents: 1, skill: 'sharp', fps: false };
  const settings = { ...defaults, ...readJSON(storage, SETTINGS_KEY, {}) };
  const saveSettings = () => writeJSON(storage, SETTINGS_KEY, settings);

  const earnings = new Earnings(storage);
  const audio = new AudioFX(); audio.setMuted(!settings.sound);
  const ui = new UI({ earnings, settings, saveSettings, audio });
  ui.setLoading(0.04, 'Loading 3D engine');
  ui.el['fps'].hidden = !settings.fps;

  // First touch unlocks audio (iOS/Android autoplay policy).
  window.addEventListener('pointerdown', () => audio.unlock(), { once: true, capture: true });

  let renderer;
  try {
    // __LUDO_RENDERER__ is a test hook so the UI can be exercised without WebGL.
    if (window.__LUDO_RENDERER__) renderer = new window.__LUDO_RENDERER__(ui.el['gl']);
    else { await loadThree(); renderer = new Renderer3D(ui.el['gl']); }
    await renderer.init((p, label) => ui.setLoading(0.1 + p * 0.85, label));
  } catch (err) {
    console.error(err);
    const offline = err && err.message === 'three-missing';
    ui.showFatal(offline
      ? '<h2>3D engine not available</h2><p>The game needs to download its 3D engine once. Connect to the internet and try again. After that it works offline.</p>'
      : '<h2>3D graphics could not start</h2><p>This browser or device has WebGL turned off or unsupported. Try Chrome or Safari, and make sure hardware acceleration is on.</p>');
    return;
  }

  const fx = new FX2D(ui.el['fx']);
  fx.onShake = (dx, dy) => { ui.el['stage'].style.transform = dx || dy ? `translate(${dx.toFixed(1)}px,${dy.toFixed(1)}px)` : ''; };
  const controller = new GameController({ renderer, fx, audio, ui, earnings, settings, storage });
  renderer.onContextLost = () => ui.showFatal('<h2>Graphics paused</h2><p>The device reclaimed graphics memory. Your match is saved.</p>');

  // ---- sizing ------------------------------------------------------------------------
  const layout = () => {
    const w = innerWidth, h = innerHeight;
    renderer.resize(w, h); fx.resize(w, h, window.devicePixelRatio || 1);
    renderer.setInsets(ui.getInsets());
  };
  let layoutQueued = false;
  const queueLayout = () => { if (layoutQueued) return; layoutQueued = true; requestAnimationFrame(() => { layoutQueued = false; layout(); }); };
  ui.on('layout', queueLayout);
  addEventListener('resize', queueLayout);
  addEventListener('orientationchange', () => setTimeout(queueLayout, 250));
  if (window.visualViewport) visualViewport.addEventListener('resize', queueLayout);

  // ---- UI events ---------------------------------------------------------------------
  ui.on('play', (cfg) => {
    try { controller.newMatch(cfg); } catch (e) { ui.toast(e.message || 'Could not start the match'); ui.renderLobby(); }
  });
  ui.on('resume', () => { if (!controller.resume()) { ui.toast('That match is no longer available'); ui.renderLobby(controller.hasSession()); } });
  ui.on('again', () => { try { controller.newMatch({ tierId: settings.tier, opponents: settings.opponents, skill: settings.skill }); } catch { controller.toLobby(); } });
  ui.on('lobby', () => controller.toLobby());
  ui.on('quit', () => controller.quit());
  ui.on('roll', () => controller.requestRoll());
  ui.on('pause', (p) => controller.setPaused(p));
  ui.on('view', (v) => renderer.setView(v));
  ui.on('reset', () => { earnings.reset(); ui.refreshWallet(false); });
  ui.on('daily', () => {
    const n = earnings.claimDaily();
    if (n) { audio.unlock(); audio.coin(); ui.refreshWallet(true); ui.toast(`+${n} coins. Come back tomorrow for more.`); ui.renderLobby(); }
  });
  ui.el['gl'].addEventListener('pointerdown', (ev) => {
    const pick = renderer.pick(ev.clientX, ev.clientY);
    if (!pick) return;
    if (pick.type === 'dice') controller.requestRoll(); else controller.requestToken(pick);
  });

  // ---- frame loop: adaptive resolution + overlay effects -------------------------------
  let acc = 0, frames = 0, slow = 0, fast = 0, fpsLabel = 0;
  renderer.onFrame = (dt) => {
    fx.update(dt); fx.render();
    acc += dt; frames++;
    if (frames >= 45) {
      const avg = acc / frames; acc = 0; frames = 0;
      if (settings.fps && ++fpsLabel % 2 === 0) ui.el['fps'].textContent = `${Math.round(1 / avg)} fps  x${renderer.pr.toFixed(2)}`;
      if (avg > 0.021) { slow++; fast = 0; } else if (avg < 0.0145) { fast++; slow = 0; } else { slow = fast = 0; }
      if (slow >= 2 && renderer.pr > 1) { renderer.setPixelRatio(renderer.pr - 0.25); fx.setQuality(0.5); slow = 0; }
      else if (slow >= 2 && fx.cs < 14) { fx.setQuality(0); slow = 0; }
      else if (fast >= 6 && renderer.pr < renderer.q.maxPR) { renderer.setPixelRatio(renderer.pr + 0.25); fx.setQuality(1); fast = 0; }
    }
  };
  document.addEventListener('visibilitychange', () => { if (document.hidden) renderer.stop(); else renderer.start(); });

  // ---- go ------------------------------------------------------------------------------
  renderer.setMode('attract', { view: settings.view });
  ui.showLobby(controller.hasSession());
  layout();
  renderer.start();
  ui.hideLoading();
  if (window.__LUDO_TEST__) window.__ludo = { controller, fx, ui, earnings, renderer, settings };

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => { /* offline cache is optional */ }));
  }
}

boot();
