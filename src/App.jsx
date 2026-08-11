import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { ASSETS, EMOJI_CHOICES } from './assets';
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

function CreatePetScreen({ onCreated }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function submit(e) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const { pet } = await api.createPet(name.trim());
      onCreated(pet);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="create-pet-screen">
      <img src={ASSETS.basePet} className="create-pet-preview" alt="" draggable={false} />
      <h1>Заведи питомца</h1>
      <p className="create-pet-sub">Дай ему имя — остальное решит сервер.</p>
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
      </form>
      {err && <p className="create-pet-error">{err}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Appearance modal: pick an emoji face, or send a GIF via the bot    */
/* ------------------------------------------------------------------ */

function AppearanceModal({ pet, botUsername, onClose, onUpdated }) {
  const [tab, setTab] = useState('emoji');
  const [saving, setSaving] = useState(false);

  async function pickEmoji(emoji) {
    setSaving(true);
    try {
      const { pet: updated } = await api.setPetAppearance(pet.id, { emoji, clearGif: true });
      onUpdated(updated);
      onClose();
    } catch (e) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  }

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
        <div className="segmented">
          <button className={tab === 'emoji' ? 'seg-active' : ''} onClick={() => setTab('emoji')}>
            Эмодзи
          </button>
          <button className={tab === 'gif' ? 'seg-active' : ''} onClick={() => setTab('gif')}>
            GIF
          </button>
        </div>

        {tab === 'emoji' && (
          <div className="emoji-grid">
            {EMOJI_CHOICES.map((e) => (
              <button
                key={e}
                className={`emoji-choice ${pet.emoji === e ? 'emoji-choice-active' : ''}`}
                disabled={saving}
                onClick={() => pickEmoji(e)}
              >
                {e}
              </button>
            ))}
          </div>
        )}

        {tab === 'gif' && (
          <div className="gif-tab">
            <p>
              Нажми кнопку ниже, откроется бот — пришли ему GIF (до 128 КБ), и он
              автоматически станет картинкой питомца.
            </p>
            <button className="modal-primary" onClick={openBotForGif}>
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
const BOT_USERNAME = '';

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

  const bubbleTimeoutRef = useRef(null);
  const toastTimeoutRef = useRef(null);
  const sceneRef = useRef(null);

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
        <div className="scene" ref={sceneRef}>
          <div className="scene-crop">
            <img src={isDay ? ASSETS.skyDay : ASSETS.skyNight} className="parallax-layer sky-layer" alt="" draggable={false} />
            <img src={isDay ? ASSETS.cityDay : ASSETS.cityNight} className="parallax-layer city-layer" alt="" draggable={false} />
            <img src={ASSETS.room} className="room-layer" alt="" draggable={false} />

            <div className="pet-zone">
              <img src={ASSETS.bed} className="bed-sprite" alt="" draggable={false} />
              <button className="pet-sprite-btn" onClick={() => setAppearanceOpen(true)} title="Изменить внешность">
                {pet.gif_url ? (
                  <img src={pet.gif_url} className={`pet-sprite ${petBounce ? 'pet-bounce' : 'pet-idle'}`} alt={pet.name} draggable={false} />
                ) : (
                  <>
                    <img src={ASSETS.basePet} className={`pet-sprite ${petBounce ? 'pet-bounce' : 'pet-idle'}`} alt={pet.name} draggable={false} />
                    {pet.emoji && <span className="pet-emoji-overlay">{pet.emoji}</span>}
                  </>
                )}
              </button>
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

            <div className="pet-card">
              <div className="pet-card-head">
                <h1 className="pet-name">{pet.name}</h1>
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
              <button className="modal-close" onClick={() => setSettingsOpen(false)}>
                Закрыть
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
