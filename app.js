/* ═══════════════════════════════════════════════════════════════════
   UNO ONLINE — app.js
   Juego multijugador en tiempo real con Firebase Realtime Database
   Tecnologías: HTML5 + CSS3 + JavaScript Vanilla + Firebase v9 compat

   SECCIONES:
    1.  Constantes y configuración del juego
    2.  Estado local
    3.  Inicialización de Firebase
    4.  Creación y unión a salas
    5.  Listener de Firebase en tiempo real
    6.  Inicio de partida y reparto de cartas
    7.  Validación de jugadas              ← app.js paso 5
    8.  Ejecución de jugadas               ← app.js paso 5
    9.  Efectos de cartas (handlers)       ← app.js paso 5
    10. Mecánica de robo y cadena          ← app.js paso 5
    11. Botón UNO y penalización           ← app.js paso 5
    12. Gestión de turnos                  ← app.js paso 6
    13. Timer y auto-jugada                ← app.js paso 6
    14. Eliminación y fin de partida       ← app.js paso 6
    15. Renderizado del juego              ← app.js paso 7
    16. Renderizado de manos y cartas      ← app.js paso 7
    17. Renderizado de otros jugadores     ← app.js paso 7
    18. UI de lobby y sala de espera       ← app.js paso 8
    19. Log de eventos                     ← app.js paso 8
    20. Funciones de utilidad              ← app.js paso 8
    21. Manejadores de eventos (clics)     ← app.js paso 8
    22. Reconexión                         ← app.js paso 8
    23. Inicialización (DOMContentLoaded)  ← app.js paso 8
═══════════════════════════════════════════════════════════════════ */


/* ═══════════════════════════════════════════════════════════════════
   SECCIÓN 1 — CONSTANTES Y CONFIGURACIÓN DEL JUEGO
   Modifica estos valores para ajustar las reglas sin buscar en el código.
═══════════════════════════════════════════════════════════════════ */

// ── Tiempo y jugabilidad ─────────────────────────────────────────
const TIMER_SECONDS     = 25;   // ← Segundos por turno (cambiar aquí)
const CARDS_PER_PLAYER  = 7;    // ← Cartas iniciales por jugador
const UNO_PENALTY       = 2;    // ← Cartas de penalización por no decir UNO
const MAX_PLAYERS       = 6;    // ← Máximo de jugadores por sala
const MIN_PLAYERS       = 2;    // ← Mínimo para iniciar la partida

// ── Fin de partida ───────────────────────────────────────────────
// Cuando quedan exactamente PLAYERS_FOR_AUTO_END jugadores,
// al terminar el penúltimo se muestran los resultados automáticamente.
const PLAYERS_FOR_AUTO_END = 2;

// ── Emojis de jugadores (se asignan en orden de unión) ───────────
const PLAYER_EMOJIS = ['🔴','🔵','🟢','🟡','🟣','🟠'];

// ── Colores de jugadores en la UI (mismo orden que PLAYER_EMOJIS) ─
const PLAYER_UI_COLORS = [
  '#e74c3c','#2980b9','#27ae60',
  '#f39c12','#8e44ad','#e67e22'
];

// ── Mensajes del sistema ─────────────────────────────────────────
const MSG_DURATION_MS   = 3000;  // Duración de mensajes temporales (ms)
const EVENT_LOG_MAX     = 25;    // Máximo de eventos en el log

// ── Identificadores de Firebase ──────────────────────────────────
const FB_ROOMS_PATH = 'rooms';   // Nodo raíz de las salas en Firebase


/* ═══════════════════════════════════════════════════════════════════
   SECCIÓN 2 — ESTADO LOCAL
   Solo vive en el cliente, nunca se sube a Firebase.
═══════════════════════════════════════════════════════════════════ */
const localState = {
  // Identidad del jugador local
  playerId:     null,    // UID de Firebase Auth anónimo
  roomCode:     null,    // Código de sala actual
  playerName:   null,    // Nombre del jugador
  playerEmoji:  null,    // Emoji asignado
  isHost:       false,   // ¿Es el creador de la sala?

  // Snapshot más reciente de la sala (desde Firebase listener)
  room:         null,

  // Carta seleccionada en la mano (para confirmar antes de jugar)
  selectedCardId: null,

  // Color elegido tras jugar +4 o cambio de color (antes de confirmar)
  pendingColor:   null,

  // ¿El jugador ya presionó UNO este turno?
  saidUno:        false,

  // ¿Ya robó su carta opcional este turno? (para mostrar btn Pasar)
  drewThisTurn:   false,

  // Control del timer local
  timerInterval:    null,
  timerValue:       TIMER_SECONDS,
  handlingTimeout:  false,   // true mientras se ejecuta auto-acción

  // Anti-duplicación de turnos
  lastTurnStartedAt: null,

  // Referencias de Firebase
  db:   null,
  auth: null,
};


/* ═══════════════════════════════════════════════════════════════════
   SECCIÓN 3 — INICIALIZACIÓN DE FIREBASE
═══════════════════════════════════════════════════════════════════ */

/**
 * Inicializa Firebase App, Auth anónimo y Database.
 * Si el auth falla, usa un ID de localStorage como fallback.
 */
async function initFirebase() {
  if (window.FIREBASE_CONFIG_MISSING || typeof FIREBASE_CONFIG === 'undefined') {
    document.getElementById('firebase-error').style.display = 'block';
    console.error('[Firebase] firebase-config.js no encontrado o mal configurado.');
    return;
  }

  try {
    if (!firebase.apps.length) {
      firebase.initializeApp(FIREBASE_CONFIG);
    }

    localState.auth = firebase.auth();
    localState.db   = firebase.database();

    await localState.auth.signInAnonymously();

    localState.auth.onAuthStateChanged((user) => {
      if (user) {
        const stored = localStorage.getItem('uno_playerId');
        if (!stored) {
          localState.playerId = user.uid;
          localStorage.setItem('uno_playerId', user.uid);
        } else {
          localState.playerId = stored;
        }
        console.log('[Firebase] Auth OK. PlayerId:', localState.playerId);
      }
    });

  } catch (err) {
    console.warn('[Firebase] Auth anónimo falló, usando fallback localStorage:', err.message);
    let fallbackId = localStorage.getItem('uno_playerId');
    if (!fallbackId) {
      fallbackId = 'p_' + Math.random().toString(36).substr(2, 12);
      localStorage.setItem('uno_playerId', fallbackId);
    }
    localState.playerId = fallbackId;

    if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
    localState.db = firebase.database();
  }
}

/**
 * Retorna referencia al nodo de la sala actual (o al código dado).
 * @param {string} [code]
 */
function roomRef(code) {
  return localState.db.ref(`${FB_ROOMS_PATH}/${code || localState.roomCode}`);
}


/* ═══════════════════════════════════════════════════════════════════
   SECCIÓN 4 — CREACIÓN Y UNIÓN A SALAS
═══════════════════════════════════════════════════════════════════ */

/**
 * Genera un código de sala de 6 caracteres.
 * Sin caracteres confusos (0, 1, O, I).
 */
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

/**
 * Crea una sala nueva. El creador recibe el emoji/color índice 0.
 * @param {string} playerName
 */
async function createRoom(playerName) {
  if (!localState.playerId) { showLobbyError('Error de conexión. Recarga la página.'); return; }

  playerName = playerName.trim();
  if (!playerName) { showLobbyError('Escribe tu nombre para crear una sala.'); return; }

  showLoadingModal('Creando sala...');

  // Generar código único
  let code = generateRoomCode();
  for (let i = 0; i < 5; i++) {
    const snap = await localState.db.ref(`${FB_ROOMS_PATH}/${code}`).once('value');
    if (!snap.exists()) break;
    code = generateRoomCode();
  }

  localState.roomCode   = code;
  localState.playerName = playerName;
  localState.isHost     = true;

  const now = firebase.database.ServerValue.TIMESTAMP;

  const roomData = {
    status:    'waiting',
    hostId:    localState.playerId,
    createdAt: now,
    direction: 1,          // 1 = horario, -1 = antihorario
    activeColor: null,
    results:   [],
    players: {
      [localState.playerId]: {
        name:       playerName,
        emojiIdx:   0,        // índice en PLAYER_EMOJIS
        connected:  true,
        joinedAt:   now,
        lastSeen:   now,
        eliminated: false,
        position:   null,
      }
    },
  };

  try {
    await localState.db.ref(`${FB_ROOMS_PATH}/${code}`).set(roomData);
    saveSession(code, playerName, localState.playerId, true);
    setupPresence(code, localState.playerId);
    hideLoadingModal();
    showWaitingRoom(code);
    subscribeToRoom(code);
  } catch (err) {
    hideLoadingModal();
    showLobbyError('Error al crear la sala: ' + err.message);
    console.error('[createRoom]', err);
  }
}

/**
 * Une al jugador a una sala existente.
 * @param {string} roomCode
 * @param {string} playerName
 */
async function joinRoom(roomCode, playerName) {
  if (!localState.playerId) { showLobbyError('Error de conexión. Recarga la página.'); return; }

  roomCode   = (roomCode || '').trim().toUpperCase();
  playerName = (playerName || '').trim();

  if (!roomCode)          { showLobbyError('Escribe el código de sala.'); return; }
  if (roomCode.length !== 6) { showLobbyError('El código debe tener 6 caracteres.'); return; }
  if (!playerName)        { showLobbyError('Escribe tu nombre para unirte.'); return; }

  showLoadingModal('Uniéndote a la sala...');

  try {
    const snap = await localState.db.ref(`${FB_ROOMS_PATH}/${roomCode}`).once('value');

    if (!snap.exists()) {
      hideLoadingModal();
      showLobbyError('Sala no encontrada. Verifica el código.');
      return;
    }

    const room = snap.val();

    // Reconexión: el jugador ya estaba en la sala
    if (room.players && room.players[localState.playerId]) {
      hideLoadingModal();
      await reconnectToRoom(roomCode, playerName, room);
      return;
    }

    // Validaciones para nuevo jugador
    if (room.status !== 'waiting') {
      hideLoadingModal();
      showLobbyError('La partida ya inició. No puedes unirte.');
      return;
    }

    const players    = room.players || {};
    const playerIds  = Object.keys(players);

    if (playerIds.length >= MAX_PLAYERS) {
      hideLoadingModal();
      showLobbyError(`La sala está llena (máximo ${MAX_PLAYERS} jugadores).`);
      return;
    }

    // Asignar el siguiente índice de emoji disponible
    const usedIdxs  = Object.values(players).map(p => p.emojiIdx);
    const emojiIdx  = [0,1,2,3,4,5].find(i => !usedIdxs.includes(i)) ?? playerIds.length;

    const now = firebase.database.ServerValue.TIMESTAMP;
    await localState.db.ref(`${FB_ROOMS_PATH}/${roomCode}/players/${localState.playerId}`).set({
      name:       playerName,
      emojiIdx:   emojiIdx,
      connected:  true,
      joinedAt:   now,
      lastSeen:   now,
      eliminated: false,
      position:   null,
    });

    localState.roomCode   = roomCode;
    localState.playerName = playerName;
    localState.isHost     = false;

    saveSession(roomCode, playerName, localState.playerId, false);
    setupPresence(roomCode, localState.playerId);
    hideLoadingModal();
    showWaitingRoom(roomCode);
    subscribeToRoom(roomCode);

  } catch (err) {
    hideLoadingModal();
    showLobbyError('Error al unirse: ' + err.message);
    console.error('[joinRoom]', err);
  }
}

