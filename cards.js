/* ═══════════════════════════════════════════════════════════════════
   UNO ONLINE — cards.js
   Definición completa del mazo de UNO.

   ESTE ARCHIVO ES EL ÚNICO QUE NECESITAS MODIFICAR PARA:
   ✓ Agregar nuevos tipos de comodines
   ✓ Cambiar la cantidad de cartas de cada tipo
   ✓ Modificar etiquetas visuales
   ✓ Agregar nuevos colores

   Para agregar un nuevo comodín:
   1. Agregar la constante en CARD_TYPES (abajo)
   2. Agregar la cantidad en buildDeck()
   3. Agregar la etiqueta en CARD_LABELS
   4. Agregar el símbolo en CARD_SYMBOLS
   5. Agregar el handler en app.js → Sección 9
   6. Agregar el case en applyCardEffect() en app.js
═══════════════════════════════════════════════════════════════════ */


/* ─────────────────────────────────────────────────────────────
   TIPOS DE CARTA
   Agregar nuevos comodines aquí como nuevas constantes.
───────────────────────────────────────────────────────────── */
const CARD_TYPES = {
  // ── Carta normal (tiene color y número) ─────────────────────
  NUMBER:      'number',

  // ── Comodines con color (tienen color pero no número) ────────
  DRAW_TWO:    'draw_two',   // +2 cartas al siguiente jugador (acumulable)
  SKIP:        'skip',       // El siguiente jugador pierde su turno
  REVERSE:     'reverse',    // Invierte el sentido de juego

  // ── Comodines sin color (se juegan sobre cualquier carta) ────
  DRAW_FOUR:   'draw_four',  // +4 cartas al siguiente + elige color (acumulable)
  WILD_COLOR:  'wild_color', // Solo cambia el color activo

  // ════════════════════════════════════════════════════════════
  // ZONA DE EXPANSIÓN — Agrega nuevos comodines aquí:
  // ════════════════════════════════════════════════════════════
  // SWAP_HANDS:   'swap_hands',    // Intercambia mano con otro jugador
  // DRAW_SIX:     'draw_six',      // +6 cartas al siguiente (acumulable)
  // DRAW_ONE_ALL: 'draw_one_all',  // Todos los demás roban 1
  // SHUFFLE_HANDS:'shuffle_hands', // Baraja y redistribuye todas las manos
  // PEEK:         'peek',          // Ver las cartas de un rival
  // BLANK:        'blank',         // Carta en blanco para regla personalizada
};

/* ─────────────────────────────────────────────────────────────
   COLORES DEL JUEGO
   Agregar nuevos colores aquí si se desea expandir.
───────────────────────────────────────────────────────────── */
const CARD_COLORS = ['red', 'blue', 'green', 'yellow'];

/* ─────────────────────────────────────────────────────────────
   ETIQUETAS VISUALES DE CADA TIPO
   Lo que se muestra en el centro de la carta.
───────────────────────────────────────────────────────────── */
const CARD_LABELS = {
  [CARD_TYPES.NUMBER]:     null,       // Se usa el número directamente
  [CARD_TYPES.DRAW_TWO]:   '+2',
  [CARD_TYPES.SKIP]:       '⊘',
  [CARD_TYPES.REVERSE]:    '↺',
  [CARD_TYPES.DRAW_FOUR]:  '+4',
  [CARD_TYPES.WILD_COLOR]: '★',

  // Etiquetas de comodines futuros:
  // [CARD_TYPES.SWAP_HANDS]:    '⇄',
  // [CARD_TYPES.DRAW_SIX]:      '+6',
  // [CARD_TYPES.DRAW_ONE_ALL]:  '+1↔',
  // [CARD_TYPES.SHUFFLE_HANDS]: '🔀',
  // [CARD_TYPES.PEEK]:          '👁',
};

