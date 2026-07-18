// OWNER: D — replace everything below freely, keep only the window.renderers registration.
(() => {
  window.renderers.bet = (state) => {
    const panel = document.getElementById("bet");
    if (!panel) return;
    const me = window.userById(state, window.currentUserId);
    const openBets = state.bets.filter((bet) => bet.status === "open");
    const results = state.bets.filter((bet) => bet.status === "settled").slice(-5).reverse();

    panel.innerHTML = `
      <div class="section-heading"><div><div class="eyebrow">VIRTUAL ONLY</div><h2>Coinflip chaos</h2></div></div>
      <p class="muted">No cash value, redemption, or effect outside this simulated team ledger.</p>
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