/**
 * Reconecta a un jugador que ya estaba en la sala.
 * @param {string} roomCode
 * @param {string} playerName
 * @param {object} room
 */
async function reconnectToRoom(roomCode, playerName, room) {
  const player = room.players[localState.playerId];

  localState.roomCode   = roomCode;
  localState.playerName = player.name || playerName;
  localState.isHost     = (room.hostId === localState.playerId);

  await localState.db.ref(`${FB_ROOMS_PATH}/${roomCode}/players/${localState.playerId}`).update({
    connected: true,
    lastSeen:  firebase.database.ServerValue.TIMESTAMP,
  });

  saveSession(roomCode, localState.playerName, localState.playerId, localState.isHost);
  setupPresence(roomCode, localState.playerId);

  console.log('[reconnectToRoom] Reconectado a sala', roomCode);

  if (room.status === 'playing') {
    showScreen('screen-game');
    renderGame(room);
    startTurnLogic(room);
  } else if (room.status === 'waiting') {
    showWaitingRoom(roomCode);
  } else if (room.status === 'finished') {
    showScreen('screen-game');
    renderGame(room);
  }

  subscribeToRoom(roomCode);
}

/**
 * Configura presencia automática en Firebase.
 * Al desconectarse, marca el jugador como offline.
 */
function setupPresence(roomCode, playerId) {
  const connRef    = localState.db.ref(`${FB_ROOMS_PATH}/${roomCode}/players/${playerId}/connected`);
  const seenRef    = localState.db.ref(`${FB_ROOMS_PATH}/${roomCode}/players/${playerId}/lastSeen`);

  connRef.onDisconnect().set(false);
  seenRef.onDisconnect().set(firebase.database.ServerValue.TIMESTAMP);

  connRef.set(true);
  seenRef.set(firebase.database.ServerValue.TIMESTAMP);

  // Heartbeat cada 30 segundos
  setInterval(() => {
    if (localState.roomCode === roomCode) {
      seenRef.set(firebase.database.ServerValue.TIMESTAMP).catch(() => {});
    }
  }, 30000);
}

/** Guarda la sesión en localStorage para reconexión. */
function saveSession(roomCode, playerName, playerId, isHost) {
  localStorage.setItem('uno_roomCode',   roomCode);
  localStorage.setItem('uno_playerName', playerName);
  localStorage.setItem('uno_playerId',   playerId);
  localStorage.setItem('uno_isHost',     isHost ? 'true' : 'false');
}

/** Borra la sesión de localStorage. */
function clearSession() {
  localStorage.removeItem('uno_roomCode');
  localStorage.removeItem('uno_playerName');
}

/** Lee el código de sala del parámetro ?room= en la URL. */
function getUrlRoomCode() {
  return new URLSearchParams(window.location.search).get('room')?.toUpperCase() || null;
}

/** Genera la URL compartible de una sala. */
function getRoomUrl(code) {
  return `${window.location.origin}${window.location.pathname}?room=${code}`;
}


/* ═══════════════════════════════════════════════════════════════════
   SECCIÓN 5 — LISTENER DE FIREBASE EN TIEMPO REAL
═══════════════════════════════════════════════════════════════════ */

let activeRoomListener = null;

/**
 * Suscribe al snapshot de la sala en Firebase.
 * Cada cambio dispara onRoomUpdate().
 */
function subscribeToRoom(roomCode) {
  if (activeRoomListener) {
    localState.db.ref(`${FB_ROOMS_PATH}/${localState.roomCode || roomCode}`)
      .off('value', activeRoomListener);
  }

  activeRoomListener = localState.db.ref(`${FB_ROOMS_PATH}/${roomCode}`)
    .on('value', (snap) => {
      if (!snap.exists()) {
        showLobbyError('La sala fue eliminada.');
        showScreen('screen-lobby');
        clearSession();
        return;
      }
      const room = snap.val();
      localState.room = room;
      onRoomUpdate(room);
    }, (err) => {
      console.error('[Firebase listener]', err);
    });
}

/**
 * Despacha actualizaciones de Firebase a la pantalla correcta.
 * @param {object} room
 */
function onRoomUpdate(room) {
  // Actualizar log de eventos si hay
  if (room.events) updateEventLog(room.events);

  const screen = document.querySelector('.screen.active')?.id;

  // ── Sala de espera ─────────────────────────────────────────────
  if (screen === 'screen-waiting') {
    updateWaitingRoomUI(room);
    if (room.status === 'playing') {
      showScreen('screen-game');
      renderGame(room);
      startTurnLogic(room);
    }
    return;
  }

  // ── Pantalla de juego ──────────────────────────────────────────
  if (screen === 'screen-game') {
    if (room.status === 'finished') {
      clearTimer();
      showFinalResults(room);
      return;
    }

    renderGame(room);

    // Detectar cambio de turno para reiniciar timer
    if (room.turn) {
      const newStart = room.turn.startedAt;
      if (newStart && newStart !== localState.lastTurnStartedAt) {
        localState.lastTurnStartedAt = newStart;
        localState.handlingTimeout   = false;
        localState.selectedCardId    = null;
        localState.pendingColor      = null;
        localState.saidUno           = false;
        localState.drewThisTurn      = false;
        startLocalTimer(room);
      }
    }
    return;
  }

  // Reconexión desde lobby a partida ya en curso
  if (room.status === 'playing') {
    showScreen('screen-game');
    renderGame(room);
    startTurnLogic(room);
  }
}

/**
 * Evalúa el estado del turno y actualiza controles.
 * @param {object} room
 */
function startTurnLogic(room) {
  if (!room.turn) return;
  renderGame(room);
  if (isMyTurn(room)) {
    console.log('[Turno] Es MI turno.');
  }
}

/** Retorna true si es el turno del jugador local. */
function isMyTurn(room) {
  return room?.turn?.playerId === localState.playerId;
}


/* ═══════════════════════════════════════════════════════════════════
   SECCIÓN 6 — INICIO DE PARTIDA Y REPARTO DE CARTAS
═══════════════════════════════════════════════════════════════════ */

/**
 * El host inicia la partida.
 * - Baraja el mazo
 * - Reparte CARDS_PER_PLAYER cartas a cada jugador
 * - Voltea la primera carta del descarte (no puede ser acción)
 * - Determina el primer jugador al azar
 * - Escribe todo en Firebase → status: 'playing'
 */
async function startGame() {
  const room = localState.room;
  if (!room || room.hostId !== localState.playerId) return;

  const players   = room.players || {};
  const playerIds = Object.keys(players);

  if (playerIds.length < MIN_PLAYERS) {
    showLobbyError(`Necesitas al menos ${MIN_PLAYERS} jugadores para iniciar.`);
    return;
  }

  showLoadingModal('Iniciando partida...');

  try {
    // ── 1. Construir y barajar el mazo ────────────────────────
    const rawDeck      = buildDeck();
    let   shuffled     = shuffleDeck(rawDeck);

    // ── 2. Definir orden de jugadores (por joinedAt) ──────────
    const ordered = playerIds.sort((a, b) =>
      (players[a].joinedAt || 0) - (players[b].joinedAt || 0)
    );

    // ── 3. Repartir cartas ────────────────────────────────────
    let { hands, remainingDraw, firstDiscard } =
      dealInitialHands(shuffled, ordered, CARDS_PER_PLAYER);

    // ── 4. Garantizar que la carta inicial NO sea acción ──────
    // Si la primera carta del descarte es acción,
    // la devolvemos al fondo del mazo y sacamos la siguiente.
    const cardDefs = buildCardDefsMap(shuffled);
    let attempts   = 0;

    while (isActionCard(cardDefs[firstDiscard]) && attempts < 20) {
      // Devolver la carta de acción al fondo del mazo
      remainingDraw.push(firstDiscard);
      firstDiscard = remainingDraw.shift();
      attempts++;
    }

    // Si después de 20 intentos sigue siendo acción (caso extremísimo),
    // barajar el mazo de nuevo y repetir el proceso una vez más.
    if (isActionCard(cardDefs[firstDiscard])) {
      shuffled = shuffleDeck(rawDeck);
      const redeal = dealInitialHands(shuffled, ordered, CARDS_PER_PLAYER);
      hands         = redeal.hands;
      remainingDraw = redeal.remainingDraw;
      firstDiscard  = redeal.firstDiscard;
      const cardDefs2 = buildCardDefsMap(shuffled);
      // Un intento final
      if (isActionCard(cardDefs2[firstDiscard])) {
        remainingDraw.push(firstDiscard);
        firstDiscard = remainingDraw.shift();
      }
    }

    // ── 5. Elegir el primer jugador al azar ───────────────────
    const firstPlayerIdx = Math.floor(Math.random() * ordered.length);
    const firstPlayerId  = ordered[firstPlayerIdx];

    // ── 6. Determinar el color activo (color de la 1ra carta) ─
    const firstCardDef  = cardDefs[firstDiscard] ||
      buildCardDefsMap(buildDeck())[firstDiscard];
    const initialColor  = firstCardDef?.color || CARD_COLORS[0];

    const now = firebase.database.ServerValue.TIMESTAMP;

    // ── 7. Escribir todo en Firebase ──────────────────────────
    const updates = {
      'status':      'playing',
      'direction':   1,
      'activeColor': initialColor,
      'results':     [],
      'cardDefs':    buildCardDefsMap(shuffled),
      'deck/draw':   remainingDraw,
      'deck/discard': [firstDiscard],
      'turn': {
        playerId:        firstPlayerId,
        startedAt:       now,
        pendingDraw:     0,
        drawChainActive: false,
        saidUno:         false,
        drewCard:        false,
        skipped:         false,
      },
      'events': {
        [`${Date.now()}_start`]: {
          msg:  '🎴 ¡La partida ha comenzado!',
          type: 'system',
          ts:   now,
        },
        [`${Date.now()}_turn`]: {
          msg:  `▶️ Primer turno: ${players[firstPlayerId]?.name || 'Jugador'} (aleatorio)`,
          type: 'turn',
          ts:   now,
        },
      },
    };

    // Escribir las manos de cada jugador
    for (const pid of ordered) {
      updates[`hands/${pid}/cards`] = hands[pid];
    }

    await roomRef().update(updates);
    hideLoadingModal();
    console.log('[startGame] Partida iniciada. Primer turno:', firstPlayerId);

  } catch (err) {
    hideLoadingModal();
    showLobbyError('Error al iniciar la partida: ' + err.message);
    console.error('[startGame]', err);
  }
}

