// OWNER: D + Liam — Wheel Spin game renderer + Canvas animation
(() => {
  const COLORS = ["#e8ff2b", "#ff6b6b", "#4ecdc4", "#45b7d1", "#f7dc6f", "#bb8fce"];
  const SPIN_DURATION = 4000; // ms
  const MIN_ROTATIONS = 4;

  // Track animation state across renders
  let activeAnimation = null; // { gameId, startTime, startAngle, targetAngle, settled }
  let lastKnownSettled = new Set(); // game IDs we already know are settled

  // Ensure registry exists (belt-and-suspenders with bet.js)
  window.gameRenderers = window.gameRenderers || {};
  window.gameRenderers.wheel = (state, container) => {
    const me = window.userById(state, window.currentUserId);
    const waitingGames = (state.wheelGames || []).filter((g) => g.status === "waiting");
    const settledGames = (state.wheelGames || []).filter((g) => g.status === "settled").slice(-5).reverse();

    // Detect newly settled games to trigger animation
    for (const game of state.wheelGames || []) {
      if (game.status === "settled" && !lastKnownSettled.has(game.id)) {
        lastKnownSettled.add(game.id);
        // Only animate if we're looking at this game (player is in it)
        if (game.players.some((p) => p.userId === window.currentUserId) || activeAnimation?.gameId === game.id) {
          startSpinAnimation(game);
        }
      }
    }

    // If animation is running, only update the player list / result — don't rebuild canvas
    if (activeAnimation && !activeAnimation.settled) {
      return;
    }

    // Find a game the current user is in (waiting)
    const myWaitingGame = waitingGames.find((g) => g.players.some((p) => p.userId === window.currentUserId));

    if (myWaitingGame) {
      renderLobby(myWaitingGame, state, container, me);
    } else if (activeAnimation && activeAnimation.settled) {
      const finishedGame = (state.wheelGames || []).find((g) => g.id === activeAnimation.gameId);
      if (finishedGame) {
        renderResult(finishedGame, state, container);
      } else {
        renderBrowse(waitingGames, settledGames, state, container, me);
      }
    } else {
      renderBrowse(waitingGames, settledGames, state, container, me);
    }
  };

  function renderBrowse(waitingGames, settledGames, state, container, me) {
    container.innerHTML = `
      <div class="wheel-container">
        <div class="section-heading"><div><div class="eyebrow">VIRTUAL ONLY</div><h2>Wheel Spin</h2></div></div>
        <p class="muted">Wager credits, spin the wheel. Bigger wager = bigger slice = higher chance. No cash value.</p>
        <form id="wheel-create-form" class="wheel-create-form">
          <label for="wheel-wager">Your wager</label>
          <div class="form-row">
            <input id="wheel-wager" name="wager" type="number" min="1" step="1" value="25">
            <button class="primary" ${me ? "" : "disabled"}>Create Game</button>
          </div>
          <div class="muted">Your spendable balance: ${me ? `${me.balance}cr` : "unknown user"}</div>
        </form>
        <div class="section-heading"><div><div class="eyebrow">OPEN</div><h2>Waiting for players</h2></div></div>
        <div class="card-list">
          ${waitingGames.length ? waitingGames.map((game) => {
            const creator = window.userById(state, game.creatorId);
            const playerNames = game.players.map((p) => window.userById(state, p.userId)?.name || "?").join(", ");
            const alreadyIn = game.players.some((p) => p.userId === window.currentUserId);
            return `<article class="card">
              <div>
                <div class="card-title">${window.escapeHtml(creator?.name || "Unknown")}'s wheel · ${game.totalPot}cr pot</div>
                <div class="muted">${game.players.length}/6 players: ${window.escapeHtml(playerNames)}</div>
              </div>
              ${alreadyIn ? '<span class="mine">you\'re in</span>' : `<div class="form-row">
                <input type="number" min="1" step="1" value="25" class="wheel-join-wager" data-wheel-game="${window.escapeHtml(game.id)}" style="width:70px">
                <button data-wheel-action="join" data-wheel-id="${window.escapeHtml(game.id)}">Join</button>
              </div>`}
            </article>`;
          }).join("") : '<div class="empty">No open wheel games. Create one!</div>'}
        </div>
        <div class="section-heading"><div><div class="eyebrow">RECENT</div><h2>Results</h2></div></div>
        <div class="card-list">
          ${settledGames.length ? settledGames.map((game) => {
            const winner = window.userById(state, game.winnerId);
            return `<article class="card"><strong>${window.escapeHtml(winner?.name || "Unknown")} won ${game.totalPot}cr</strong><span class="muted">wheel spin · ${game.players.length} players</span></article>`;
          }).join("") : '<div class="empty">No completed wheel games yet.</div>'}
        </div>
      </div>`;
  }

  function renderLobby(game, state, container, me) {
    const isCreator = game.creatorId === window.currentUserId;
    const canSpin = isCreator && game.players.length >= 2;

    container.innerHTML = `
      <div class="wheel-container">
        <div class="section-heading"><div><div class="eyebrow">GAME LOBBY</div><h2>Wheel Spin · ${game.totalPot}cr pot</h2></div></div>
        <div class="wheel-canvas-wrap">
          <div class="wheel-pointer"></div>
          <canvas id="wheel-canvas" width="280" height="280"></canvas>
        </div>
        <div class="wheel-players">
          ${game.players.map((p, i) => {
            const user = window.userById(state, p.userId);
            const pct = game.totalPot > 0 ? ((p.wager / game.totalPot) * 100).toFixed(1) : 0;
            return `<div class="wheel-player">
              <span class="swatch" style="background:${COLORS[i % COLORS.length]}"></span>
              <strong>${window.escapeHtml(user?.name || "Unknown")}</strong>
              <span class="muted">${p.wager}cr (${pct}%)</span>
            </div>`;
          }).join("")}
        </div>
        <div class="muted" style="text-align:center">${game.players.length}/6 players · waiting for ${isCreator ? "you to spin" : "creator to spin"}...</div>
        ${isCreator ? `<button class="primary" data-wheel-action="spin" data-wheel-id="${window.escapeHtml(game.id)}" ${canSpin ? "" : "disabled"} style="justify-self:center;width:100%">
          ${canSpin ? "SPIN THE WHEEL" : `Need ${2 - game.players.length} more player(s)`}
        </button>` : ""}
      </div>`;

    drawWheel(document.getElementById("wheel-canvas"), game, 0);
  }

  function renderResult(game, state, container) {
    const winner = window.userById(state, game.winnerId);

    container.innerHTML = `
      <div class="wheel-container">
        <div class="section-heading"><div><div class="eyebrow">SETTLED</div><h2>Wheel Spin Result</h2></div></div>
        <div class="wheel-canvas-wrap">
          <div class="wheel-pointer"></div>
          <canvas id="wheel-canvas" width="280" height="280"></canvas>
        </div>
        <div class="wheel-result">
          <div class="winner-name">${window.escapeHtml(winner?.name || "Unknown")} wins!</div>
          <div class="winner-amount">${game.totalPot}cr collected</div>
        </div>
        <div class="wheel-players">
          ${game.players.map((p, i) => {
            const user = window.userById(state, p.userId);
            const isWinner = p.userId === game.winnerId;
            return `<div class="wheel-player" style="${isWinner ? "border:1px solid var(--accent);background:var(--surface)" : ""}">
              <span class="swatch" style="background:${COLORS[i % COLORS.length]}"></span>
              <strong>${window.escapeHtml(user?.name || "Unknown")}${isWinner ? " ★" : ""}</strong>
              <span class="muted">${p.wager}cr</span>
            </div>`;
          }).join("")}
        </div>
        <button data-wheel-action="dismiss" style="width:100%">Back to games</button>
      </div>`;

    // Draw wheel at the final resting angle
    if (activeAnimation) {
      drawWheel(document.getElementById("wheel-canvas"), game, activeAnimation.targetAngle);
    } else {
      drawWheel(document.getElementById("wheel-canvas"), game, 0);
    }
  }

  function drawWheel(canvas, game, rotationAngle) {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const radius = Math.min(cx, cy) - 4;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rotationAngle);

    let startAngle = 0;
    for (let i = 0; i < game.players.length; i++) {
      const p = game.players[i];
      const sliceAngle = (p.wager / game.totalPot) * Math.PI * 2;

      // Draw slice
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, radius, startAngle, startAngle + sliceAngle);
      ctx.closePath();
      ctx.fillStyle = COLORS[i % COLORS.length];
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.3)";
      ctx.lineWidth = 2;
      ctx.stroke();

      // Label
      if (sliceAngle > 0.25) {
        const midAngle = startAngle + sliceAngle / 2;
        const labelRadius = radius * 0.6;
        const lx = Math.cos(midAngle) * labelRadius;
        const ly = Math.sin(midAngle) * labelRadius;
        ctx.save();
        ctx.translate(lx, ly);
        ctx.rotate(midAngle + Math.PI / 2);
        ctx.fillStyle = "#111";
        ctx.font = "bold 11px var(--vscode-font-family, monospace)";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const user = window.userById(window.exchangeState, p.userId);
        ctx.fillText(user?.name || "?", 0, -6);
        ctx.font = "10px var(--vscode-font-family, monospace)";
        ctx.fillText(`${p.wager}cr`, 0, 7);
        ctx.restore();
      }

      startAngle += sliceAngle;
    }

    // Center circle
    ctx.beginPath();
    ctx.arc(0, 0, 14, 0, Math.PI * 2);
    ctx.fillStyle = "#1e1e1e";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.2)";
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.restore();
  }

  function startSpinAnimation(game) {
    // Calculate target angle: the pointer is at the top (- PI/2).
    // We need the winner's slice midpoint to be at the top after rotation.
    let winnerStart = 0;
    let winnerSlice = 0;
    for (const p of game.players) {
      const sliceAngle = (p.wager / game.totalPot) * Math.PI * 2;
      if (p.userId === game.winnerId) {
        winnerSlice = sliceAngle;
        break;
      }
      winnerStart += sliceAngle;
    }
    // Land randomly within the winner's slice (not always dead center)
    const offset = (Math.random() - 0.5) * winnerSlice * 0.6;
    const winnerMid = winnerStart + winnerSlice / 2 + offset;
    // The pointer is at -PI/2 (top). Rotate so winnerMid lands there.
    // Must use INTEGER full rotations so we don't overshoot the target slice.
    const baseAngle = -Math.PI / 2 - winnerMid;
    const targetAngle = baseAngle + Math.PI * 2 * (MIN_ROTATIONS + Math.floor(Math.random() * 3));

    activeAnimation = {
      gameId: game.id,
      startTime: performance.now(),
      startAngle: 0,
      targetAngle,
      settled: false,
    };

    function animate(now) {
      if (!activeAnimation || activeAnimation.gameId !== game.id) return;

      const elapsed = now - activeAnimation.startTime;
      const progress = Math.min(1, elapsed / SPIN_DURATION);

      // Ease-out cubic for deceleration
      const eased = 1 - Math.pow(1 - progress, 3);
      const currentAngle = activeAnimation.startAngle + (activeAnimation.targetAngle - activeAnimation.startAngle) * eased;

      const canvas = document.getElementById("wheel-canvas");
      drawWheel(canvas, game, currentAngle);

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        activeAnimation.settled = true;
        // Re-render to show result view
        if (window.exchangeState) window.renderers.bet(window.exchangeState);
      }
    }

    // Rebuild UI to show the wheel (lobby view) during animation
    const container = document.querySelector("#game-content");
    if (container) {
      container.innerHTML = `
        <div class="wheel-container">
          <div class="section-heading"><div><div class="eyebrow">SPINNING</div><h2>Wheel Spin · ${game.totalPot}cr pot</h2></div></div>
          <div class="wheel-canvas-wrap">
            <div class="wheel-pointer"></div>
            <canvas id="wheel-canvas" width="280" height="280"></canvas>
          </div>
          <div class="wheel-players">
            ${game.players.map((p, i) => {
              const user = window.userById(window.exchangeState, p.userId);
              return `<div class="wheel-player">
                <span class="swatch" style="background:${COLORS[i % COLORS.length]}"></span>
                <strong>${window.escapeHtml(user?.name || "Unknown")}</strong>
                <span class="muted">${p.wager}cr</span>
              </div>`;
            }).join("")}
          </div>
        </div>`;
    }

    requestAnimationFrame(animate);
  }

  // ===== EVENT HANDLERS =====

  // Create wheel game
  document.addEventListener("submit", async (event) => {
    if (event.target.id !== "wheel-create-form") return;
    event.preventDefault();
    const button = event.target.querySelector("button");
    const wager = Number(new FormData(event.target).get("wager"));
    button.disabled = true;
    try {
      await window.api("/games/wheel", { creatorId: window.currentUserId, wager });
    } catch {
    } finally {
      button.disabled = false;
    }
  });

  // Join wheel game
  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-wheel-action='join']");
    if (!button || button.disabled) return;
    const gameId = button.dataset.wheelId;
    const input = document.querySelector(`.wheel-join-wager[data-wheel-game="${CSS.escape(gameId)}"]`);
    const wager = input ? Number(input.value) : 25;
    button.disabled = true;
    try {
      await window.api(`/games/wheel/${encodeURIComponent(gameId)}/join`, { userId: window.currentUserId, wager });
    } catch {
    } finally {
      button.disabled = false;
    }
  });

  // Spin wheel
  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-wheel-action='spin']");
    if (!button || button.disabled) return;
    const gameId = button.dataset.wheelId;
    button.disabled = true;
    try {
      await window.api(`/games/wheel/${encodeURIComponent(gameId)}/spin`, { userId: window.currentUserId });
    } catch {
    } finally {
      button.disabled = false;
    }
  });

  // Dismiss result
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-wheel-action='dismiss']");
    if (!button) return;
    activeAnimation = null;
    if (window.exchangeState) window.renderers.bet(window.exchangeState);
  });
})();
