import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { ASSETS } from './assets';
import CustomEmojiFace from './CustomEmojiFace';
import * as api from './api';

const clamp = (n, min = 0, max = 100) => Math.max(min, Math.min(max, n));

function isNaturallyDay(date = new Date()) {
  const h = date.getHours();
  return h >= 6 && h < 19;
}

function formatCooldown(sec) {
  if (sec <= 0) return '';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m > 0 ? `${m}м ${s}с` : `${s}с`;
}

function formatAge(createdAt, now) {
  if (!createdAt) return null;
  const ms = Math.max(0, now - new Date(createdAt).getTime());
  const minutes = Math.floor(ms / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);

  if (years >= 1) return `${years} ${plural(years, 'год', 'года', 'лет')}`;
  if (months >= 1) return `${months} ${plural(months, 'месяц', 'месяца', 'месяцев')}`;
  if (days >= 1) return `${days} ${plural(days, 'день', 'дня', 'дней')}`;
  if (hours >= 1) return `${hours} ${plural(hours, 'час', 'часа', 'часов')}`;
  if (minutes >= 1) return `${minutes} ${plural(minutes, 'минуту', 'минуты', 'минут')}`;
  return 'только что родился';
}

function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

const STAT_META = {
  happiness: { label: 'Happiness', color: '#ff5f87', emoji: '❤️' },
  hunger: { label: 'Hunger', color: '#f5a623', emoji: '🍔' },
  energy: { label: 'Energy', color: '#3ab0f0', emoji: '⚡' },
  cleanliness: { label: 'Clean', color: '#2fd6a7', emoji: '🛁' },
};

function StatBar({ statKey, value }) {
  const meta = STAT_META[statKey];
  return (
    <div className="stat-row">
      <span className="stat-emoji">{meta.emoji}</span>
      <div className="stat-track-wrap">
        <div className="stat-label-row">
          <span>{meta.label}</span>
          <span>{Math.round(value)}%</span>
        </div>
        <div className="stat-track">
          <div className="stat-fill" style={{ width: `${value}%`, background: meta.color }} />
        </div>
      </div>
    </div>
  );
}

function ActionButton({ icon, label, colorClass, onClick, disabled, cooldownLabel }) {
  return (
    <button className={`action-btn ${colorClass}`} onClick={onClick} disabled={disabled}>
      <span className="action-icon-wrap">
        <img src={icon} alt="" draggable={false} />
      </span>
      <span className="action-label">{cooldownLabel || label}</span>
    </button>
  );
}

function PillStat({ icon, value }) {
  return (
    <div className="pill">
      <span className="pill-icon">{icon}</span>
      <span className="pill-value">{value}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Auth gate: talks to /api/auth using Telegram initData              */
/* ------------------------------------------------------------------ */

function useAuth() {
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [player, setPlayer] = useState(null);
  const [pets, setPets] = useState([]);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    const data = await api.getPlayerState();
    setPlayer(data.player);
    setPets(data.pets || []);
    return data;
  }, []);

  useEffect(() => {
    (async () => {
      try {
        api.initTelegram();
        const data = await api.authenticate();
        setPlayer(data.player);
        setPets(data.pets || []);
        setStatus('ready');
      } catch (e) {
        setError(e.message || 'Auth failed');
        setStatus('error');
      }
    })();
  }, []);

  return { status, player, pets, setPets, error, refresh };
}

/* ------------------------------------------------------------------ */
/*  Create-pet screen (shown when the player has none)                 */
/* ------------------------------------------------------------------ */