/**
 * Obtiene los jugadores ordenados por joinedAt.
 * Excluye los eliminados si se solicita.
 * @param {object} room
 * @param {boolean} [excludeEliminated=false]
 * @returns {string[]} array de playerIds
 */
function getPlayersOrdered(room, excludeEliminated = false) {
  if (!room.players) return [];
  return Object.keys(room.players)
    .filter(pid => !excludeEliminated || !room.players[pid].eliminated)
    .sort((a, b) =>
      (room.players[a].joinedAt || 0) - (room.players[b].joinedAt || 0)
    );
}

/**
 * Retorna la carta del tope del descarte como objeto completo.
 * @param {object} room
 * @returns {object|null}
 */
function getTopDiscard(room) {
  const discard = room.deck?.discard;
  if (!discard || discard.length === 0) return null;
  const topId = discard[discard.length - 1];
  return getCardFromDefs(topId, room.cardDefs);
}

/**
 * Retorna las cartas en la mano del jugador local como objetos completos.
 * @param {object} room
 * @returns {object[]}
 */
function getMyHand(room) {
  const cardIds = room.hands?.[localState.playerId]?.cards || [];
  return cardIds
    .map(id => getCardFromDefs(id, room.cardDefs))
    .filter(Boolean);
}


/* ═══════════════════════════════════════════════════════════════════
   SECCIÓN 7 — VALIDACIÓN DE JUGADAS
   Funciones puras que determinan si una carta puede jugarse.
═══════════════════════════════════════════════════════════════════ */

/**
 * Determina si una carta puede jugarse en el estado actual.
 * Reglas:
 * 1. Si hay cadena activa → solo se pueden jugar cartas acumulables
 * 2. Comodines sin color (+4, cambio) → siempre jugables (salvo cadena)
 * 3. Coincidencia de color con el color activo
 * 4. Coincidencia de tipo/valor con la carta del tope
 * @param {object} card   - carta a validar
 * @param {object} room   - snapshot actual
 * @returns {boolean}
 */
function isCardPlayable(card, room) {
  if (!card || !room.turn) return false;

  const topCard    = getTopDiscard(room);
  const chainActive = room.turn.drawChainActive || false;

  // ── Cadena activa: solo acumulables ──────────────────────────
  if (chainActive) {
    return isChainableCard(card);
  }

  // ── Comodín sin color (+4, cambio de color): siempre jugable ──
  // No tienen color propio, se juegan sobre cualquier carta.
  if (isColorlessCard(card)) return true;

  // ── Coincidencia de color activo ──────────────────────────────
  // Cubre: números, +2, bloqueo y reversa del mismo color.
  if (card.color && card.color === room.activeColor) return true;

  // ── Coincidencia de número (solo cartas numéricas) ────────────
  // Ejemplo: 7 azul sobre 7 rojo.
  if (
    card.type === CARD_TYPES.NUMBER &&
    topCard?.type === CARD_TYPES.NUMBER &&
    card.value === topCard.value
  ) return true;

  // NOTA: NO se permite mismo tipo entre colores distintos.
  // (Skip rojo NO va sobre Skip azul a menos que el color activo sea rojo)
  // Para habilitar esa regla, descomenta la siguiente línea:
  // if (topCard && card.type === topCard.type) return true;

  return false;
}

/**
 * Retorna todas las cartas jugables del jugador local.
 * @param {object} room
 * @returns {Set<string>} Set de cardIds jugables
 */
function getPlayableCardIds(room) {
  const playable = new Set();
  if (!isMyTurn(room)) return playable;
  if (room.turn?.skipped) return playable;

  const hand = getMyHand(room);
  for (const card of hand) {
    if (isCardPlayable(card, room)) playable.add(card.id);
  }
  return playable;
}

/**
 * Verifica si el jugador local tiene al menos una carta jugable.
 * @param {object} room
 * @returns {boolean}
 */
function hasAnyPlayableCard(room) {
  return getPlayableCardIds(room).size > 0;
}

/**
 * Verifica si necesita elegir color (tras jugar +4 o cambio de color).
 * @param {object} card
 * @returns {boolean}
 */
function cardNeedsColorChoice(card) {
  return card.type === CARD_TYPES.DRAW_FOUR ||
         card.type === CARD_TYPES.WILD_COLOR;
  // Agregar aquí futuros comodines que requieran elegir color
}


/* ═══════════════════════════════════════════════════════════════════
   SECCIÓN 8 — EJECUCIÓN DE JUGADAS
   Valida y aplica la carta seleccionada por el jugador.
═══════════════════════════════════════════════════════════════════ */

/**
 * El jugador confirma jugar una carta.
 * Flujo:
 * 1. Validar que es su turno y la carta es jugable
 * 2. Verificar penalización de UNO si aplica
 * 3. Si necesita color → abrir modal de color
 * 4. Si no → ejecutar directamente
 * @param {string} cardId
 */
async function playCard(cardId) {
  const room = localState.room;
  if (!room || !isMyTurn(room)) return;
  if (room.turn?.skipped) return;

  const card = getCardFromDefs(cardId, room.cardDefs);
  if (!card) return;

  if (!isCardPlayable(card, room)) {
    showGameMsg('❌ Esa carta no se puede jugar ahora.');
    return;
  }

  // ── Verificar penalización de UNO ────────────────────────────
  const myHand = getMyHand(room);
  if (myHand.length === 2 && !localState.saidUno) {
    // Jugando la penúltima carta sin haber presionado UNO → penalización
    await applyUnoPenalty();
    // Continúa: la carta se juega de todas formas (la penalización es extra)
  }

  // ── Necesita elegir color → mostrar modal ────────────────────
  if (cardNeedsColorChoice(card)) {
    localState.selectedCardId = cardId;
    showColorModal();
    return;
  }

  // ── Ejecutar directamente ─────────────────────────────────────
  await executePlayCard(cardId, null);
}

/**
 * Ejecuta la jugada tras confirmación (y tras elegir color si aplica).
 * Quita la carta de la mano, la pone en el descarte,
 * aplica el efecto y pasa el turno.
 * @param {string} cardId
 * @param {string|null} chosenColor - color elegido para +4 / cambio de color
 */
async function executePlayCard(cardId, chosenColor) {
  const room = localState.room;
  if (!room) return;

  const card       = getCardFromDefs(cardId, room.cardDefs);
  const myHand     = room.hands?.[localState.playerId]?.cards || [];
  const newHand    = myHand.filter(id => id !== cardId);
  const playerName = localState.playerName;

  // Color que queda activo: el elegido, o el propio de la carta
  const newActiveColor = chosenColor || card.color || room.activeColor;

  try {
    // ── 1. Actualizar mano y descarte ─────────────────────────
    const newDiscard = [...(room.deck?.discard || []), cardId];

    await roomRef().update({
      [`hands/${localState.playerId}/cards`]: newHand,
      'deck/discard':                         newDiscard,
      'activeColor':                          newActiveColor,
      'turn/saidUno':                         localState.saidUno,
    });

    // Log
    const cardName    = getCardDisplayName(card);
    const colorSuffix = chosenColor ? ` → ${COLOR_NAMES[chosenColor]}` : '';
    await addEvent(
      `🃏 ${playerName} jugó ${cardName}${colorSuffix}`,
      card.type === CARD_TYPES.NUMBER ? 'play' : 'special'
    );

    // ── 2. Verificar si ganó (sin cartas) ─────────────────────
    if (newHand.length === 0) {
      await handlePlayerFinished(localState.playerId);
      return;
    }

    // ── 3. Aplicar efecto de la carta ─────────────────────────
    const freshRoom = (await roomRef().once('value')).val();
    await applyCardEffect(card, freshRoom, chosenColor);

  } catch (err) {
    console.error('[executePlayCard]', err);
  }
}


/* ═══════════════════════════════════════════════════════════════════
   SECCIÓN 9 — EFECTOS DE CARTAS
   Un handler por tipo de carta. Para agregar un nuevo comodín:
   1. Crear la función handleXxx() aquí
   2. Agregar el case en applyCardEffect()
═══════════════════════════════════════════════════════════════════ */

/**
 * Despacha al handler correcto según el tipo de carta jugada.
 * @param {object} card
 * @param {object} room  - snapshot DESPUÉS de jugar la carta
 * @param {string|null} chosenColor
 */
async function applyCardEffect(card, room, chosenColor) {
  switch (card.type) {

    case CARD_TYPES.NUMBER:
      // Sin efecto especial → siguiente turno normal
      await nextTurn(localState.playerId);
      break;

    case CARD_TYPES.DRAW_TWO:
      await handleDrawTwo(room);
      break;

    case CARD_TYPES.DRAW_FOUR:
      await handleDrawFour(room, chosenColor);
      break;

    case CARD_TYPES.WILD_COLOR:
      await handleWildColor(room, chosenColor);
      break;

    case CARD_TYPES.SKIP:
      await handleSkip(room);
      break;

    case CARD_TYPES.REVERSE:
      await handleReverse(room);
      break;

    // ══════════════════════════════════════════════════════════
    // AGREGAR NUEVOS COMODINES AQUÍ:
    // ══════════════════════════════════════════════════════════
    // case CARD_TYPES.SWAP_HANDS:
    //   await handleSwapHands(room);
    //   break;
    // case CARD_TYPES.DRAW_SIX:
    //   await handleDrawSix(room);
    //   break;
    // case CARD_TYPES.DRAW_ONE_ALL:
    //   await handleDrawOneAll(room);
    //   break;

    default:
      console.warn('[applyCardEffect] Tipo desconocido:', card.type);
      await nextTurn(localState.playerId);
  }
}

/**
 * Handler +2: incrementa la cadena en 2.
 * El siguiente jugador deberá acumular o robar todo.
 */
async function handleDrawTwo(room) {
  const pending = (room.turn?.pendingDraw || 0) + 2;
  await roomRef().update({
    'turn/pendingDraw':     pending,
    'turn/drawChainActive': true,
  });
  await addEvent(`⚠️ Cadena activa: +${pending} cartas acumuladas.`, 'chain');
  await nextTurn(localState.playerId);
}

