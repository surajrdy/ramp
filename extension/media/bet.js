// OWNER: D + Liam — Games hub with sub-navigation. Keep window.renderers.bet registration intact.
(() => {
  let selectedGame = "coinflip";
  window.gameRenderers = window.gameRenderers || {};

  // ===== COINFLIP (original game) =====
  window.gameRenderers.coinflip = (state, container) => {
    const me = window.userById(state, window.currentUserId);
    const openBets = state.bets.filter((bet) => bet.status === "open");
    const results = state.bets.filter((bet) => bet.status === "settled").slice(-5).reverse();

    container.innerHTML = `
      <form id="coinflip-form" class="coinflip-form">
        <label for="stake">Stake</label>
        <div class="form-row"><input id="stake" name="stake" type="number" min="1" step="1" value="25"><button class="primary" ${me ? "" : "disabled"}>Open coinflip challenge</button></div>
        <div class="muted">Your spendable balance: ${me ? `${me.balance}cr` : "unknown user"}</div>
      </form>
      <div class="section-heading"><div><div class="eyebrow">OPEN</div><h2>Challenges</h2></div></div>
      <div class="card-list">
        ${openBets.length ? openBets.map((bet) => {
          const challenger = window.userById(state, bet.challengerId);
          const opponent = bet.opponentId ? window.userById(state, bet.opponentId) : null;
          const canAccept = bet.challengerId !== window.currentUserId && (!bet.opponentId || bet.opponentId === window.currentUserId);
          return `<article class="card listing">
            <div><div class="card-title">${window.escapeHtml(challenger?.name || "Unknown")} · ${bet.stake}cr</div>
            <div class="muted">${opponent ? `Called out ${window.escapeHtml(opponent.name)}` : "Open to the team"}</div></div>
            ${canAccept ? `<button data-bet-action="accept" data-bet-id="${window.escapeHtml(bet.id)}">Accept</button>` : '<span class="mine">waiting</span>'}
          </article>`;
        }).join("") : '<div class="empty">No open challenges. Start one.</div>'}
      </div>
      <div class="section-heading"><div><div class="eyebrow">RECENT</div><h2>Results</h2></div></div>
      <div class="card-list">
        ${results.length ? results.map((bet) => {
          const winner = window.userById(state, bet.winnerId);
          return `<article class="card"><strong>${window.escapeHtml(winner?.name || "Unknown")} won ${bet.stake * 2}cr</strong><span class="muted">virtual coinflip</span></article>`;
        }).join("") : '<div class="empty">No settled flips yet.</div>'}
      </div>`;
  };

  // ===== MAIN RENDERER =====
  window.renderers.bet = (state) => {
    const panel = document.getElementById("bet");
    if (!panel) return;

    const gameButtons = [
      { id: "coinflip", label: "Coinflip" },
      { id: "wheel", label: "Wheel Spin" },
      { id: "balloon", label: "Balloon" },
    ];

    // Build sub-nav + content container
    const navHtml = `<nav class="game-selector" aria-label="Game selection">
      ${gameButtons.map((g) => `<button class="game-tab${selectedGame === g.id ? " active" : ""}" data-game="${g.id}" ${g.disabled ? "disabled" : ""}>${g.label}</button>`).join("")}
    </nav>`;

    // Only rebuild if sub-nav is missing (first render or tab switch)
    if (!panel.querySelector(".game-selector")) {
      panel.innerHTML = `${navHtml}<div id="game-content"></div>`;
    } else {
      // Update active state on existing nav buttons
      panel.querySelectorAll("[data-game]").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.game === selectedGame);
      });
    }

    const content = panel.querySelector("#game-content");
    if (!content) return;

    const renderer = window.gameRenderers[selectedGame];
    if (renderer) {
      renderer(state, content);
    } else {
      content.innerHTML = '<div class="empty">Coming soon...</div>';
    }
  };

  // ===== EVENT HANDLERS =====

  // Game selector clicks
  document.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-game]");
    if (!btn || btn.disabled) return;
    const game = btn.dataset.game;
    if (game === selectedGame) return;
    selectedGame = game;
    // Force full re-render by clearing the nav so it rebuilds
    const panel = document.getElementById("bet");
    if (panel) {
      const nav = panel.querySelector(".game-selector");
      if (nav) nav.remove();
    }
    if (window.exchangeState) window.renderers.bet(window.exchangeState);
  });

  // Coinflip form submit
  document.addEventListener("submit", async (event) => {
    if (event.target.id !== "coinflip-form") return;
    event.preventDefault();
    const button = event.target.querySelector("button");
    const stake = Number(new FormData(event.target).get("stake"));
    button.disabled = true;
    try {
      await window.api("/bets", { challengerId: window.currentUserId, stake });
    } catch {
      // window.api already surfaced the server error.
    } finally {
      button.disabled = false;
    }
  });

  // Coinflip accept
  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-bet-action='accept']");
    if (!button || button.disabled) return;
    button.disabled = true;
    try {
      await window.api(`/bets/${encodeURIComponent(button.dataset.betId)}/accept`, { userId: window.currentUserId });
    } catch {
      // window.api already surfaced the server error.
    } finally {
      button.disabled = false;
    }
  });
})();