/* ─────────────────────────────────────────────────────────────
   NOMBRES LEGIBLES DE CADA TIPO
   Para el log de eventos y mensajes de la UI.
───────────────────────────────────────────────────────────── */
const CARD_TYPE_NAMES = {
  [CARD_TYPES.NUMBER]:     'carta',
  [CARD_TYPES.DRAW_TWO]:   '+2',
  [CARD_TYPES.SKIP]:       'Bloqueo',
  [CARD_TYPES.REVERSE]:    'Reversa',
  [CARD_TYPES.DRAW_FOUR]:  '+4',
  [CARD_TYPES.WILD_COLOR]: 'Cambio de color',

  // [CARD_TYPES.SWAP_HANDS]:    'Intercambio de mano',
  // [CARD_TYPES.DRAW_SIX]:      '+6',
  // [CARD_TYPES.DRAW_ONE_ALL]:  '+1 a todos',
};

/* ─────────────────────────────────────────────────────────────
   NOMBRES LEGIBLES DE COLORES
───────────────────────────────────────────────────────────── */
const COLOR_NAMES = {
  red:    'Rojo',
  blue:   'Azul',
  green:  'Verde',
  yellow: 'Amarillo',
};

/* ─────────────────────────────────────────────────────────────
   HEXADECIMALES DE COLORES (para la UI)
───────────────────────────────────────────────────────────── */
const COLOR_HEX = {
  red:    '#e74c3c',
  blue:   '#2980b9',
  green:  '#27ae60',
  yellow: '#f39c12',
};

/* ─────────────────────────────────────────────────────────────
   CARTAS QUE SON "SIN COLOR" (comodines puros)
   Estas cartas no tienen color propio y siempre son jugables
   (salvo que haya cadena activa).
───────────────────────────────────────────────────────────── */
const COLORLESS_TYPES = new Set([
  CARD_TYPES.DRAW_FOUR,
  CARD_TYPES.WILD_COLOR,
  // Agregar aquí tipos futuros que no tengan color:
  // CARD_TYPES.SHUFFLE_HANDS,
]);

/* ─────────────────────────────────────────────────────────────
   CARTAS QUE SON ACUMULABLES EN CADENA
   El siguiente jugador puede responder con cualquiera de estas.
───────────────────────────────────────────────────────────── */
const CHAINABLE_TYPES = new Set([
  CARD_TYPES.DRAW_TWO,
  CARD_TYPES.DRAW_FOUR,
  // Agregar aquí futuros comodines acumulables:
  // CARD_TYPES.DRAW_SIX,
]);

/* ─────────────────────────────────────────────────────────────
   CANTIDAD DE CARTAS EN EL MAZO
   Modificar aquí para ajustar la composición del mazo.
───────────────────────────────────────────────────────────── */
const DECK_QUANTITIES = {
  zero_per_color:      1,   // Cuántos 0 hay por color
  number_per_color:    2,   // Cuántos de cada 1-9 hay por color
  draw_two_per_color:  2,   // Cuántos +2 hay por color
  skip_per_color:      2,   // Cuántos bloqueos hay por color
  reverse_per_color:   2,   // Cuántas reversas hay por color
  draw_four_total:     4,   // Total de +4 en el mazo (sin color)
  wild_color_total:    4,   // Total de cambios de color (sin color)
  // Agregar aquí cantidades de nuevos comodines:
  // swap_hands_total: 2,
  // draw_six_total:   2,
};