/**
 * Handler +4: incrementa la cadena en 4.
 * El color ya fue aplicado en executePlayCard.
 */
async function handleDrawFour(room, chosenColor) {
  const pending = (room.turn?.pendingDraw || 0) + 4;
  await roomRef().update({
    'turn/pendingDraw':     pending,
    'turn/drawChainActive': true,
  });
  const colorLabel = chosenColor ? COLOR_NAMES[chosenColor] : '';
  await addEvent(`⚠️ Cadena activa: +${pending} cartas. Color: ${colorLabel}`, 'chain');
  await nextTurn(localState.playerId);
}

/**
 * Handler Cambio de color: solo cambia el color activo.
 * El color ya fue aplicado en executePlayCard.
 */
async function handleWildColor(room, chosenColor) {
  const colorLabel = chosenColor ? COLOR_NAMES[chosenColor] : '';
  await addEvent(`🎨 Color cambiado a ${colorLabel}.`, 'special');
  await nextTurn(localState.playerId);
}

/**
 * Handler Bloqueo (Skip): el siguiente jugador pierde su turno.
 * Se implementa pasando el turno DOS veces:
 * primero al siguiente (que está bloqueado), luego al de después.
 */
async function handleSkip(room) {
  // Usar currentPlayerId explícito para evitar el bug de indexOf=-1
  const currentPlayerId = localState.playerId;

  // El siguiente (que será bloqueado)
  const nextId   = getNextPlayerId(room, currentPlayerId);
  const nextName = room.players[nextId]?.name || 'Jugador';
  await addEvent(`⊘ ${nextName} pierde su turno.`, 'skip');

  // El que juega después del bloqueado (2 pasos desde current)
  const afterId  = getNextPlayerId(room, nextId);
  const afterName = room.players[afterId]?.name || 'Jugador';

  const now = firebase.database.ServerValue.TIMESTAMP;
  await roomRef().update({
    'turn/playerId':        afterId,
    'turn/startedAt':       now,
    'turn/pendingDraw':     0,
    'turn/drawChainActive': false,
    'turn/saidUno':         false,
    'turn/drewCard':        false,
    'turn/skipped':         false,
  });
  await addEvent(`▶️ Turno de ${afterName}.`, 'turn');
  console.log('[handleSkip]', room.players[currentPlayerId]?.name, '→ skip', nextName, '→', afterName);
}

/**
 * Handler Reversa: invierte el sentido de juego.
 * Con 2 jugadores activos → actúa como bloqueo.
 */
async function handleReverse(room) {
  const activePlayers = getPlayersOrdered(room, true);

  if (activePlayers.length === 2) {
    // Con 2 jugadores: la reversa es un bloqueo
    await addEvent('↺ Reversa (2 jugadores = bloqueo).', 'reverse');
    await handleSkip(room);
    return;
  }

  // Invertir dirección
  const newDirection = room.direction === 1 ? -1 : 1;
  await roomRef().update({ 'direction': newDirection });
  await addEvent(`↺ Sentido invertido (${newDirection === 1 ? '→' : '←'}).`, 'reverse');
  await nextTurn(localState.playerId);
}

// ════════════════════════════════════════════════════════════
// PLANTILLAS PARA FUTUROS COMODINES:
// ════════════════════════════════════════════════════════════

// async function handleSwapHands(room) {
//   // Ejemplo: intercambiar mano con el siguiente jugador
//   const nextId   = getNextPlayerId(room);
//   const myCards  = room.hands?.[localState.playerId]?.cards || [];
//   const theirCards = room.hands?.[nextId]?.cards || [];
//   await roomRef().update({
//     [`hands/${localState.playerId}/cards`]: theirCards,
//     [`hands/${nextId}/cards`]:              myCards,
//   });
//   await addEvent(`⇄ ${localState.playerName} intercambió mano con ${room.players[nextId]?.name}.`, 'special');
//   await nextTurn(room);
// }

// async function handleDrawSix(room) {
//   const pending = (room.turn?.pendingDraw || 0) + 6;
//   await roomRef().update({
//     'turn/pendingDraw':     pending,
//     'turn/drawChainActive': true,
//   });
//   await addEvent(`⚠️ Cadena activa: +${pending} cartas acumuladas.`, 'chain');
//   await nextTurn(room);
// }


/* ═══════════════════════════════════════════════════════════════════
   SECCIÓN 10 — MECÁNICA DE ROBO Y CADENA
═══════════════════════════════════════════════════════════════════ */

/**
 * El jugador roba una carta del mazo voluntariamente
 * (cuando no tiene cartas jugables o decide no jugar).
 * Si la carta robada es jugable, puede jugarla inmediatamente.
 */
async function drawOneCard() {
  const room = localState.room;
  if (!room || !isMyTurn(room)) return;
  if (localState.drewThisTurn) return;  // Solo puede robar una vez por turno
  if (room.turn?.drawChainActive) return; // Si hay cadena, usar drawChainCards()

  const drawnCardId = await drawCardsFromDeck(localState.playerId, 1, room);
  if (!drawnCardId) return;

  localState.drewThisTurn = true;
  await roomRef().update({ 'turn/drewCard': true });

  const card = getCardFromDefs(drawnCardId[0], room.cardDefs);
  if (card) {
    await addEvent(`🃏 ${localState.playerName} robó una carta.`, 'draw');
  }

  // Verificar si la carta robada es jugable
  const freshRoom   = (await roomRef().once('value')).val();
  const newCard     = getCardFromDefs(drawnCardId[0], freshRoom.cardDefs);
  if (newCard && isCardPlayable(newCard, freshRoom)) {
    showGameMsg('Carta robada es jugable. Puedes jugarla o pasar.');
  }

  // Renderizar para mostrar el botón "Pasar turno"
  renderGame(freshRoom);
}

/**
 * El jugador pasa el turno después de haber robado.
 */
async function passTurn() {
  const room = localState.room;
  if (!room || !isMyTurn(room)) return;
  if (!localState.drewThisTurn) return;

  await addEvent(`⏭️ ${localState.playerName} pasó el turno.`, 'skip');
  await nextTurn(localState.playerId);
}

/**
 * El jugador no puede/quiere seguir la cadena activa.
 * Roba todas las cartas acumuladas y pierde el turno.
 */
async function drawChainCards() {
  const room = localState.room;
  if (!room || !isMyTurn(room)) return;
  if (!room.turn?.drawChainActive) return;

  const amount = room.turn.pendingDraw || 0;
  if (amount === 0) { await nextTurn(localState.playerId); return; }

  await drawCardsFromDeck(localState.playerId, amount, room);

  await roomRef().update({
    'turn/pendingDraw':     0,
    'turn/drawChainActive': false,
  });

  await addEvent(
    `💥 ${localState.playerName} no pudo seguir la cadena y robó ${amount} cartas.`,
    'chain'
  );

  await nextTurn(localState.playerId);
}

/**
 * Roba N cartas del mazo para un jugador.
 * Si el mazo se vacía, rebaraja el descarte automáticamente.
 * @param {string} playerId
 * @param {number} amount
 * @param {object} room
 * @returns {string[]} IDs de las cartas robadas
 */
async function drawCardsFromDeck(playerId, amount, room) {
  let drawPile   = [...(room.deck?.draw || [])];
  let discard    = [...(room.deck?.discard || [])];
  const hand     = [...(room.hands?.[playerId]?.cards || [])];
  const drawn    = [];

  for (let i = 0; i < amount; i++) {
    // Si el mazo está vacío → rebarajar el descarte
    if (drawPile.length === 0) {
      if (discard.length <= 1) {
        console.warn('[drawCardsFromDeck] Sin cartas disponibles.');
        break;
      }
      const topCard  = discard[discard.length - 1];
      const toShuffle = discard.slice(0, discard.length - 1);
      drawPile = shuffleDeck(toShuffle.map(id => ({ id }))).map(c => c.id);
      discard  = [topCard];
      await addEvent('🔀 Mazo vacío. Descarte rebarajado.', 'system');
    }

    const cardId = drawPile.shift();
    hand.push(cardId);
    drawn.push(cardId);
  }

  await roomRef().update({
    [`hands/${playerId}/cards`]: hand,
    'deck/draw':                 drawPile,
    'deck/discard':              discard,
  });

  return drawn;
}


/* ═══════════════════════════════════════════════════════════════════
   SECCIÓN 11 — BOTÓN UNO Y PENALIZACIÓN
═══════════════════════════════════════════════════════════════════ */

/**
 * El jugador presiona el botón UNO.
 * Marca saidUno = true en el estado local.
 * Solo tiene efecto relevante cuando le quedan 2 cartas.
 */
function pressSaidUno() {
  localState.saidUno = true;

  // Feedback visual
  const btn = document.getElementById('btn-uno');
  if (btn) {
    btn.classList.add('said');
    btn.textContent = '✓ UNO!';
  }

  // Log solo si tiene 2 cartas (para no spamear el log)
  const room = localState.room;
  if (room) {
    const myHand = getMyHand(room);
    if (myHand.length <= 2) {
      addEvent(`🗣️ ¡${localState.playerName} dijo UNO!`, 'uno').catch(() => {});
    }
  }
}

/**
 * Aplica la penalización de UNO: el jugador roba UNO_PENALTY cartas.
 * Se llama automáticamente al jugar la penúltima carta sin haber
 * presionado el botón UNO.
 */
async function applyUnoPenalty() {
  const room = localState.room;
  if (!room) return;

  await drawCardsFromDeck(localState.playerId, UNO_PENALTY, room);
  await addEvent(
    `⚠️ ${localState.playerName} olvidó decir UNO y robó ${UNO_PENALTY} cartas.`,
    'uno'
  );
  showGameMsg(`😬 ¡Olvidaste decir UNO! +${UNO_PENALTY} cartas.`);
}

/**
 * Resetea el estado del botón UNO al inicio de cada turno del jugador.
 */
function resetUnoButton() {
  // IMPORTANTE: NO resetear localState.saidUno aquí.
  // El reset de saidUno solo ocurre en onRoomUpdate cuando cambia el turno.
  // Si se resetea aquí, el estado se pierde en cada re-render de Firebase.
  const btn = document.getElementById('btn-uno');
  if (!btn) return;

  // Si ya lo presionó este turno → mantener el estado verde
  if (localState.saidUno) {
    btn.classList.add('said');
    btn.classList.remove('alert-pulse');
    btn.textContent = '✓ UNO!';
    return;
  }

  btn.classList.remove('said', 'alert-pulse');
  btn.textContent = 'UNO!';

  // Si el jugador tiene exactamente 2 cartas → poner alerta visual
  const room = localState.room;
  if (room && isMyTurn(room)) {
    const myHand = getMyHand(room);
    if (myHand.length === 2) {
      btn.classList.add('alert-pulse');
    }
  }
}

