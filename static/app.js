const state = {
  rankedSongs: [],
};

const songsList = document.getElementById("songsList");
const statusMsg = document.getElementById("statusMsg");
const refreshBtn = document.getElementById("refreshBtn");
const musicianNameInput = document.getElementById("musicianName");
const proposalForm = document.getElementById("proposalForm");
const proposalSongTitle = document.getElementById("proposalSongTitle");
const proposalAuthor = document.getElementById("proposalAuthor");
const proposalTone = document.getElementById("proposalTone");
const proposalInstrument = document.getElementById("proposalInstrument");

const joinModal = document.getElementById("joinModal");
const joinModalSong = document.getElementById("joinModalSong");
const joinInstrument = document.getElementById("joinInstrument");
const joinCancel = document.getElementById("joinCancel");
const joinConfirm = document.getElementById("joinConfirm");

const instrumentLabels = {
  chitarra: "Chitarra",
  basso: "Basso",
  batteria: "Batteria",
  tastiere: "Tastiere",
  voce: "Voce",
  altro: "Altro",
};

let pendingJoinSongId = null;

function parseSongId(raw) {
  const value = Number.parseInt(String(raw), 10);
  return Number.isFinite(value) ? value : NaN;
}

function findSongById(songId) {
  return state.rankedSongs.find((item) => parseSongId(item.id) === songId);
}

refreshBtn.addEventListener("click", () => {
  loadSongs();
});

musicianNameInput.addEventListener("input", () => {
  renderSongs();
});

proposalForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await submitProposal();
});

joinCancel.addEventListener("click", () => closeJoinModal());
joinModal.querySelectorAll("[data-close-modal]").forEach((node) => {
  node.addEventListener("click", () => closeJoinModal());
});

joinConfirm.addEventListener("click", async () => {
  if (pendingJoinSongId === null) {
    closeJoinModal();
    return;
  }
  if (!requireMusicianName()) {
    return;
  }
  const instrument = joinInstrument.value;
  if (!instrument) {
    setStatus("Seleziona uno strumento");
    return;
  }
  const songId = pendingJoinSongId;
  closeJoinModal();
  await joinSong(songId, instrument);
});

function currentMusician() {
  return musicianNameInput.value.trim();
}

function requireMusicianName() {
  if (currentMusician()) {
    return true;
  }
  window.alert("Inserisci prima il tuo nome in alto, così possiamo registrare voti e strumenti correttamente.");
  musicianNameInput.focus();
  return false;
}

async function readJsonResponse(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (error) {
    const preview = text.replace(/\s+/g, " ").slice(0, 160);
    throw new Error(
      `Risposta non valida dal server (HTTP ${response.status}). ${preview ? `Anteprima: ${preview}` : ""}`.trim()
    );
  }
}

function rankSongs(songs) {
  return [...songs].sort((left, right) => {
    if (right.participantsCount !== left.participantsCount) {
      return right.participantsCount - left.participantsCount;
    }
    if (right.heartsCount !== left.heartsCount) {
      return right.heartsCount - left.heartsCount;
    }
    return String(left.songTitle).localeCompare(String(right.songTitle), "it", {
      sensitivity: "base",
    });
  });
}

async function loadSongs() {
  setStatus("Caricamento brani...");
  try {
    const response = await fetch("/api/songs");
    const data = await readJsonResponse(response);
    if (!response.ok) {
      throw new Error(data.error || "Errore nel caricamento dei brani");
    }
    if (data.error) {
      throw new Error(data.error);
    }
    const songs = data.songs || [];
    state.rankedSongs = rankSongs(songs);
    renderSongs();
    setStatus(`Caricati ${songs.length} brani`);
  } catch (error) {
    setStatus(error.message);
  }
}

function sheetHeader() {
  return `
    <div class="sheet-row sheet-header">
      <div class="col col-pos">Pos</div>
      <div class="col col-title">Brano</div>
      <div class="col col-meta">Autore / Tonalità</div>
      <div class="col col-musicians">Musicisti</div>
      <div class="col col-love">Love</div>
    </div>
  `;
}

function formatMusiciansDetail(song) {
  const parts = [];
  Object.entries(instrumentLabels).forEach(([key, label]) => {
    const slot = song.instruments[key];
    if (!slot) {
      return;
    }
    const name = slot.playerName;
    if (name) {
      parts.push(`${label}: ${name}`);
    }
  });
  return parts.join(" · ");
}

function countOpenInstrumentSlots(song) {
  return Object.keys(instrumentLabels).filter((key) => {
    const slot = song.instruments[key];
    return slot && !slot.taken;
  }).length;
}