function CreatePetScreen({ onCreated, onCancel }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function submit(e) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      // Face isn't picked here anymore — only name. Premium TG-emoji/GIF
      // face can be set afterwards from the Appearance modal.
      const { pet } = await api.createPet(name.trim(), null);
      onCreated(pet);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="create-pet-screen">
      <div className="create-pet-preview-wrap">
        <img src={ASSETS.basePet} className="create-pet-preview" alt="" draggable={false} />
      </div>
      <h1>Заведи питомца</h1>
      <p className="create-pet-sub">Дай ему имя.</p>
      <form onSubmit={submit} className="create-pet-form">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={32}
          placeholder="Имя питомца"
          autoFocus
        />
        <button type="submit" disabled={busy || !name.trim()}>
          {busy ? '...' : 'Завести'}
        </button>
        {onCancel && (
          <button type="button" className="create-pet-cancel" onClick={onCancel} disabled={busy}>
            Отмена
          </button>
        )}
      </form>
      {err && <p className="create-pet-error">{err}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Appearance modal: pick an emoji face, or send a GIF via the bot    */
/* ------------------------------------------------------------------ */

function AppearanceModal({ pet, botUsername, onClose, onUpdated }) {
  const [tab, setTab] = useState('tgemoji');
  const [saving, setSaving] = useState(false);

  function openBotForGif() {
    if (!botUsername) {
      alert('Укажите имя бота (botUsername) в App.jsx, чтобы включить загрузку GIF.');
      return;
    }
    api.openTelegramLink(api.getBotDeepLink(botUsername, pet.id));
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Внешность питомца</h2>
        <p className="appearance-hint">
          Имя и обычное эмодзи-лицо {pet.emoji ? <span>({pet.emoji}) </span> : ''}
          были выбраны при создании и больше не меняются. Но можно поставить
          настоящее Telegram-эмодзи или свою GIF поверх.
        </p>
        <div className="segmented">
          <button className={tab === 'tgemoji' ? 'seg-active' : ''} onClick={() => setTab('tgemoji')}>
            TG-эмодзи
          </button>
          <button className={tab === 'gif' ? 'seg-active' : ''} onClick={() => setTab('gif')}>
            GIF
          </button>
        </div>

        {tab === 'tgemoji' && (
          <div className="gif-tab">
            <p>
              Открой бота и пришли туда одно эмодзи из панели Telegram (обычной
              или Premium-анимированной) — оно станет лицом питомца.
            </p>
            <button className="modal-primary" onClick={openBotForGif} disabled={saving}>
              Отправить эмодзи боту
            </button>
            {pet.custom_emoji_url && <p className="gif-current-hint">Сейчас установлено Telegram-эмодзи.</p>}
          </div>
        )}

        {tab === 'gif' && (
          <div className="gif-tab">
            <p>
              Нажми кнопку ниже, откроется бот — пришли ему GIF (до 128 КБ), и он
              автоматически станет картинкой питомца.
            </p>
            <button className="modal-primary" onClick={openBotForGif} disabled={saving}>
              Отправить GIF боту
            </button>
            {pet.gif_url && <p className="gif-current-hint">Сейчас установлена своя GIF.</p>}
          </div>
        )}

        <button className="modal-close" onClick={onClose}>
          Закрыть
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main App                                                            */
/* ------------------------------------------------------------------ */

// Set this to your bot's @username (without the @) to enable the
// "send a GIF to the bot" appearance flow from api/telegram-webhook.js.
const BOT_USERNAME = 'Tamagrambot';

export default function App() {
  const { status, player, pets, setPets, error, refresh } = useAuth();
  const [activePetId, setActivePetId] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [toast, setToast] = useState(null);
  const [bubble, setBubble] = useState(null);
  const [petBounce, setPetBounce] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [cooldowns, setCooldowns] = useState({}); // action -> retryAt (ms)
  const [manualDayOverride, setManualDayOverride] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [addPetOpen, setAddPetOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const bubbleTimeoutRef = useRef(null);
  const toastTimeoutRef = useRef(null);
  const sceneRef = useRef(null);

  /* ---------------- pet position: drag-to-throw + autonomous walking ---------------- */
  // Rectangle (percent of the scene box) the pet is allowed to walk/be
  // dropped in — roughly the floor area in front of the bed.
  const ROOM_BOUNDS = { left: 12, right: 88, top: 58, bottom: 90 };
  const PET_WIDTH_PCT = 34; // approx rendered width of the pet sprite, for centering

  const [petPos, setPetPos] = useState({ x: 50, y: 78 });
  const [facing, setFacing] = useState(1); // 1 = facing right, -1 = facing left
  const [walking, setWalking] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [falling, setFalling] = useState(false);
  const petDragRef = useRef({ moved: false, lastX: 50 });
  const walkTimeoutRef = useRef(null);
  const wanderIntervalRef = useRef(null);

  /* ---------------- throw physics: gravity + wall bounce ---------------- */
  // After a drag-release ("throw"), the pet isn't just dropped where the
  // pointer let go — it keeps the pointer's last swipe velocity, gravity
  // pulls it down, and it bounces off the room's left/right/top/bottom
  // bounds (losing a bit of energy each bounce) until it settles, at
  // which point normal autonomous wandering resumes.
  const GRAVITY = 0.85; // % / frame^2
  const RESTITUTION = 0.52; // energy kept per bounce
  const FLOOR_FRICTION = 0.85; // horizontal speed kept on floor bounce
  const trailRef = useRef([]); // recent {x, y, t} samples, for throw velocity
  const physicsRef = useRef({ x: 50, y: 78, vx: 0, vy: 0 });
  const physicsRafRef = useRef(null);

  const stopPhysics = useCallback(() => {
    if (physicsRafRef.current) {
      cancelAnimationFrame(physicsRafRef.current);
      physicsRafRef.current = null;
    }
  }, []);

  const runPhysics = useCallback(() => {
    const p = physicsRef.current;
    p.vy += GRAVITY;
    p.x += p.vx;
    p.y += p.vy;

    let bounced = false;

    if (p.x <= ROOM_BOUNDS.left) {
      p.x = ROOM_BOUNDS.left;
      p.vx = Math.abs(p.vx) * RESTITUTION;
      setFacing(1);
      bounced = true;
    } else if (p.x >= ROOM_BOUNDS.right) {
      p.x = ROOM_BOUNDS.right;
      p.vx = -Math.abs(p.vx) * RESTITUTION;
      setFacing(-1);
      bounced = true;
    }

    if (p.y >= ROOM_BOUNDS.bottom) {
      p.y = ROOM_BOUNDS.bottom;
      p.vy = -Math.abs(p.vy) * RESTITUTION;
      p.vx *= FLOOR_FRICTION;
      bounced = true;
    } else if (p.y <= ROOM_BOUNDS.top) {
      p.y = ROOM_BOUNDS.top;
      p.vy = Math.abs(p.vy) * RESTITUTION;
      bounced = true;
    }

    if (bounced) {
      setPetBounce(true);
      setTimeout(() => setPetBounce(false), 380);
    }

    setPetPos({ x: p.x, y: p.y });

    const atRest =
      p.y >= ROOM_BOUNDS.bottom - 0.5 &&
      Math.abs(p.vx) < 0.15 &&
      Math.abs(p.vy) < 0.9;

    if (atRest) {
      setFalling(false);
      physicsRafRef.current = null;
      scheduleNextWander();
      return;
    }

    physicsRafRef.current = requestAnimationFrame(runPhysics);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startPhysics = useCallback((x, y, vx, vy) => {
    clearTimeout(wanderIntervalRef.current);
    clearTimeout(walkTimeoutRef.current);
    stopPhysics();
    physicsRef.current = { x, y, vx, vy };
    setFalling(true);
    setWalking(false);
    physicsRafRef.current = requestAnimationFrame(runPhysics);
  }, [runPhysics, stopPhysics]);

  const clampToBounds = useCallback((x, y) => ({
    x: clamp(x, ROOM_BOUNDS.left, ROOM_BOUNDS.right),
    y: clamp(y, ROOM_BOUNDS.top, ROOM_BOUNDS.bottom),
  }), []);

  const pointToPct = useCallback((clientX, clientY) => {
    const el = sceneRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * 100,
      y: ((clientY - rect.top) / rect.height) * 100,
    };
  }, []);

  const handlePetPointerDown = useCallback((e) => {
    e.preventDefault();
    stopPhysics();
    setFalling(false);
    petDragRef.current = { moved: false, lastX: petPos.x };
    trailRef.current = [{ x: petPos.x, y: petPos.y, t: performance.now() }];
    setDragging(true);
    clearTimeout(walkTimeoutRef.current);

    function onMove(ev) {
      const point = ev.touches ? ev.touches[0] : ev;
      const pct = pointToPct(point.clientX, point.clientY);
      if (!pct) return;
      const next = clampToBounds(pct.x, pct.y);
      if (Math.abs(next.x - petDragRef.current.lastX) > 0.5) {
        setFacing(next.x > petDragRef.current.lastX ? 1 : -1);
      }
      petDragRef.current = { moved: true, lastX: next.x };
      // keep a short trail of recent samples so release velocity reflects
      // the actual swipe, not just the last (possibly stationary) pixel
      trailRef.current.push({ x: next.x, y: next.y, t: performance.now() });
      if (trailRef.current.length > 6) trailRef.current.shift();
      setPetPos(next);
    }
    function onUp() {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
      setDragging(false);
      if (!petDragRef.current.moved) {
        // it was a tap, not a throw — open the appearance sheet
        setAppearanceOpen(true);
      } else {
        showBubble('💫');
        const trail = trailRef.current;
        const first = trail[0];
        const last = trail[trail.length - 1];
        const dt = Math.max(16, last.t - first.t);
        // scale pointer swipe speed (%/ms) into per-frame (~16.7ms) velocity
        const vx = clamp(((last.x - first.x) / dt) * 16.7, -6, 6);
        const vy = clamp(((last.y - first.y) / dt) * 16.7, -8, 8);
        startPhysics(last.x, last.y, vx, vy);
      }
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [petPos.x, petPos.y, pointToPct, clampToBounds, stopPhysics, startPhysics]);

  function walkTo(target) {
    setFacing(target.x >= petPos.x ? 1 : -1);
    setWalking(true);
    setPetPos(target);
    const distance = Math.hypot(target.x - petPos.x, target.y - petPos.y);
    const duration = Math.min(2600, Math.max(500, distance * 22));
    clearTimeout(walkTimeoutRef.current);
    walkTimeoutRef.current = setTimeout(() => setWalking(false), duration);
  }

  function scheduleNextWander() {
    clearTimeout(wanderIntervalRef.current);
    wanderIntervalRef.current = setTimeout(() => {
      const target = {
        x: ROOM_BOUNDS.left + Math.random() * (ROOM_BOUNDS.right - ROOM_BOUNDS.left),
        y: ROOM_BOUNDS.top + Math.random() * (ROOM_BOUNDS.bottom - ROOM_BOUNDS.top),
      };
      walkTo(target);
      scheduleNextWander();
    }, 4000 + Math.random() * 3000);
  }

  useEffect(() => {
    scheduleNextWander();
    return () => {
      clearTimeout(wanderIntervalRef.current);
      clearTimeout(walkTimeoutRef.current);
      stopPhysics();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------- parallax (sky/city drift behind the room) ---------------- */
  const [parallax, setParallax] = useState({ x: 0, y: 0 });
  const pointerTarget = useRef({ x: 0, y: 0 });
  const rafRef = useRef(null);
  const driftRef = useRef(0);

  useEffect(() => {
    const loop = () => {
      driftRef.current += 0.006;
      const driftX = Math.sin(driftRef.current) * 3;
      const driftY = Math.cos(driftRef.current * 0.8) * 1.5;
      setParallax((p) => {
        const targetX = pointerTarget.current.x + driftX;
        const targetY = pointerTarget.current.y + driftY;
        return {
          x: p.x + (targetX - p.x) * 0.08,
          y: p.y + (targetY - p.y) * 0.08,
        };
      });
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const handlePointerMove = useCallback((e) => {
    const el = sceneRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    pointerTarget.current = { x: clamp(x, -0.5, 0.5) * 2, y: clamp(y, -0.5, 0.5) * 2 };
  }, []);

  const handlePointerLeave = useCallback(() => {
    pointerTarget.current = { x: 0, y: 0 };
  }, []);

  // Also drive parallax from the device's gyroscope/orientation on mobile,
  // where there's no mouse to move — subtle tilt = subtle parallax.
  useEffect(() => {
    function onOrientation(e) {
      if (e.gamma == null || e.beta == null) return;
      const x = clamp(e.gamma / 30, -1, 1) * 2;
      const y = clamp((e.beta - 45) / 30, -1, 1) * 2;
      pointerTarget.current = { x, y };
    }
    window.addEventListener('deviceorientation', onOrientation);
    return () => window.removeEventListener('deviceorientation', onOrientation);
  }, []);

  useEffect(() => {
    if (pets.length && activePetId == null) setActivePetId(pets[0].id);
  }, [pets, activePetId]);

  const pet = useMemo(() => pets.find((p) => p.id === activePetId), [pets, activePetId]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Poll player-state periodically so a GIF uploaded via the bot (which
  // happens completely outside this app) shows up without a manual reload.
  useEffect(() => {
    if (status !== 'ready') return;
    const id = setInterval(() => {
      refresh().catch(() => {});
    }, 15000);
    return () => clearInterval(id);
  }, [status, refresh]);

  const isDay = manualDayOverride ?? isNaturallyDay(new Date(now));

  function showToast(msg) {
    setToast(msg);
    clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => setToast(null), 2400);
  }

  function showBubble(emoji) {
    setBubble({ emoji, id: Math.random() });
    clearTimeout(bubbleTimeoutRef.current);
    bubbleTimeoutRef.current = setTimeout(() => setBubble(null), 1600);
  }

  function bouncePet() {
    setPetBounce(true);
    setTimeout(() => setPetBounce(false), 380);
  }

  const ACTION_META = {
    feed: { icon: ASSETS.iconFeed, label: 'FEED', colorClass: 'btn-amber', bubble: '🍔' },
    wash: { icon: ASSETS.iconWash, label: 'WASH', colorClass: 'btn-blue', bubble: '✨' },
    play: { icon: ASSETS.iconPlay, label: 'PLAY', colorClass: 'btn-violet', bubble: '🎮' },
    sleep: { icon: ASSETS.iconSleep, label: 'SLEEP', colorClass: 'btn-indigo', bubble: '💤' },
  };

  async function runAction(action) {
    if (!pet) return;
    try {
      const { pet: updated } = await api.petAction(pet.id, action);
      setPets((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      showBubble(ACTION_META[action].bubble);
      bouncePet();
      setCooldowns((c) => ({ ...c, [action]: 0 }));
    } catch (e) {
      if (e.status === 429 && e.data?.retryAfterSec) {
        setCooldowns((c) => ({ ...c, [action]: Date.now() + e.data.retryAfterSec * 1000 }));
        showToast(`Подожди ещё ${formatCooldown(e.data.retryAfterSec)}`);
      } else {
        showToast(e.message || 'Ошибка');
      }
    }
  }

  async function deleteActivePet() {
    if (!pet || deleting) return;
    const sure = window.confirm(`Удалить питомца «${pet.name}» навсегда? Это нельзя отменить.`);
    if (!sure) return;
    setDeleting(true);
    try {
      await api.deletePet(pet.id);
      setPets((prev) => prev.filter((p) => p.id !== pet.id));
      setActivePetId(null); // next effect picks the first remaining pet, or none
      setSettingsOpen(false);
      showToast('Питомец удалён');
    } catch (e) {
      showToast(e.message || 'Не удалось удалить');
    } finally {
      setDeleting(false);
    }
  }

  if (status === 'loading') {
    return (
      <div className="app-root">
        <div className="loading-screen">Загрузка...</div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="app-root">
        <div className="loading-screen">
          Не удалось войти: {error}
          <br />
          Открой это приложение через Telegram.
        </div>
      </div>
    );
  }

  if (!pet) {
    return (
      <div className="app-root">
        <CreatePetScreen
          onCreated={(newPet) => {
            setPets((prev) => [...prev, newPet]);
            setActivePetId(newPet.id);
          }}
        />
      </div>
    );
  }

  return (
    <div className="app-root">
      <div className="app-frame">
        <div
          className="scene"
          ref={sceneRef}
          onPointerMove={handlePointerMove}
          onPointerLeave={handlePointerLeave}
        >
          <div className="scene-crop">
            <img
              src={isDay ? ASSETS.skyDay : ASSETS.skyNight}
              className="parallax-layer sky-layer"
              style={{ transform: `translate(-50%, -50%) translate(${parallax.x * 3}px, ${parallax.y * 2}px)` }}
              alt=""
              draggable={false}
            />
            <img
              src={isDay ? ASSETS.cityDay : ASSETS.cityNight}
              className="parallax-layer city-layer"
              style={{ transform: `translate(-50%, -50%) translate(${parallax.x * 8}px, ${parallax.y * 4}px)` }}
              alt=""
              draggable={false}
            />
            <iframe
              className="room-video-layer"
              src="https://www.youtube.com/embed/t0Q2otsqC4I?autoplay=1&mute=1&loop=1&playlist=t0Q2otsqC4I&controls=0&modestbranding=1&playsinline=1&rel=0"
              title="tv"
              frameBorder="0"
              allow="autoplay; encrypted-media"
              allowFullScreen={false}
              tabIndex={-1}
            />
            <img src={ASSETS.room} className="room-layer" alt="" draggable={false} />

            <img src={ASSETS.bed} className="bed-sprite" alt="" draggable={false} />

            <div
              className={`pet-zone ${dragging ? 'pet-zone-dragging' : ''} ${walking ? 'pet-zone-walking' : ''}`}
              style={{
                left: `${petPos.x}%`,
                top: `${petPos.y}%`,
                width: `${PET_WIDTH_PCT}%`,
                transition: dragging ? 'none' : 'left 0.05s linear, top 0.05s linear',
              }}
              onPointerDown={handlePetPointerDown}
              title="Перетащи питомца по комнате, тапни — сменить внешность"
            >
              <div className="pet-facing" style={{ transform: `scaleX(${facing})` }}>
                {pet.gif_url ? (
                  <img
                    src={pet.gif_url}
                    className={`pet-sprite ${petBounce ? 'pet-bounce' : falling ? 'pet-falling' : walking || dragging ? 'pet-walk' : 'pet-idle'}`}
                    alt={pet.name}
                    draggable={false}
                  />
                ) : pet.custom_emoji_url ? (
                  <CustomEmojiFace
                    url={pet.custom_emoji_url}
                    type={pet.custom_emoji_type}
                    className={`pet-sprite pet-custom-emoji ${petBounce ? 'pet-bounce' : falling ? 'pet-falling' : walking || dragging ? 'pet-walk' : 'pet-idle'}`}
                  />
                ) : (
                  <>
                    <img
                      src={ASSETS.basePet}
                      className={`pet-sprite ${petBounce ? 'pet-bounce' : falling ? 'pet-falling' : walking || dragging ? 'pet-walk' : 'pet-idle'}`}
                      alt={pet.name}
                      draggable={false}
                    />
                    {pet.emoji && <span className="pet-emoji-overlay">{pet.emoji}</span>}
                  </>
                )}
              </div>
              {bubble && (
                <div key={bubble.id} className="emote-bubble">
                  {bubble.emoji}
                </div>
              )}
            </div>

            <div className="top-bar">
              <PillStat icon="🪙" value={(player?.money ?? 0).toLocaleString('ru-RU')} />
              <PillStat icon="⭐" value={`Lvl ${pet.level ?? 0}`} />
              <button className="gear-btn" onClick={() => setSettingsOpen(true)} aria-label="settings">
                ⚙️
              </button>
            </div>

            {pets.length > 1 && (
              <div className="pet-switcher">
                {pets.map((p) => (
                  <button
                    key={p.id}
                    className={`pet-switcher-tab ${p.id === pet.id ? 'pet-switcher-tab-active' : ''}`}
                    onClick={() => setActivePetId(p.id)}
                    title={p.name}
                  >
                    {p.emoji || '🐾'}
                  </button>
                ))}
              </div>
            )}

            <div className="pet-card">
              <div className="pet-card-head">
                <div>
                  <h1 className="pet-name">{pet.name}</h1>
                  <span className="pet-age">{formatAge(pet.created_at, now)}</span>
                </div>
                <button className="edit-btn" onClick={() => setAppearanceOpen(true)} aria-label="appearance">
                  🖼️
                </button>
              </div>
              <div className="stat-list">
                <StatBar statKey="happiness" value={pet.happiness} />
                <StatBar statKey="hunger" value={pet.hunger} />
                <StatBar statKey="energy" value={pet.energy} />
                <StatBar statKey="cleanliness" value={pet.cleanliness} />
              </div>
            </div>
          </div>
        </div>

        <div className="actions-row">
          {Object.entries(ACTION_META).map(([action, meta]) => {
            const retryAt = cooldowns[action] || 0;
            const secLeft = Math.max(0, Math.ceil((retryAt - now) / 1000));
            return (
              <ActionButton
                key={action}
                icon={meta.icon}
                label={meta.label}
                colorClass={meta.colorClass}
                onClick={() => runAction(action)}
                disabled={secLeft > 0}
                cooldownLabel={secLeft > 0 ? formatCooldown(secLeft) : null}
              />
            );
          })}
        </div>

        {toast && <div className="toast">{toast}</div>}

        {appearanceOpen && (
          <AppearanceModal
            pet={pet}
            botUsername={BOT_USERNAME}
            onClose={() => setAppearanceOpen(false)}
            onUpdated={(updated) => setPets((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))}
          />
        )}

        {settingsOpen && (
          <div className="modal-backdrop" onClick={() => setSettingsOpen(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <h2>Settings</h2>
              <div className="modal-row">
                <span>Время суток</span>
                <div className="segmented">
                  <button className={manualDayOverride === null ? 'seg-active' : ''} onClick={() => setManualDayOverride(null)}>
                    Авто
                  </button>
                  <button className={manualDayOverride === true ? 'seg-active' : ''} onClick={() => setManualDayOverride(true)}>
                    День
                  </button>
                  <button className={manualDayOverride === false ? 'seg-active' : ''} onClick={() => setManualDayOverride(false)}>
                    Ночь
                  </button>
                </div>
              </div>

              <div className="modal-row">
                <span>Питомцы ({pets.length}/5)</span>
                <button
                  className="modal-primary modal-primary-compact"
                  disabled={pets.length >= 5}
                  onClick={() => {
                    setSettingsOpen(false);
                    setAddPetOpen(true);
                  }}
                >
                  + Новый питомец
                </button>
              </div>

              <div className="modal-row">
                <span>Удалить «{pet.name}»</span>
                <button className="modal-danger" onClick={deleteActivePet} disabled={deleting}>
                  {deleting ? '...' : '🗑 Удалить'}
                </button>
              </div>

              <button className="modal-close" onClick={() => setSettingsOpen(false)}>
                Закрыть
              </button>
            </div>
          </div>
        )}

        {addPetOpen && (
          <div className="modal-backdrop" onClick={() => setAddPetOpen(false)}>
            <div className="modal modal-create-pet" onClick={(e) => e.stopPropagation()}>
              <CreatePetScreen
                onCreated={(newPet) => {
                  setPets((prev) => [...prev, newPet]);
                  setActivePetId(newPet.id);
                  setAddPetOpen(false);
                }}
                onCancel={() => setAddPetOpen(false)}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