/**
 * Muestra el modal para elegir color (tras +4 o cambio de color).
 */
function showColorModal() {
  const modal = document.getElementById('modal-choose-color');
  if (modal) modal.style.display = 'flex';
}

/**
 * Oculta el modal de elección de color.
 */
function hideColorModal() {
  const modal = document.getElementById('modal-choose-color');
  if (modal) modal.style.display = 'none';
}

/**
 * El jugador elige un color en el modal.
 * @param {string} color - 'red'|'blue'|'green'|'yellow'
 */
async function onColorChosen(color) {
  hideColorModal();
  const cardId = localState.selectedCardId;
  localState.selectedCardId = null;
  localState.pendingColor   = null;

  if (!cardId) return;
  await executePlayCard(cardId, color);
}


/* ═══════════════════════════════════════════════════════════════════
   SECCIÓN 12 — GESTIÓN DE TURNOS
═══════════════════════════════════════════════════════════════════ */

/**
 * Pasa el turno al siguiente jugador activo (no eliminado, no desconectado).
 * Respeta la dirección actual (horario o antihorario).
 * Reinicia el estado del turno en Firebase.
 * @param {object} room - snapshot actual
 */
/**
 * Avanza el turno al siguiente jugador activo.
 *
 * DISEÑO CRÍTICO: Recibe explícitamente el ID del jugador ACTUAL para
 * evitar depender de room.turn.playerId que puede estar stale.
 * Esto soluciona el bug de 3+ jugadores donde indexOf() retornaba -1
 * haciendo que el juego siempre volviera al primer jugador (ordered[0]).
 *
 * @param {string} currentPlayerId - El jugador cuyo turno ACABA de terminar
 */
async function nextTurn(currentPlayerId) {
  // Leer estado fresco de Firebase
  let room;
  try {
    const snap = await roomRef().once('value');
    if (!snap.exists()) return;
    room = snap.val();
  } catch (err) {
    console.error('[nextTurn] Error al leer Firebase:', err.message);
    return;
  }

  if (!room?.players) return;

  const nextId   = getNextPlayerId(room, currentPlayerId);
  const nextName = room.players[nextId]?.name || 'Jugador';
  const now      = firebase.database.ServerValue.TIMESTAMP;

  console.log(`[nextTurn] ${currentPlayerId} → ${nextId} (${nextName}) | dir:${room.direction}`);

  try {
    await roomRef().update({
      'turn/playerId':        nextId,
      'turn/startedAt':       now,
      'turn/saidUno':         false,
      'turn/drewCard':        false,
      'turn/skipped':         false,
      // pendingDraw y drawChainActive se mantienen si hay cadena activa
    });
    await addEvent(`▶️ Turno de ${nextName}.`, 'turn');
  } catch (err) {
    console.error('[nextTurn] Error al actualizar Firebase:', err);
  }
}

/**
 * Calcula el ID del siguiente jugador dado el jugador ACTUAL explícito.
 *
 * CAMBIO CLAVE: Recibe currentPlayerId explícito en lugar de leer
 * room.turn.playerId, eliminando el bug donde indexOf() retornaba -1
 * cuando room.turn.playerId no estaba en la lista de activos.
 *
 * @param {object} room
 * @param {string} currentPlayerId - Jugador cuyo turno termina
 * @returns {string} playerId del siguiente jugador
 */
function getNextPlayerId(room, currentPlayerId) {
  // Solo jugadores activos (no eliminados)
  const ordered = getPlayersOrdered(room, true);

  console.log('[getNextPlayerId] ordered:', ordered.map(id => room.players[id]?.name));
  console.log('[getNextPlayerId] currentPlayerId:', currentPlayerId, '| name:', room.players[currentPlayerId]?.name);

  if (ordered.length === 0) {
    console.warn('[getNextPlayerId] No hay jugadores activos!');
    return currentPlayerId;
  }
  if (ordered.length === 1) return ordered[0];

  // Si currentPlayerId no está en la lista activa (eliminado o no encontrado),
  // buscar en la lista COMPLETA para calcular la posición relativa.
  let currentIdx = ordered.indexOf(currentPlayerId);

  if (currentIdx === -1) {
    // El jugador actual fue eliminado o no está en activos.
    // Buscar en la lista completa (incluyendo eliminados) para
    // calcular desde qué posición avanzar.
    const allOrdered = getPlayersOrdered(room, false);
    const allIdx     = allOrdered.indexOf(currentPlayerId);
    // Encontrar el siguiente activo desde esa posición
    const step = room.direction === 1 ? 1 : -1;
    const allLen = allOrdered.length;
    for (let i = 1; i <= allLen; i++) {
      const candidateIdx = ((allIdx + step * i) % allLen + allLen) % allLen;
      const candidateId  = allOrdered[candidateIdx];
      if (ordered.includes(candidateId)) {
        console.log('[getNextPlayerId] fallback desde eliminado → ', room.players[candidateId]?.name);
        return candidateId;
      }
    }
    // Último recurso
    return ordered[0];
  }

  const step = room.direction === 1 ? 1 : -1;
  const len  = ordered.length;

  // Avanzar al siguiente, saltando desconectados
  for (let i = 1; i <= len; i++) {
    const nextIdx     = ((currentIdx + step * i) % len + len) % len;
    const candidateId = ordered[nextIdx];
    if (room.players[candidateId]?.connected !== false) {
      console.log(`[getNextPlayerId] idx ${currentIdx} → ${nextIdx} = ${room.players[candidateId]?.name}`);
      return candidateId;
    }
  }

  // Si todos desconectados, retornar el siguiente de todas formas
  const fallbackIdx = ((currentIdx + step) % len + len) % len;
  return ordered[fallbackIdx];
}


/* ═══════════════════════════════════════════════════════════════════
   SECCIÓN 13 — TIMER Y AUTO-JUGADA
   El timer corre localmente en cada cliente.
   Solo el cliente del jugador activo ejecuta la auto-acción.
═══════════════════════════════════════════════════════════════════ */

/**
 * Inicia el countdown de TIMER_SECONDS segundos.
 * Calcula el tiempo restante basado en turn.startedAt
 * (funciona incluso tras reconexión a mitad de turno).
 * @param {object} room
 */
function startLocalTimer(room) {
  clearTimer();

  const startedAt = room.turn?.startedAt || Date.now();
  const elapsed   = Math.floor((Date.now() - startedAt) / 1000);
  let   remaining = Math.max(0, TIMER_SECONDS - elapsed);

  localState.timerValue = remaining;
  updateTimerUI(remaining);

  if (remaining === 0) {
    handleTimeout(room);
    return;
  }

  localState.timerInterval = setInterval(async () => {
    remaining--;
    localState.timerValue = remaining;
    updateTimerUI(remaining);

    if (remaining <= 0) {
      clearTimer();
      if (isMyTurn(localState.room) && !localState.handlingTimeout) {
        localState.handlingTimeout = true;
        await handleTimeout(localState.room);
      }
    }
  }, 1000);
}

/** Para y limpia el timer local. */
function clearTimer() {
  if (localState.timerInterval) {
    clearInterval(localState.timerInterval);
    localState.timerInterval = null;
  }
}

/**
 * Actualiza la barra visual y el número del timer.
 * @param {number} remaining
 */
function updateTimerUI(remaining) {
  const bar     = document.getElementById('game-timer-bar');
  const display = document.getElementById('game-timer-display');
  if (!bar || !display) return;

  const pct = (remaining / TIMER_SECONDS) * 100;
  bar.style.width = pct + '%';
  display.textContent = remaining;

  bar.classList.remove('warning', 'danger');
  display.classList.remove('warning', 'danger');

  if (remaining <= 5) {
    bar.classList.add('danger');
    display.classList.add('danger');
  } else if (remaining <= 10) {
    bar.classList.add('warning');
    display.classList.add('warning');
  }
}

/**
 * Se ejecuta cuando el timer llega a cero.
 * Decisión: el sistema actúa automáticamente de forma random.
 * - Si hay cadena activa → roba las cartas de la cadena
 * - Si tiene cartas jugables → juega una al azar
 * - Si no tiene jugables → roba 1 carta y pasa
 * @param {object} room
 */
async function handleTimeout(room) {
  if (!room?.turn) return;
  if (!isMyTurn(room)) return;

  await addEvent(`⏱️ Tiempo agotado. El sistema actúa por ${localState.playerName}.`, 'system');

  try {
    // ── Modal de color abierto → cerrar y elegir color random ──
    const colorModal = document.getElementById('modal-choose-color');
    if (colorModal?.style.display !== 'none') {
      hideColorModal();
      const randomColor = CARD_COLORS[Math.floor(Math.random() * CARD_COLORS.length)];
      await onColorChosen(randomColor);
      return;
    }

    const freshRoom = (await roomRef().once('value')).val();
    if (!freshRoom) return;

    // ── Cadena activa → robar todo ──────────────────────────────
    if (freshRoom.turn?.drawChainActive) {
      await drawChainCards();
      return;
    }

    // ── Tiene jugables → jugar una al azar ──────────────────────
    const playable = getPlayableCardIds(freshRoom);
    if (playable.size > 0) {
      const cardIds = Array.from(playable);
      const chosen  = cardIds[Math.floor(Math.random() * cardIds.length)];
      const card    = getCardFromDefs(chosen, freshRoom.cardDefs);

      // Si necesita color → elegir uno al azar
      if (cardNeedsColorChoice(card)) {
        const randomColor = CARD_COLORS[Math.floor(Math.random() * CARD_COLORS.length)];
        await executePlayCard(chosen, randomColor);
      } else {
        await executePlayCard(chosen, null);
      }
      return;
    }

    // ── Sin jugables → robar 1 y pasar ─────────────────────────
    await drawCardsFromDeck(localState.playerId, 1, freshRoom);
    await addEvent(`🃏 ${localState.playerName} robó (sin jugables, auto).`, 'draw');
    await nextTurn(localState.playerId);

  } catch (err) {
    console.error('[handleTimeout]', err);
    // Fallback: pasar el turno
    try {
      await nextTurn(localState.playerId);
    } catch (e) { console.error('[handleTimeout fallback]', e); }
  }
}


/* ═══════════════════════════════════════════════════════════════════
   SECCIÓN 14 — ELIMINACIÓN Y FIN DE PARTIDA
═══════════════════════════════════════════════════════════════════ */

/**
 * Un jugador se quedó sin cartas.
 * Calcula su posición, muestra el modal y espera la decisión del host.
 * @param {string} playerId
 */