function currentUserInstrumentKeys(song) {
  return Object.keys(instrumentLabels).filter((key) => {
    const slot = song.instruments[key];
    if (!slot || !slot.taken || !slot.playerName) {
      return false;
    }
    return isCurrentMusician(slot.playerName);
  });
}

function renderLoveCell(song) {
  const myHeart = Array.isArray(song.hearts)
    ? song.hearts.some((name) => isCurrentMusician(name))
    : false;
  const songId = parseSongId(song.id);
  if (!Number.isFinite(songId)) {
    return `
      <div class="love-cell">
        <button type="button" class="heart-btn heart-btn-disabled" disabled aria-label="Love non disponibile per questo brano">
          ❤
        </button>
        <span class="love-count">${song.heartsCount}</span>
      </div>
    `;
  }

  return `
    <div class="love-cell">
      <button type="button" class="heart-btn ${myHeart ? "heart-btn-active" : ""}" data-heart-song-id="${songId}" aria-label="Love per questo brano">
        ❤
      </button>
      <span class="love-count">${song.heartsCount}</span>
    </div>
  `;
}

function renderMusiciansCell(song) {
  const songId = parseSongId(song.id);
  const openSlots = countOpenInstrumentSlots(song);
  const myInstrumentKeys = currentUserInstrumentKeys(song);
  const iParticipate = myInstrumentKeys.length > 0;
  const detail = formatMusiciansDetail(song);
  const countLine = `<div class="musicians-count">${song.participantsCount} in formazione</div>`;
  const detailLine = detail
    ? `<div class="musicians-detail">${escapeHtml(detail)}</div>`
    : `<div class="musicians-detail muted">Nessun musicista ancora</div>`;

  if (!Number.isFinite(songId)) {
    return `
      <div class="musicians-cell">
        ${countLine}
        ${detailLine}
        <button type="button" class="tiny-btn tiny-btn-disabled" disabled>Dati brano errati</button>
      </div>
    `;
  }

  const actions = [];
  if (openSlots > 0) {
    actions.push(`<button type="button" class="tiny-btn" data-open-join="${songId}">Aggiungiti</button>`);
  } else if (!iParticipate) {
    actions.push(`<button type="button" class="tiny-btn tiny-btn-disabled" disabled>Completo</button>`);
  }
  if (iParticipate) {
    actions.push(
      `<button type="button" class="tiny-btn tiny-btn-leave" data-leave-song="${songId}">Lascia questo brano</button>`
    );
  }

  const actionsRow =
    actions.length > 0 ? `<div class="musicians-actions">${actions.join("")}</div>` : "";

  return `
    <div class="musicians-cell">
      ${countLine}
      ${detailLine}
      ${actionsRow}
    </div>
  `;
}

function renderSongs() {
  if (state.rankedSongs.length === 0) {
    songsList.innerHTML = "<p class=\"empty-msg\">Nessun brano disponibile al momento.</p>";
    return;
  }

  const rows = state.rankedSongs
    .map((song, idx) => {
      const hot = Boolean(song.eligibleForScaletta);
      const hotBadge = hot ? `<span class="hot-badge" title="Almeno 3 musicisti">HOT</span>` : "";
      return `
        <div class="sheet-row ${hot ? "sheet-row-hot" : ""}">
          <div class="col col-pos">${idx + 1}</div>
          <div class="col col-title">
            ${escapeHtml(song.songTitle)}
            ${hotBadge}
          </div>
          <div class="col col-meta">${escapeHtml(song.author || "Autore non indicato")} / ${escapeHtml(song.tone || "Tonalità non indicata")}</div>
          <div class="col col-musicians">${renderMusiciansCell(song)}</div>
          <div class="col col-love">${renderLoveCell(song)}</div>
        </div>
      `;
    })
    .join("");

  songsList.innerHTML = `${sheetHeader()}${rows}`;

  document.querySelectorAll("[data-heart-song-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      const songId = parseSongId(button.getAttribute("data-heart-song-id"));
      await voteSong(songId);
    });
  });

  document.querySelectorAll("[data-open-join]").forEach((button) => {
    button.addEventListener("click", () => {
      const songId = parseSongId(button.getAttribute("data-open-join"));
      openJoinModal(songId);
    });
  });

  document.querySelectorAll("[data-leave-song]").forEach((button) => {
    button.addEventListener("click", async () => {
      const songId = parseSongId(button.getAttribute("data-leave-song"));
      await leaveSong(songId);
    });
  });
}