/* ─────────────────────────────────────────────────────────────
   buildDeck()
   Genera el mazo completo de 108 cartas y lo retorna como array.
   Cada carta es un objeto: { id, type, color, value }

   IMPORTANTE: Esta función siempre genera el mismo conjunto de
   cartas. La aleatorización se hace en shuffleDeck().
───────────────────────────────────────────────────────────── */
function buildDeck() {
  const deck = [];
  let id = 0;

  for (const color of CARD_COLORS) {
    // ── Cartas numéricas ──────────────────────────────────────
    // Un 0 por color
    for (let i = 0; i < DECK_QUANTITIES.zero_per_color; i++) {
      deck.push({
        id:    `c${id++}`,
        type:  CARD_TYPES.NUMBER,
        color: color,
        value: 0,
      });
    }

    // Dos de cada número 1-9 por color
    for (let n = 1; n <= 9; n++) {
      for (let i = 0; i < DECK_QUANTITIES.number_per_color; i++) {
        deck.push({
          id:    `c${id++}`,
          type:  CARD_TYPES.NUMBER,
          color: color,
          value: n,
        });
      }
    }

    // ── Comodines con color ───────────────────────────────────
    // +2
    for (let i = 0; i < DECK_QUANTITIES.draw_two_per_color; i++) {
      deck.push({
        id:    `c${id++}`,
        type:  CARD_TYPES.DRAW_TWO,
        color: color,
        value: null,
      });
    }

    // Bloqueo
    for (let i = 0; i < DECK_QUANTITIES.skip_per_color; i++) {
      deck.push({
        id:    `c${id++}`,
        type:  CARD_TYPES.SKIP,
        color: color,
        value: null,
      });
    }

    // Reversa
    for (let i = 0; i < DECK_QUANTITIES.reverse_per_color; i++) {
      deck.push({
        id:    `c${id++}`,
        type:  CARD_TYPES.REVERSE,
        color: color,
        value: null,
      });
    }

    // ── Agregar comodines con color futuros aquí: ─────────────
    // Ejemplo: DRAW_SIX con color
    // for (let i = 0; i < DECK_QUANTITIES.draw_six_per_color; i++) {
    //   deck.push({ id: `c${id++}`, type: CARD_TYPES.DRAW_SIX, color, value: null });
    // }
  }

  // ── Comodines SIN color ─────────────────────────────────────
  // +4
  for (let i = 0; i < DECK_QUANTITIES.draw_four_total; i++) {
    deck.push({
      id:    `c${id++}`,
      type:  CARD_TYPES.DRAW_FOUR,
      color: null,
      value: null,
    });
  }

  // Cambio de color
  for (let i = 0; i < DECK_QUANTITIES.wild_color_total; i++) {
    deck.push({
      id:    `c${id++}`,
      type:  CARD_TYPES.WILD_COLOR,
      color: null,
      value: null,
    });
  }

  // ── Agregar comodines SIN color futuros aquí: ────────────────
  // Ejemplo: SWAP_HANDS sin color
  // for (let i = 0; i < DECK_QUANTITIES.swap_hands_total; i++) {
  //   deck.push({ id: `c${id++}`, type: CARD_TYPES.SWAP_HANDS, color: null, value: null });
  // }

  // Verificar tamaño del mazo (útil durante desarrollo)
  if (deck.length !== 108) {
    console.warn(`[buildDeck] El mazo tiene ${deck.length} cartas (se esperaban 108). Verifica DECK_QUANTITIES.`);
  }

  return deck; // 108 cartas
}


/* ─────────────────────────────────────────────────────────────
   shuffleDeck(deck)
   Baraja un array de cartas con el algoritmo Fisher-Yates.
   No modifica el original, retorna una copia barajada.
───────────────────────────────────────────────────────────── */
function shuffleDeck(deck) {
  // Copia superficial para no mutar el original
  const shuffled = [...deck];

  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    // Intercambio
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled;
}


/* ─────────────────────────────────────────────────────────────
   isActionCard(card)
   Retorna true si la carta es de acción (no es carta numérica).
   Se usa para validar la carta inicial del descarte.
───────────────────────────────────────────────────────────── */
function isActionCard(card) {
  return card.type !== CARD_TYPES.NUMBER;
}


/* ─────────────────────────────────────────────────────────────
   isColorlessCard(card)
   Retorna true si la carta no tiene color propio (+4, cambio color).
───────────────────────────────────────────────────────────── */
function isColorlessCard(card) {
  return COLORLESS_TYPES.has(card.type);
}


/* ─────────────────────────────────────────────────────────────
   isChainableCard(card)
   Retorna true si la carta puede usarse para continuar una cadena.
───────────────────────────────────────────────────────────── */
function isChainableCard(card) {
  return CHAINABLE_TYPES.has(card.type);
}


/* ─────────────────────────────────────────────────────────────
   getCardDrawAmount(card)
   Retorna cuántas cartas roba el siguiente jugador con esta carta.
   Si no es carta de robo, retorna 0.
───────────────────────────────────────────────────────────── */
function getCardDrawAmount(card) {
  switch (card.type) {
    case CARD_TYPES.DRAW_TWO:  return 2;
    case CARD_TYPES.DRAW_FOUR: return 4;
    // Agregar aquí casos futuros:
    // case CARD_TYPES.DRAW_SIX:  return 6;
    default: return 0;
  }
}