async function handlePlayerFinished(playerId) {
  const room   = localState.room;
  if (!room) return;

  clearTimer();

  // Calcular la posición (cuántos ya terminaron antes + 1)
  const results      = room.results || [];
  const position     = results.length + 1;
  const playerName   = room.players[playerId]?.name || 'Jugador';
  const activeBefore = getPlayersOrdered(room, true).length;

  // Registrar en Firebase
  const now = firebase.database.ServerValue.TIMESTAMP;
  const newResults = [...results, { playerId, position, finishedAt: now }];

  await roomRef().update({
    [`players/${playerId}/eliminated`]: true,
    [`players/${playerId}/position`]:   position,
    'results':                          newResults,
  });

  await addEvent(`🏆 ¡${playerName} terminó en el lugar #${position}!`, 'win');

  // Obtener snapshot fresco
  const freshRoom = (await roomRef().once('value')).val();

  // Contar jugadores activos restantes
  const activeAfter = getPlayersOrdered(freshRoom, true).length;

  // ── Si quedan exactamente PLAYERS_FOR_AUTO_END - 1 jugadores
  // (ej: quedaban 2, terminó 1 → queda 1) → fin automático ──────
  if (activeAfter <= 1) {
    // El último jugador es el perdedor (último lugar)
    const loser = getPlayersOrdered(freshRoom, true)[0];
    if (loser) {
      const loserPos  = newResults.length + 1;
      const loserName = freshRoom.players[loser]?.name || 'Jugador';
      const finalResults = [...newResults, { playerId: loser, position: loserPos, finishedAt: now }];

      await roomRef().update({
        'status':                               'finished',
        [`players/${loser}/eliminated`]:        true,
        [`players/${loser}/position`]:          loserPos,
        'results':                              finalResults,
      });

      await addEvent(`🏁 ¡${loserName} quedó en último lugar!`, 'win');
      showFinalResults(freshRoom);
      return;
    }
  }

  // ── Todavía quedan jugadores → mostrar modal de decisión ──────
  showPlayerFinishedModal(playerId, position, playerName, freshRoom);
}

/**
 * Muestra el modal cuando un jugador termina sus cartas.
 * El host decide si continuar o finalizar.
 * @param {string} playerId
 * @param {number} position
 * @param {string} playerName
 * @param {object} room
 */
function showPlayerFinishedModal(playerId, position, playerName, room) {
  const modal    = document.getElementById('modal-player-finished');
  const titleEl  = document.getElementById('finished-title');
  const nameEl   = document.getElementById('finished-player-name');
  const posEl    = document.getElementById('finished-position');
  const hostAct  = document.getElementById('finished-host-actions');
  const waitMsg  = document.getElementById('finished-wait-msg');

  const medals   = ['🥇','🥈','🥉'];
  const medal    = medals[position - 1] || `#${position}`;

  if (titleEl) titleEl.textContent = '¡Sin cartas!';
  if (nameEl)  nameEl.textContent  = playerName;
  if (posEl)   posEl.textContent   = `${medal} Lugar ${position}`;

  const isHost = room.hostId === localState.playerId;
  if (hostAct) hostAct.style.display  = isHost ? 'block' : 'none';
  if (waitMsg) waitMsg.style.display  = isHost ? 'none'  : 'block';

  if (modal) modal.style.display = 'flex';
}

/**
 * El host decide continuar la partida.
 * Cierra el modal y pasa el turno al siguiente jugador activo.
 */
async function continueGame() {
  const modal = document.getElementById('modal-player-finished');
  if (modal) modal.style.display = 'none';

  const freshRoom = (await roomRef().once('value')).val();
  if (!freshRoom) return;

  // Pasar el turno al siguiente jugador activo
  // (el que terminó ya está marcado como eliminated)
  // Pasar el ID del jugador que terminó como "current" para calcular el siguiente
  const finishedPlayerId = freshRoom.turn?.playerId || '';
  const nextId = getNextPlayerId(freshRoom, finishedPlayerId);
  const now    = firebase.database.ServerValue.TIMESTAMP;

  await roomRef().update({
    'turn/playerId':        nextId,
    'turn/startedAt':       now,
    'turn/pendingDraw':     0,
    'turn/drawChainActive': false,
    'turn/saidUno':         false,
    'turn/drewCard':        false,
    'turn/skipped':         false,
  });

  await addEvent(`▶️ La partida continúa. Turno de ${freshRoom.players[nextId]?.name}.`, 'turn');
}

/**
 * El host decide finalizar la partida anticipadamente.
 * Los jugadores restantes quedan sin clasificar.
 */
async function endGameEarly() {
  const modal = document.getElementById('modal-player-finished');
  if (modal) modal.style.display = 'none';

  const freshRoom  = (await roomRef().once('value')).val();
  if (!freshRoom) return;

  // Asignar posiciones a los jugadores restantes (orden por cartas en mano)
  const remaining  = getPlayersOrdered(freshRoom, true);
  const results    = [...(freshRoom.results || [])];
  let   pos        = results.length + 1;
  const now        = firebase.database.ServerValue.TIMESTAMP;

  const updates    = { 'status': 'finished' };
  for (const pid of remaining) {
    updates[`players/${pid}/eliminated`] = true;
    updates[`players/${pid}/position`]   = pos;
    results.push({ playerId: pid, position: pos, finishedAt: now });
    pos++;
  }
  updates['results'] = results;

  await roomRef().update(updates);
  await addEvent('🏁 Partida finalizada por el anfitrión.', 'system');

  showFinalResults(freshRoom);
}

/**
 * Muestra el modal de resultados finales con la tabla de clasificación.
 * @param {object} room
 */
function showFinalResults(room) {
  clearTimer();

  const modal = document.getElementById('modal-final-results');
  const tbody = document.getElementById('results-body');
  if (!modal || !tbody) return;

  // Obtener resultados ordenados por posición
  const results = [...(room.results || [])].sort((a, b) => a.position - b.position);

  const medals = ['🥇', '🥈', '🥉'];

  tbody.innerHTML = results.map(r => {
    const player  = room.players?.[r.playerId];
    const name    = player?.name || 'Jugador';
    const medal   = medals[r.position - 1] || '';
    const posClass = r.position <= 3 ? `pos-${r.position}` : '';

    return `
      <tr>
        <td>
          <span class="result-position ${posClass}">
            ${medal} ${r.position}º
          </span>
        </td>
        <td>${escapeHtml(name)}</td>
      </tr>
    `;
  }).join('');

  modal.style.display = 'flex';
}


/* ═══════════════════════════════════════════════════════════════════
   SECCIÓN 15 — RENDERIZADO DEL JUEGO
   Orquesta todo el renderizado en cada update de Firebase.
═══════════════════════════════════════════════════════════════════ */

/**
 * Renderiza el estado completo del juego.
 * Se llama cada vez que Firebase envía un update.
 * @param {object} room
 */
function renderGame(room) {
  if (!room) return;
  renderTurnIndicator(room);
  renderDiscardPile(room);
  renderActiveColor(room);
  renderChainIndicator(room);
  renderOtherPlayers(room);
  renderHand(room);
  renderActionButtons(room);
  renderUnoButton(room);
  renderTimerZone(room);
}

/**
 * Actualiza el indicador de turno y dirección.
 * @param {object} room
 */
function renderTurnIndicator(room) {
  const el        = document.getElementById('turn-indicator');
  const dirEl     = document.getElementById('direction-indicator');
  const codeEl    = document.getElementById('game-room-code');

  if (codeEl) codeEl.textContent = localState.roomCode || '------';

  if (el && room.turn) {
    const currentPlayer = room.players?.[room.turn.playerId];
    const name          = currentPlayer?.name || 'Jugador';
    const isMe          = room.turn.playerId === localState.playerId;
    el.textContent      = isMe ? '🎴 Tu turno' : `Turno de: ${name}`;
    el.style.color      = isMe ? '#f39c12' : '';
  }

  if (dirEl) {
    dirEl.textContent = room.direction === 1 ? '↻' : '↺';
    dirEl.classList.toggle('reversed', room.direction === -1);
  }
}

/**
 * Renderiza la carta del tope del descarte.
 * @param {object} room
 */
function renderDiscardPile(room) {
  const pile = document.getElementById('discard-pile');
  if (!pile) return;

  const topCard = getTopDiscard(room);
  if (!topCard) {
    pile.className = 'card discard-pile card-back';
    pile.innerHTML = '<div class="card-inner"><span class="card-value-display">?</span></div>';
    return;
  }

  const colorClass = getCardCssClass(topCard);
  const label      = getCardLabel(topCard);
  pile.className   = `card discard-pile ${colorClass}`;
  pile.innerHTML   = `
    <span class="card-corner card-corner-tl">${label}</span>
    <div class="card-inner">
      <span class="card-value-display">${label}</span>
    </div>
    <span class="card-corner card-corner-br">${label}</span>
  `;
}

/**
 * Actualiza el punto de color activo.
 * @param {object} room
 */
function renderActiveColor(room) {
  const dot = document.getElementById('active-color-dot');
  if (!dot) return;
  dot.className = `active-color-dot ${room.activeColor || ''}`;
}

/**
 * Muestra u oculta el indicador de cadena activa.
 * @param {object} room
 */
function renderChainIndicator(room) {
  const el     = document.getElementById('chain-indicator');
  const amount = document.getElementById('chain-amount');
  if (!el) return;

  const chainActive = room.turn?.drawChainActive || false;
  const pending     = room.turn?.pendingDraw || 0;

  el.style.display = (chainActive && pending > 0) ? 'block' : 'none';
  if (amount) amount.textContent = `+${pending}`;
}

/**
 * Actualiza la zona del timer (solo visual, el countdown lo maneja startLocalTimer).
 * @param {object} room
 */
function renderTimerZone(room) {
  // El timer ya se gestiona con startLocalTimer()
  // Aquí solo reseteamos visualmente si cambia el turno
  if (!room.turn) return;
}


/* ═══════════════════════════════════════════════════════════════════
   SECCIÓN 16 — RENDERIZADO DE MANOS Y CARTAS
═══════════════════════════════════════════════════════════════════ */

/**
 * Renderiza la mano del jugador local.
 * Resalta jugables, atenúa no jugables, marca seleccionada.
 * @param {object} room
 */
