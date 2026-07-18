// OWNER: Liam — Balloon Pop game renderer
(() => {
  window.gameRenderers = window.gameRenderers || {};

  let lastKnownEnded = new Set();
  let showingResult = null;
  let pumpAnimation = false;
  let selectedPumps = 1;

  window.gameRenderers.balloon = (state, container) => {
    const me = window.userById(state, window.currentUserId);
    const waitingGames = (state.balloonGames || []).filter((g) => g.status === "waiting");
    const playingGames = (state.balloonGames || []).filter((g) => g.status === "playing");
    const endedGames = (state.balloonGames || [])
      .filter((g) => g.status === "popped" || g.status === "drained")
      .slice(-5).reverse();

    // Detect newly ended games
    for (const game of state.balloonGames || []) {
      if ((game.status === "popped" || game.status === "drained") && !lastKnownEnded.has(game.id)) {
        lastKnownEnded.add(game.id);
        if (game.player1 === window.currentUserId || game.player2 === window.currentUserId) {
          showingResult = game.id;
        }
      }
    }

    const myPlayingGame = playingGames.find(
      (g) => g.player1 === window.currentUserId || g.player2 === window.currentUserId
    );
    const myWaitingGame = waitingGames.find((g) => g.player1 === window.currentUserId);

    if (showingResult) {
      const game = (state.balloonGames || []).find((g) => g.id === showingResult);
      if (game) {
        renderResult(game, state, container);
        return;
      }
      showingResult = null;
    }

    if (myPlayingGame) {
      renderPlay(myPlayingGame, state, container, me);
    } else if (myWaitingGame) {
      renderWaiting(myWaitingGame, state, container);
    } else {
      renderBrowse(waitingGames, endedGames, state, container, me);
    }
  };

  function balloonSvg(pumpCount, popped) {
    const scale = Math.min(1.5, 0.4 + pumpCount * 0.07);
    const hue = 350 - pumpCount * 8;
    const saturation = Math.min(90, 60 + pumpCount * 3);
    const color = `hsl(${hue}, ${saturation}%, 65%)`;
    const highlight = `hsl(${hue}, ${saturation}%, 82%)`;
    const wobble = pumpAnimation ? "balloon-wobble" : "";
    const danger = pumpCount >= 10 ? "balloon-danger" : pumpCount >= 6 ? "balloon-sweat" : "";

    if (popped) {
      return `<div class="balloon-area">
        <div class="balloon-pop-burst">
          <div class="pop-text">POP!</div>
          <div class="confetti-container">
            ${Array.from({ length: 12 }, (_, i) => {
              const angle = (i / 12) * 360;
              const hueC = (i * 30) % 360;
              return `<div class="confetti-piece" style="--angle:${angle}deg;--hue:${hueC};--delay:${i * 0.05}s"></div>`;
            }).join("")}
          </div>
          <div class="balloon-string-remnant"></div>
        </div>
      </div>`;
    }

    return `<div class="balloon-area ${wobble} ${danger}">
      <svg viewBox="0 0 200 280" class="balloon-svg" style="transform:scale(${scale})">
        <defs>
          <radialGradient id="balloonGrad" cx="35%" cy="30%" r="65%">
            <stop offset="0%" stop-color="${highlight}"/>
            <stop offset="100%" stop-color="${color}"/>
          </radialGradient>
        </defs>
        <ellipse cx="100" cy="110" rx="72" ry="90" fill="url(#balloonGrad)" stroke="${color}" stroke-width="1.5"/>
        <ellipse cx="80" cy="75" rx="18" ry="12" fill="rgba(255,255,255,0.3)" transform="rotate(-20 80 75)"/>
        <polygon points="88,198 100,215 112,198" fill="${color}"/>
        <line x1="100" y1="215" x2="100" y2="275" stroke="var(--vscode-foreground)" stroke-width="1.5" stroke-dasharray="4,3" opacity="0.5"/>
      </svg>
      ${pumpCount >= 6 ? `<div class="balloon-face">${pumpCount >= 12 ? "😰" : "😬"}</div>` : ""}
    </div>`;
  }

  function dangerMeter(pumpCount) {
    const pct = Math.min(100, Math.round(Math.min(0.9, 0.04 * (pumpCount + 1)) * 100));
    const segments = 18;
    return `<div class="danger-meter">
      <div class="danger-label">POP RISK</div>
      <div class="danger-bar">
        ${Array.from({ length: segments }, (_, i) => {
          const filled = (i / segments) * 100 < pct;
          const segHue = 120 - (i / segments) * 120;
          return `<div class="danger-seg${filled ? " filled" : ""}" style="background:${filled ? `hsl(${segHue},80%,50%)` : "var(--surface)"}"></div>`;
        }).join("")}
      </div>
      <div class="danger-pct">${pct}%</div>
    </div>`;
  }

  function creditBars(game) {
    const p1 = window.userById(window.exchangeState, game.player1);
    const p2 = window.userById(window.exchangeState, game.player2);
    const total = game.stake * 2;
    const p1Pct = total > 0 ? (game.p1Credits / total) * 100 : 50;
    const p2Pct = total > 0 ? (game.p2Credits / total) * 100 : 50;
    const isP1 = window.currentUserId === game.player1;

    return `<div class="credit-tug">
      <div class="tug-player ${isP1 ? "tug-you" : ""}">
        <strong>${window.escapeHtml(p1?.name || "?")}</strong>
        <span>${game.p1Credits}cr</span>
      </div>
      <div class="tug-bar">
        <div class="tug-fill tug-p1" style="width:${p1Pct}%"></div>
        <div class="tug-fill tug-p2" style="width:${p2Pct}%"></div>
      </div>
      <div class="tug-player ${!isP1 ? "tug-you" : ""}">
        <strong>${window.escapeHtml(p2?.name || "?")}</strong>
        <span>${game.p2Credits}cr</span>
      </div>
    </div>`;
  }

  function renderBrowse(waitingGames, endedGames, state, container, me) {
    container.innerHTML = `
      <div class="balloon-container">
        <div class="section-heading"><div><div class="eyebrow">PUSH YOUR LUCK</div><h2>Balloon Pop</h2></div></div>
        <p class="muted">Take turns pumping a balloon. Choose 1-5 pumps per turn — more pumps = more credits stolen, but higher pop risk. Pop it and you lose everything!</p>
        <form id="balloon-create-form" class="balloon-form">
          <label for="balloon-stake">Stake per player</label>
          <div class="form-row">
            <input id="balloon-stake" name="stake" type="number" min="1" step="1" value="25">
            <button class="primary" ${me ? "" : "disabled"}>Challenge</button>
          </div>
          <div class="muted">Your spendable balance: ${me ? `${me.balance}cr` : "unknown user"}</div>
        </form>
        <div class="section-heading"><div><div class="eyebrow">OPEN</div><h2>Challenges</h2></div></div>
        <div class="card-list">
          ${waitingGames.length ? waitingGames.map((game) => {
            const creator = window.userById(state, game.player1);
            return `<article class="card listing">
              <div>
                <div class="card-title">${window.escapeHtml(creator?.name || "Unknown")} · ${game.stake}cr stake</div>
                <div class="muted">Winner takes up to ${game.stake * 2}cr</div>
              </div>
              ${game.player1 === window.currentUserId
                ? '<span class="mine">waiting</span>'
                : `<button data-balloon-action="join" data-balloon-id="${window.escapeHtml(game.id)}">Accept</button>`}
            </article>`;
          }).join("") : '<div class="empty">No open balloon games. Start one!</div>'}
        </div>
        <div class="section-heading"><div><div class="eyebrow">RECENT</div><h2>Results</h2></div></div>
        <div class="card-list">
          ${endedGames.length ? endedGames.map((game) => {
            const winner = window.userById(state, game.winnerId);
            const loserName = game.poppedBy
              ? window.userById(state, game.poppedBy)?.name || "Unknown"
              : (game.winnerId === game.player1 ? window.userById(state, game.player2)?.name : window.userById(state, game.player1)?.name) || "Unknown";
            const endType = game.status === "popped" ? `popped on pump #${game.pumpCount}` : "drained";
            return `<article class="card">
              <div>
                <strong>${window.escapeHtml(winner?.name || "Unknown")} won</strong>
                <div class="muted">${window.escapeHtml(loserName)} ${endType}</div>
              </div>
            </article>`;
          }).join("") : '<div class="empty">No finished games yet.</div>'}
        </div>
      </div>`;
  }

  function renderWaiting(game, state, container) {
    container.innerHTML = `
      <div class="balloon-container">
        <div class="section-heading"><div><div class="eyebrow">WAITING</div><h2>Balloon Pop · ${game.stake}cr each</h2></div></div>
        ${balloonSvg(0, false)}
        <div class="balloon-status">
          <div class="muted" style="text-align:center">Waiting for an opponent to join...</div>
          <div class="muted" style="text-align:center">Each player stakes ${game.stake}cr</div>
        </div>
      </div>`;
  }

  function renderPlay(game, state, container, me) {
    const isMyTurn = game.currentTurn === window.currentUserId;
    const opponent = game.player1 === window.currentUserId
      ? window.userById(state, game.player2)
      : window.userById(state, game.player1);
    const crPerPump = Math.ceil(game.stake / 10);
    // Next pop chance is based on (pumpCount + 1) since that's what the next pump will be
    const nextPopPct = Math.min(90, Math.round(Math.min(0.9, 0.04 * (game.pumpCount + 1)) * 100));
    // Survival chance for N pumps: product of (1 - popChance) for each
    function survivalPct(n) {
      let surv = 1;
      for (let i = 1; i <= n; i++) {
        surv *= 1 - Math.min(0.9, 0.04 * (game.pumpCount + i));
      }
      return Math.round(surv * 100);
    }

    container.innerHTML = `
      <div class="balloon-container">
        <div class="section-heading"><div><div class="eyebrow">LIVE GAME</div><h2>vs ${window.escapeHtml(opponent?.name || "Unknown")}</h2></div></div>
        ${balloonSvg(game.pumpCount, false)}
        ${dangerMeter(game.pumpCount)}
        ${creditBars(game)}
        <div class="balloon-stats">
          <div class="pump-count">Pump #${game.pumpCount}</div>
          <div class="pot-size">${crPerPump}cr per pump</div>
        </div>
        <div class="balloon-turn ${isMyTurn ? "my-turn" : "their-turn"}">
          ${isMyTurn
            ? `<div class="turn-text">YOUR TURN</div>
               <div class="pump-picker">
                 <label>How many pumps?</label>
                 <div class="pump-slider-row">
                   <input type="range" min="1" max="5" value="${selectedPumps}" id="pump-slider">
                   <div class="pump-count-display" id="pump-display">${selectedPumps}</div>
                 </div>
                 <div class="pump-risk-info" id="pump-risk">
                   Survival: ${survivalPct(selectedPumps)}% · Reward: +${crPerPump * selectedPumps}cr
                 </div>
               </div>
               <button class="primary balloon-pump-btn" data-balloon-action="inflate" data-balloon-id="${window.escapeHtml(game.id)}">
                 PUMP x${selectedPumps}
               </button>`
            : `<div class="turn-text">${window.escapeHtml(opponent?.name || "Unknown")}'s turn...</div>
               <div class="waiting-dots"><span>.</span><span>.</span><span>.</span></div>`}
        </div>
      </div>`;

    // Wire up slider (needs to work after innerHTML)
    const slider = document.getElementById("pump-slider");
    if (slider) {
      slider.addEventListener("input", () => {
        selectedPumps = Number(slider.value);
        const display = document.getElementById("pump-display");
        const riskInfo = document.getElementById("pump-risk");
        const btn = container.querySelector("[data-balloon-action='inflate']");
        if (display) display.textContent = selectedPumps;
        if (riskInfo) riskInfo.textContent = `Survival: ${survivalPct(selectedPumps)}% · Reward: +${crPerPump * selectedPumps}cr`;
        if (btn) btn.textContent = `PUMP x${selectedPumps}`;
      });
    }

    if (pumpAnimation) {
      setTimeout(() => { pumpAnimation = false; }, 500);
    }
  }

  function renderResult(game, state, container) {
    const winner = window.userById(state, game.winnerId);
    const iWon = game.winnerId === window.currentUserId;
    const isPopped = game.status === "popped";
    const loserName = game.poppedBy
      ? window.userById(state, game.poppedBy)?.name || "Unknown"
      : (game.winnerId === game.player1
          ? window.userById(state, game.player2)?.name
          : window.userById(state, game.player1)?.name) || "Unknown";

    container.innerHTML = `
      <div class="balloon-container">
        <div class="section-heading"><div><div class="eyebrow">GAME OVER</div><h2>Balloon Pop Result</h2></div></div>
        ${balloonSvg(game.pumpCount, isPopped)}
        <div class="balloon-result ${iWon ? "won" : "lost"}">
          <div class="result-emoji">${iWon ? "🎉" : "💀"}</div>
          <div class="result-title">${iWon ? "YOU WIN!" : "YOU LOSE!"}</div>
          <div class="result-detail">
            ${isPopped
              ? `${window.escapeHtml(loserName)} popped the balloon on pump #${game.pumpCount}`
              : `${window.escapeHtml(loserName)} was drained of all credits`}
          </div>
          <div class="result-amount">${iWon ? "+" : "-"}${game.stake}cr</div>
        </div>
        <div class="balloon-players-result">
          <div class="bp-player ${game.winnerId === game.player1 ? "winner" : ""}">
            <strong>${window.escapeHtml(window.userById(state, game.player1)?.name || "?")}</strong>
            <span>${game.winnerId === game.player1 ? `+${game.stake}cr` : `-${game.stake}cr`}</span>
          </div>
          <div class="bp-player ${game.winnerId === game.player2 ? "winner" : ""}">
            <strong>${window.escapeHtml(window.userById(state, game.player2)?.name || "?")}</strong>
            <span>${game.winnerId === game.player2 ? `+${game.stake}cr` : `-${game.stake}cr`}</span>
          </div>
        </div>
        <button data-balloon-action="dismiss" style="width:100%">Back to games</button>
      </div>`;
  }

  // ===== EVENT HANDLERS =====

  // Create balloon game
  document.addEventListener("submit", async (event) => {
    if (event.target.id !== "balloon-create-form") return;
    event.preventDefault();
    const button = event.target.querySelector("button");
    const stake = Number(new FormData(event.target).get("stake"));
    button.disabled = true;
    try {
      await window.api("/games/balloon", { creatorId: window.currentUserId, stake });
    } catch {
    } finally {
      button.disabled = false;
    }
  });

  // Join balloon game
  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-balloon-action='join']");
    if (!button || button.disabled) return;
    button.disabled = true;
    try {
      await window.api(`/games/balloon/${encodeURIComponent(button.dataset.balloonId)}/join`, { userId: window.currentUserId });
    } catch {
    } finally {
      button.disabled = false;
    }
  });

  // Inflate balloon
  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-balloon-action='inflate']");
    if (!button || button.disabled) return;
    button.disabled = true;
    pumpAnimation = true;
    try {
      await window.api(`/games/balloon/${encodeURIComponent(button.dataset.balloonId)}/inflate`, {
        userId: window.currentUserId,
        pumps: selectedPumps,
      });
    } catch {
    } finally {
      button.disabled = false;
    }
  });

  // Dismiss result
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-balloon-action='dismiss']");
    if (!button) return;
    showingResult = null;
    selectedPumps = 1;
    if (window.exchangeState) window.renderers.bet(window.exchangeState);
  });
})();