/* ─────────────────────────────────────────────────────────────
   getCardLabel(card)
   Retorna la etiqueta visual del centro de la carta.
   Para números retorna el número, para especiales retorna símbolo.
───────────────────────────────────────────────────────────── */
function getCardLabel(card) {
  if (card.type === CARD_TYPES.NUMBER) {
    return String(card.value);
  }
  return CARD_LABELS[card.type] || '?';
}


/* ─────────────────────────────────────────────────────────────
   getCardDisplayName(card)
   Retorna el nombre legible de la carta para el log de eventos.
   Ejemplos: "7 Rojo", "+2 Azul", "+4", "Cambio de color"
───────────────────────────────────────────────────────────── */
function getCardDisplayName(card) {
  const typeName  = CARD_TYPE_NAMES[card.type] || card.type;
  const colorName = card.color ? COLOR_NAMES[card.color] : null;

  if (card.type === CARD_TYPES.NUMBER) {
    return `${card.value} ${colorName}`;
  }
  if (colorName) {
    return `${typeName} ${colorName}`;
  }
  return typeName;
}


/* ─────────────────────────────────────────────────────────────
   getCardCssClass(card)
   Retorna la clase CSS de color para renderizar la carta.
   Para cartas sin color retorna 'card-wild'.
───────────────────────────────────────────────────────────── */
function getCardCssClass(card) {
  if (!card.color) return 'card-wild';
  return `card-${card.color}`;
}


/* ─────────────────────────────────────────────────────────────
   buildCardDefsMap(deck)
   Convierte el array de cartas en un objeto { id: card }
   para almacenar en Firebase y hacer lookups en O(1).
───────────────────────────────────────────────────────────── */
function buildCardDefsMap(deck) {
  const map = {};
  for (const card of deck) {
    map[card.id] = {
      type:  card.type,
      color: card.color,
      value: card.value,
    };
  }
  return map;
}


/* ─────────────────────────────────────────────────────────────
   getCardFromDefs(cardId, cardDefs)
   Recupera una carta completa desde el mapa de definiciones de Firebase.
   Retorna null si no se encuentra.
───────────────────────────────────────────────────────────── */
function getCardFromDefs(cardId, cardDefs) {
  if (!cardDefs || !cardDefs[cardId]) return null;
  return { id: cardId, ...cardDefs[cardId] };
}


/* ─────────────────────────────────────────────────────────────
   dealInitialHands(shuffledDeck, playerIds, cardsPerPlayer)
   Reparte cartas a todos los jugadores.
   Retorna: { hands, remainingDraw, firstDiscard }
   - hands: { playerId: [cardId, ...] }
   - remainingDraw: array de cardIds que quedan en el mazo
   - firstDiscard: cardId de la primera carta del descarte
     (garantizada no-acción por la lógica de startGame)
───────────────────────────────────────────────────────────── */
function dealInitialHands(shuffledDeck, playerIds, cardsPerPlayer) {
  const hands       = {};
  const deckIds     = shuffledDeck.map(c => c.id);
  let   deckPointer = 0;

  // Inicializar manos vacías
  for (const pid of playerIds) {
    hands[pid] = [];
  }

  // Repartir cardsPerPlayer cartas a cada jugador (estilo real: una a uno)
  for (let round = 0; round < cardsPerPlayer; round++) {
    for (const pid of playerIds) {
      if (deckPointer < deckIds.length) {
        hands[pid].push(deckIds[deckPointer++]);
      }
    }
  }

  // La primera carta del descarte viene después del reparto
  const firstDiscard   = deckIds[deckPointer++];
  const remainingDraw  = deckIds.slice(deckPointer);

  return { hands, remainingDraw, firstDiscard };
}


/* ─────────────────────────────────────────────────────────────
   RESUMEN DEL MAZO (para debug)
   Imprime la composición del mazo en consola.
───────────────────────────────────────────────────────────── */
function logDeckSummary() {
  const deck = buildDeck();
  const byType = {};
  for (const card of deck) {
    const key = card.color ? `${card.type}_${card.color}` : card.type;
    byType[key] = (byType[key] || 0) + 1;
  }
  console.table(byType);
  console.log(`[Mazo] Total: ${deck.length} cartas`);
}

// Descomentar para verificar el mazo durante desarrollo:
// logDeckSummary();