function renderHand(room) {
  const container = document.getElementById('player-hand');
  const nameEl    = document.getElementById('hand-player-name');
  const countEl   = document.getElementById('hand-card-count');
  if (!container) return;

  const myHand     = getMyHand(room);
  const playableIds = isMyTurn(room) ? getPlayableCardIds(room) : new Set();
  const myName     = localState.playerName || 'Tu mano';

  if (nameEl)  nameEl.textContent  = myName;
  if (countEl) countEl.textContent = `${myHand.length} carta${myHand.length !== 1 ? 's' : ''}`;

  // Modo compacto si hay muchas cartas
  container.classList.toggle('compact', myHand.length > 8);

  container.innerHTML = '';

  myHand.forEach(card => {
    const cardEl   = buildCardElement(card);
    cardEl.classList.add('hand-card');

    const myTurn   = isMyTurn(room);
    const chainAct = room.turn?.drawChainActive || false;
    const skipped  = room.turn?.skipped || false;

    if (myTurn && !skipped && playableIds.has(card.id)) {
      cardEl.classList.add('playable');
      cardEl.addEventListener('click', () => onHandCardClick(card.id));
    } else {
      cardEl.classList.add('not-playable');
    }

    // Carta seleccionada
    if (card.id === localState.selectedCardId) {
      cardEl.classList.add('selected');
    }

    container.appendChild(cardEl);
  });

  // Resetear el botón UNO si es mi turno
  if (isMyTurn(room)) resetUnoButton();
}

/**
 * Construye el elemento HTML de una carta.
 * @param {object} card
 * @returns {HTMLElement}
 */
function buildCardElement(card) {
  const el         = document.createElement('div');
  const colorClass = getCardCssClass(card);
  const label      = getCardLabel(card);

  el.className     = `card ${colorClass}`;
  el.dataset.cardId = card.id;
  el.title         = getCardDisplayName(card);

  el.innerHTML = `
    <span class="card-corner card-corner-tl">${label}</span>
    <div class="card-inner">
      <span class="card-value-display">${label}</span>
    </div>
    <span class="card-corner card-corner-br">${label}</span>
  `;

  return el;
}

/**
 * Renderiza los botones de acción (Robar, Pasar, etc.).
 * @param {object} room
 */
function renderActionButtons(room) {
  const btnDraw = document.getElementById('btn-draw');
  const btnPass = document.getElementById('btn-pass');
  if (!btnDraw || !btnPass) return;

  const myTurn    = isMyTurn(room);
  const chainAct  = room.turn?.drawChainActive || false;
  const skipped   = room.turn?.skipped || false;
  const drewAlr   = localState.drewThisTurn;
  const hasPlay   = hasAnyPlayableCard(room);

  // Botón "Robar carta":
  // Visible si: es mi turno, no hay cadena, no robé, no estoy bloqueado
  const showDraw = myTurn && !chainAct && !skipped && !drewAlr;
  btnDraw.style.display = showDraw ? 'inline-flex' : 'none';

  // Si hay cadena activa y es mi turno → cambiar texto del botón
  // IMPORTANTE: NO asignar onclick aquí — ya hay un addEventListener permanente
  // en registerUIListeners que maneja ambos casos (drawChainCards / drawOneCard).
  // Asignar onclick además del addEventListener causaba doble llamada con 3+ jugadores.
  if (myTurn && chainAct && !skipped) {
    btnDraw.style.display = 'inline-flex';
    btnDraw.textContent   = `💥 Robar ${room.turn?.pendingDraw || 0} cartas`;
  } else if (showDraw) {
    btnDraw.textContent   = '🃏 Robar carta';
  }

  // Botón "Pasar turno":
  // Visible si ya robó su carta voluntaria y no jugó nada
  const showPass = myTurn && !chainAct && !skipped && drewAlr && !hasPlay;
  btnPass.style.display = showPass ? 'inline-flex' : 'none';
}

/**
 * Actualiza el estado visual del botón UNO.
 * @param {object} room
 */
function renderUnoButton(room) {
  const btn = document.getElementById('btn-uno');
  if (!btn) return;

  if (!isMyTurn(room)) {
    btn.style.opacity = '0.5';
    return;
  }

  btn.style.opacity = '1';

  // Ya lo presionó → verde
  if (localState.saidUno) {
    btn.classList.add('said');
    btn.classList.remove('alert-pulse');
    btn.textContent = '✓ UNO!';
    return;
  }

  // Tiene exactamente 2 cartas → pulsar alerta
  const myHand = getMyHand(room);
  if (myHand.length === 2) {
    btn.classList.add('alert-pulse');
    btn.classList.remove('said');
    btn.textContent = 'UNO!';
  } else {
    btn.classList.remove('alert-pulse', 'said');
    btn.textContent = 'UNO!';
  }
}


/* ═══════════════════════════════════════════════════════════════════
   SECCIÓN 17 — RENDERIZADO DE OTROS JUGADORES
   Muestra las cartas boca abajo de cada rival.
   El conteo solo aparece cuando tiene menos de 4 cartas.
═══════════════════════════════════════════════════════════════════ */

/**
 * Renderiza la zona de jugadores rivales (todos excepto el jugador local).
 * @param {object} room
 */
function renderOtherPlayers(room) {
  const zone = document.getElementById('rivals-zone');
  if (!zone || !room.players) return;

  // Todos los jugadores excepto el local, en orden de turno
  const ordered = getPlayersOrdered(room, false)
    .filter(pid => pid !== localState.playerId);

  zone.innerHTML = '';

  ordered.forEach(pid => {
    const player   = room.players[pid];
    if (!player) return;

    const cardCount = (room.hands?.[pid]?.cards || []).length;
    const isActive  = room.turn?.playerId === pid;
    const isElim    = player.eliminated || false;
    const isDisc    = player.connected === false;
    const saidUno   = room.turn?.saidUno && room.turn?.playerId === pid;
    const position  = player.position;

    const rivalEl  = document.createElement('div');
    rivalEl.className = 'rival-player';
    if (isActive) rivalEl.classList.add('is-active-turn');
    if (isElim)   rivalEl.classList.add('eliminated');

    // Badge de posición (si terminó)
    const posBadge = isElim && position
      ? `<span class="rival-position-badge">#${position}</span>`
      : '';

    // Badge de desconectado
    const discBadge = isDisc
      ? `<span class="rival-disconnected">⚫</span>`
      : '';

    // Badge de UNO dicho
    const unoBadge = saidUno && cardCount === 1
      ? `<span class="rival-uno-badge">UNO!</span>`
      : '';

    // Cartas boca abajo
    // Mostrar máximo 7 cartas visualmente para no desbordar
    const visibleCards = Math.min(cardCount, 7);
    let cardsHtml = '';
    for (let i = 0; i < visibleCards; i++) {
      cardsHtml += `<div class="rival-card-back"></div>`;
    }

    // Contador: solo si tiene MENOS de 4 cartas
    // (Regla del juego: no mostrar cantidad si tiene 4 o más)
    const countBadge = cardCount < 4 && cardCount > 0 && !isElim
      ? `<span class="rival-card-count">${cardCount}</span>`
      : '';

    rivalEl.innerHTML = `
      ${posBadge}
      <span class="rival-name" title="${escapeHtml(player.name)}">
        ${escapeHtml(player.name)}
      </span>
      ${unoBadge}
      <div class="rival-cards" style="position:relative;">
        ${cardsHtml}
        ${countBadge}
      </div>
      ${discBadge}
    `;

    zone.appendChild(rivalEl);
  });
}


/* ═══════════════════════════════════════════════════════════════════
   SECCIÓN 18 — UI DE LOBBY Y SALA DE ESPERA
═══════════════════════════════════════════════════════════════════ */

/**
 * Muestra una pantalla ocultando las demás.
 * @param {string} screenId
 */
function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(screenId);
  if (target) target.classList.add('active');
}

/**
 * Lleva al jugador a la sala de espera.
 * @param {string} roomCode
 */
function showWaitingRoom(roomCode) {
  showScreen('screen-waiting');
  const codeEl = document.getElementById('display-room-code');
  if (codeEl) codeEl.textContent = roomCode;
  const urlEl = document.getElementById('display-room-url');
  if (urlEl) urlEl.textContent = getRoomUrl(roomCode);
}

/**
 * Actualiza la sala de espera con los datos actuales de Firebase.
 * @param {object} room
 */
function updateWaitingRoomUI(room) {
  const players   = room.players || {};
  const playerIds = Object.keys(players);

  // Contador
  const countEl = document.getElementById('player-count');
  if (countEl) countEl.textContent = `${playerIds.length} / ${MAX_PLAYERS}`;

  // Lista de jugadores
  const list = document.getElementById('waiting-players');
  if (list) {
    list.innerHTML = '';
    const ordered = playerIds.sort(
      (a, b) => (players[a].joinedAt || 0) - (players[b].joinedAt || 0)
    );
    ordered.forEach((pid, idx) => {
      const p    = players[pid];
      const li   = document.createElement('li');
      li.className = 'waiting-player-item';
      const emoji  = PLAYER_EMOJIS[p.emojiIdx ?? idx] || '🎴';
      const isHost = pid === room.hostId;
      const isMe   = pid === localState.playerId;

      li.innerHTML = `
        <span class="player-num">${emoji}</span>
        <span class="player-name">${escapeHtml(p.name)}</span>
        ${isHost ? '<span class="host-badge">Anfitrión</span>' : ''}
        ${isMe   ? '<span class="you-badge">Tú</span>'         : ''}
      `;
      list.appendChild(li);
    });
  }

  // Botones de inicio
  const btnStart   = document.getElementById('btn-start');
  const startHint  = document.getElementById('start-hint');
  const waitingMsg = document.getElementById('waiting-for-host');
  const isHost     = room.hostId === localState.playerId;

  if (isHost) {
    if (btnStart)  { btnStart.style.display  = 'block'; btnStart.disabled = playerIds.length < MIN_PLAYERS; }
    if (startHint)  startHint.style.display  = playerIds.length < MIN_PLAYERS ? 'block' : 'none';
    if (waitingMsg) waitingMsg.style.display = 'none';
  } else {
    if (btnStart)   btnStart.style.display   = 'none';
    if (startHint)  startHint.style.display  = 'none';
    if (waitingMsg) waitingMsg.style.display = 'block';
  }
}

/** Muestra un error en el lobby (se oculta a los 4 segundos). */
function showLobbyError(msg) {
  const el = document.getElementById('lobby-error');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 4000);
}

/** Muestra un mensaje temporal en el juego (MSG_DURATION_MS ms). */
function showGameMsg(msg) {
  const el = document.getElementById('game-msg');
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(window._gameMsgTimeout);
  window._gameMsgTimeout = setTimeout(() => { el.style.display = 'none'; }, MSG_DURATION_MS);
}

/** Muestra el modal de carga con texto opcional. */
function showLoadingModal(text) {
  const modal  = document.getElementById('loading-modal');
  const textEl = document.getElementById('loading-modal-text');
  if (textEl && text) textEl.textContent = text;
  if (modal) modal.style.display = 'flex';
}

/** Oculta el modal de carga. */
function hideLoadingModal() {
  const modal = document.getElementById('loading-modal');
  if (modal) modal.style.display = 'none';
}