function openJoinModal(songId) {
  if (!Number.isFinite(songId)) {
    setStatus("ID brano non valido");
    return;
  }
  if (!requireMusicianName()) {
    return;
  }

  const song = findSongById(songId);
  if (!song) {
    setStatus("Brano non trovato");
    return;
  }

  pendingJoinSongId = songId;
  joinModalSong.textContent = `${song.songTitle} — ${song.author || ""}`.trim();

  joinInstrument.innerHTML = "";

  const freeKeys = Object.keys(instrumentLabels).filter((key) => {
    const slot = song.instruments[key];
    return slot && !slot.taken;
  });

  if (freeKeys.length === 0) {
    joinInstrument.innerHTML = `<option value="">Nessuno slot libero</option>`;
    joinInstrument.disabled = true;
    joinConfirm.disabled = true;
  } else {
    joinInstrument.disabled = false;
    joinConfirm.disabled = false;
    joinInstrument.appendChild(new Option("Seleziona strumento", "", true, true));
    freeKeys.forEach((key) => {
      joinInstrument.appendChild(new Option(instrumentLabels[key], key));
    });
  }

  joinModal.hidden = false;
}

function closeJoinModal() {
  pendingJoinSongId = null;
  joinModal.hidden = true;
  joinInstrument.innerHTML = "";
}

async function voteSong(songId) {
  if (!Number.isFinite(songId)) {
    setStatus("ID brano non valido");
    return;
  }
  if (!requireMusicianName()) {
    return;
  }
  const musicianName = currentMusician();

  setStatus("Invio voto...");
  try {
    const response = await fetch(`/api/songs/${songId}/heart`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ musicianName }),
    });
    const data = await readJsonResponse(response);
    if (!response.ok) {
      throw new Error(data.error || "Errore nel voto");
    }
    await loadSongs();
    if (data.action === "removed") {
      setStatus("Voto rimosso");
    } else {
      setStatus("Voto registrato");
    }
  } catch (error) {
    setStatus(error.message);
  }
}

async function joinSong(songId, instrument) {
  if (!Number.isFinite(songId)) {
    setStatus("ID brano non valido");
    return;
  }
  if (!requireMusicianName()) {
    return;
  }
  const musicianName = currentMusician();

  setStatus("Prenotazione strumento...");
  try {
    const response = await fetch(`/api/songs/${songId}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ musicianName, instrument }),
    });
    const data = await readJsonResponse(response);
    if (!response.ok) {
      throw new Error(data.error || "Errore nella prenotazione dello strumento");
    }
    await loadSongs();
    if (data.action === "removed") {
      setStatus("Posto liberato");
    } else {
      setStatus("Strumento assegnato");
    }
  } catch (error) {
    setStatus(error.message);
  }
}

async function leaveSong(songId) {
  if (!Number.isFinite(songId)) {
    setStatus("ID brano non valido");
    return;
  }
  if (!requireMusicianName()) {
    return;
  }
  const musicianName = currentMusician();

  setStatus("Uscita dal brano...");
  try {
    const response = await fetch(`/api/songs/${songId}/leave`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ musicianName }),
    });
    const data = await readJsonResponse(response);
    if (!response.ok) {
      throw new Error(data.error || "Errore nell'uscita dal brano");
    }
    await loadSongs();
    if (data.action === "noop") {
      setStatus("Non risultavi su questo brano");
    } else {
      setStatus("Hai lasciato il brano");
    }
  } catch (error) {
    setStatus(error.message);
  }
}

async function submitProposal() {
  const songTitle = proposalSongTitle.value.trim();
  const author = proposalAuthor.value.trim();
  const tone = proposalTone.value.trim();
  const instrument = proposalInstrument.value;

  if (!requireMusicianName()) {
    return;
  }
  const musicianName = currentMusician();

  setStatus("Aggiunta nuovo brano...");
  try {
    const response = await fetch("/api/songs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        songTitle,
        author,
        tone,
        musicianName,
        instrument,
      }),
    });
    const data = await readJsonResponse(response);
    if (!response.ok) {
      throw new Error(data.error || "Errore durante la proposta del brano");
    }
    proposalForm.reset();
    await loadSongs();
    setStatus("Brano proposto con successo");
  } catch (error) {
    setStatus(error.message);
  }
}

function setStatus(message) {
  statusMsg.textContent = message;
}

function escapeHtml(input) {
  return String(input)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeName(input) {
  return String(input || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function isCurrentMusician(name) {
  const current = normalizeName(currentMusician());
  if (!current) {
    return false;
  }
  return normalizeName(name) === current;
}

loadSongs();