/* ═══════════════════════════════════════════════════════════════════
   SECCIÓN 19 — LOG DE EVENTOS
═══════════════════════════════════════════════════════════════════ */

/**
 * Escribe un evento en Firebase para que todos los clientes lo vean.
 * @param {string} msg
 * @param {string} [type]
 */
async function addEvent(msg, type) {
  if (!localState.roomCode || !localState.db) return;
  const key = `${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
  try {
    await localState.db
      .ref(`${FB_ROOMS_PATH}/${localState.roomCode}/events/${key}`)
      .set({ msg, type: type || 'play', ts: firebase.database.ServerValue.TIMESTAMP });
  } catch (err) {
    console.warn('[addEvent]', err.message);
  }
}

/**
 * Renderiza los últimos EVENT_LOG_MAX eventos en el panel lateral.
 * @param {object} events - objeto de Firebase { key: {msg, type, ts} }
 */
function updateEventLog(events) {
  const log = document.getElementById('game-event-log');
  if (!log) return;

  if (!events) {
    log.innerHTML = '<li class="event-item text-muted">Sin eventos aún...</li>';
    return;
  }

  const sorted = Object.values(events)
    .sort((a, b) => (b.ts || 0) - (a.ts || 0))
    .slice(0, EVENT_LOG_MAX);

  log.innerHTML = sorted.map(e => {
    const cls = e.type ? `event-${e.type}` : '';
    return `<li class="event-item ${cls}">${escapeHtml(String(e.msg || ''))}</li>`;
  }).join('');
}


/* ═══════════════════════════════════════════════════════════════════
   SECCIÓN 20 — FUNCIONES DE UTILIDAD
═══════════════════════════════════════════════════════════════════ */

/**
 * Escapa caracteres HTML para prevenir XSS.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Copia texto al portapapeles con feedback visual en el botón.
 * @param {string} text
 * @param {HTMLElement} [btn]
 */
async function copyToClipboard(text, btn) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback para navegadores sin clipboard API
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0;';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
  if (btn) {
    const orig = btn.textContent;
    btn.textContent = '✅';
    setTimeout(() => { btn.textContent = orig; }, 1500);
  }
}


/* ═══════════════════════════════════════════════════════════════════
   SECCIÓN 21 — MANEJADORES DE EVENTOS (CLICS DE UI)
═══════════════════════════════════════════════════════════════════ */

/**
 * El jugador hace clic en una carta de su mano.
 * Primera vez: selecciona. Segunda vez en la misma: confirma y juega.
 * @param {string} cardId
 */
function onHandCardClick(cardId) {
  const room = localState.room;
  if (!room || !isMyTurn(room)) return;
  if (room.turn?.skipped) return;

  // Verificar que la carta es jugable
  const playable = getPlayableCardIds(room);
  if (!playable.has(cardId)) return;

  if (localState.selectedCardId === cardId) {
    // Segunda vez: confirmar y jugar
    localState.selectedCardId = null;
    playCard(cardId);
  } else {
    // Primera vez: seleccionar y resaltar
    localState.selectedCardId = cardId;
    renderHand(room);
  }
}

/**
 * Registra todos los event listeners de la UI.
 * Se llama UNA sola vez en DOMContentLoaded.
 */
function registerUIListeners() {

  // ── Lobby ─────────────────────────────────────────────────────
  document.getElementById('btn-create')?.addEventListener('click', () => {
    createRoom(document.getElementById('create-name')?.value || '');
  });
  document.getElementById('create-name')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-create')?.click();
  });

  document.getElementById('btn-join')?.addEventListener('click', () => {
    joinRoom(
      document.getElementById('join-code')?.value || '',
      document.getElementById('join-name')?.value || ''
    );
  });
  document.getElementById('join-code')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-join')?.click();
  });
  document.getElementById('join-name')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-join')?.click();
  });

  // Pre-llenar código si viene en la URL
  const urlCode = getUrlRoomCode();
  if (urlCode) {
    const codeEl = document.getElementById('join-code');
    if (codeEl) codeEl.value = urlCode;
  }

  document.getElementById('btn-reconnect')?.addEventListener('click', attemptReconnect);
  document.getElementById('btn-clear-session')?.addEventListener('click', () => {
    clearSession();
    document.getElementById('reconnect-panel').style.display = 'none';
  });

  // ── Sala de espera ─────────────────────────────────────────────
  document.getElementById('btn-start')?.addEventListener('click', startGame);

  document.getElementById('btn-copy-code')?.addEventListener('click', e => {
    copyToClipboard(
      document.getElementById('display-room-code')?.textContent || '',
      e.currentTarget
    );
  });
  document.getElementById('btn-copy-url')?.addEventListener('click', e => {
    copyToClipboard(
      document.getElementById('display-room-url')?.textContent || '',
      e.currentTarget
    );
  });

  document.getElementById('btn-leave-waiting')?.addEventListener('click', () => {
    if (confirm('¿Seguro que quieres salir de la sala?')) {
      clearSession();
      if (activeRoomListener && localState.roomCode) {
        localState.db?.ref(`${FB_ROOMS_PATH}/${localState.roomCode}`)
          .off('value', activeRoomListener);
      }
      showScreen('screen-lobby');
    }
  });

  // ── Pantalla de juego ──────────────────────────────────────────

  // Botón UNO (siempre visible)
  document.getElementById('btn-uno')?.addEventListener('click', pressSaidUno);

  // Mazo (robar carta o robar cadena — el onclick se asigna en renderActionButtons)
  document.getElementById('draw-pile')?.addEventListener('click', () => {
    const room = localState.room;
    if (!room || !isMyTurn(room)) return;
    if (room.turn?.drawChainActive) {
      drawChainCards();
    } else if (!localState.drewThisTurn) {
      drawOneCard();
    }
  });

  // Botón robar carta
  document.getElementById('btn-draw')?.addEventListener('click', () => {
    const room = localState.room;
    if (!room || !isMyTurn(room)) return;
    if (room.turn?.drawChainActive) {
      drawChainCards();
    } else {
      drawOneCard();
    }
  });

  // Botón pasar turno
  document.getElementById('btn-pass')?.addEventListener('click', passTurn);

  // Toggle del log de eventos
  document.getElementById('btn-toggle-log')?.addEventListener('click', () => {
    const panel = document.getElementById('event-log-panel');
    const btn   = document.getElementById('btn-toggle-log');
    if (!panel) return;
    panel.classList.toggle('expanded');
    if (btn) btn.textContent = panel.classList.contains('expanded') ? '▲' : '▼';
  });

  // ── Modal elegir color ─────────────────────────────────────────
  document.querySelectorAll('.color-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const color = btn.dataset.color;
      if (color) onColorChosen(color);
    });
  });

  // ── Modal jugador terminó ──────────────────────────────────────
  document.getElementById('btn-continue-game')?.addEventListener('click', continueGame);
  document.getElementById('btn-end-game')?.addEventListener('click', endGameEarly);

  // ── Modal resultados finales ───────────────────────────────────
  document.getElementById('btn-new-game')?.addEventListener('click', () => {
    window.location.href = window.location.origin + window.location.pathname;
  });
}


/* ═══════════════════════════════════════════════════════════════════
   SECCIÓN 22 — RECONEXIÓN
═══════════════════════════════════════════════════════════════════ */

/**
 * Revisa si hay sesión guardada en localStorage.
 * Si la hay, muestra el panel de reconexión en el lobby.
 */
function checkStoredSession() {
  const code = localStorage.getItem('uno_roomCode');
  const name = localStorage.getItem('uno_playerName');
  if (!code || !name) return;

  const panel = document.getElementById('reconnect-panel');
  const info  = document.getElementById('reconnect-info');
  if (panel) panel.style.display = 'block';
  if (info)  info.textContent    = `Sala: ${code} · Nombre: ${name}`;
}

/**
 * Intenta reconectarse a la sala guardada en localStorage.
 */
async function attemptReconnect() {
  const code = localStorage.getItem('uno_roomCode');
  const name = localStorage.getItem('uno_playerName');

  if (!code || !name) { showLobbyError('No hay sesión guardada.'); return; }
  if (!localState.playerId) { showLobbyError('Esperando conexión con Firebase...'); return; }

  showLoadingModal('Reconectando...');
  try {
    const snap = await localState.db.ref(`${FB_ROOMS_PATH}/${code}`).once('value');
    if (!snap.exists()) {
      hideLoadingModal();
      showLobbyError('La sala ya no existe.');
      clearSession();
      document.getElementById('reconnect-panel').style.display = 'none';
      return;
    }
    hideLoadingModal();
    await reconnectToRoom(code, name, snap.val());
  } catch (err) {
    hideLoadingModal();
    showLobbyError('Error al reconectar: ' + err.message);
  }
}

/**
 * Si la URL tiene ?room=CODIGO, pre-llena el campo y
 * trata de reconectar automáticamente si hay sesión guardada.
 */
async function handleUrlRoom() {
  const urlCode = getUrlRoomCode();
  if (!urlCode) return;

  const codeEl = document.getElementById('join-code');
  if (codeEl) codeEl.value = urlCode;

  const storedCode = localStorage.getItem('uno_roomCode');
  const storedName = localStorage.getItem('uno_playerName');

  if (storedCode === urlCode && storedName && localState.playerId) {
    try {
      const snap = await localState.db.ref(`${FB_ROOMS_PATH}/${urlCode}`).once('value');
      if (snap.exists()) {
        const room = snap.val();
        if (room.players?.[localState.playerId]) {
          await reconnectToRoom(urlCode, storedName, room);
          return;
        }
      }
    } catch (err) {
      console.warn('[handleUrlRoom] Reconexión automática fallida:', err.message);
    }
  }
}


/* ═══════════════════════════════════════════════════════════════════
   SECCIÓN 23 — INICIALIZACIÓN (DOMContentLoaded)
   Punto de entrada de la aplicación.
═══════════════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', async () => {
  console.log('[UNO Online] Iniciando...');

  // 1. Registrar todos los listeners de UI
  registerUIListeners();

  // 2. Inicializar Firebase
  await initFirebase();

  // 3. Esperar a que Firebase Auth resuelva el UID
  await new Promise(resolve => {
    if (localState.playerId) {
      resolve();
    } else {
      const unsub = localState.auth?.onAuthStateChanged(() => {
        unsub?.();
        resolve();
      });
      // Timeout de seguridad: si tarda más de 3s, continuar
      setTimeout(resolve, 3000);
    }
  });

  // 4. Verificar sesión guardada → mostrar panel de reconexión
  checkStoredSession();

  // 5. Manejar ?room= en la URL
  await handleUrlRoom();

  console.log('[UNO Online] Listo. PlayerId:', localState.playerId);
});
