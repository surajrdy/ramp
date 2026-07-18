// OWNER: Suraj — additive presentation variant over the existing virtual coinflip contract.
(() => {
  const baseRenderer = window.renderers.bet;
  const view = { lane: "left", stake: "20", opponentId: "", pending: false };

  const relevantResult = (state) => [...state.bets].reverse().find((bet) => (
    bet.status === "settled"
    && Boolean(bet.opponentId)
    && (bet.challengerId === window.currentUserId || bet.opponentId === window.currentUserId)
  ));

  window.renderers.bet = (state) => {
    if (typeof baseRenderer === "function") baseRenderer(state);
    const panel = document.getElementById("bet");
    if (!panel) return;

    const me = window.userById(state, window.currentUserId);
    const opponents = state.users.filter((user) => user.id !== window.currentUserId);
    if (!opponents.some((user) => user.id === view.opponentId)) view.opponentId = opponents[0]?.id || "";
    const open = state.bets.filter((bet) => bet.status === "open" && Boolean(bet.opponentId) && (
      bet.challengerId === window.currentUserId || bet.opponentId === window.currentUserId
    ));
    const incoming = open.filter((bet) => bet.opponentId === window.currentUserId);
    const result = relevantResult(state);
    const winner = result ? window.userById(state, result.winnerId) : null;
    const loserId = result ? (result.winnerId === result.challengerId ? result.opponentId : result.challengerId) : null;
    const loser = loserId ? window.userById(state, loserId) : null;

    panel.insertAdjacentHTML("beforeend", `
      <section class="crossroad stack" aria-labelledby="crossroad-title">
        <div class="section-heading">
          <div><div class="eyebrow">1V1 BRAINROT · VIRTUAL ONLY</div><h2 id="crossroad-title">Ohio Crossroads</h2></div>
          <span class="chip">50 / 50</span>
        </div>
        <p class="muted">Call out one teammate. Pick a cursed road for flavor; the server still settles a fair virtual coinflip with escrow.</p>
        <form id="crossroad-form" class="crossroad-form">
          <label class="field" for="crossroad-opponent"><span>Who gets fanum-taxed?</span>
            <select id="crossroad-opponent" name="opponentId" ${me ? "" : "disabled"}>
              ${opponents.map((user) => `<option value="${window.escapeHtml(user.id)}" ${user.id === view.opponentId ? "selected" : ""}>${window.escapeHtml(user.name)}</option>`).join("")}
            </select>
          </label>
          <label class="field" for="crossroad-stake"><span>Virtual stake</span><input id="crossroad-stake" name="stake" type="number" min="1" step="1" value="${window.escapeHtml(view.stake)}"></label>
          <div class="crossroad-lanes" role="group" aria-label="Choose a cosmetic road">
            <button type="button" class="lane ${view.lane === "left" ? "active" : ""}" data-crossroad-action="lane" data-lane="left">← Aura road</button>
            <button type="button" class="lane ${view.lane === "right" ? "active" : ""}" data-crossroad-action="lane" data-lane="right">Skibidi road →</button>
          </div>
          <button class="primary full-width" type="submit" ${!me || view.pending || open.some((bet) => bet.challengerId === window.currentUserId) ? "disabled" : ""}>${view.pending ? "Entering Ohio…" : "Send cursed 1v1"}</button>
          <span class="crossroad-guardrail">Lane choice is cosmetic · no cash value · no redemption</span>
        </form>

        ${incoming.length ? `<div class="crossroad-incoming stack"><strong>You got called to the crossroads</strong>${incoming.map((bet) => {
          const challenger = window.userById(state, bet.challengerId);
          return `<button class="secondary full-width" data-crossroad-action="accept" data-bet-id="${window.escapeHtml(bet.id)}" ${view.pending ? "disabled" : ""}>Face ${window.escapeHtml(challenger?.name || "a teammate")} for ${bet.stake} credits</button>`;
        }).join("")}</div>` : ""}

        ${result ? `<article class="crossroad-result">
          <span class="crossroad-emoji">${result.winnerId === window.currentUserId ? "🧠👑" : "🚧💀"}</span>
          <div><strong>${window.escapeHtml(winner?.name || "A teammate")} escaped with ${result.stake * 2} virtual credits</strong><span>${window.escapeHtml(loser?.name || "The loser")} got negative aura at the function.</span></div>
        </article>` : ""}
      </section>`);
  };

  document.addEventListener("input", (event) => {
    if (event.target.id === "crossroad-stake") view.stake = event.target.value;
  });

  document.addEventListener("change", (event) => {
    if (event.target.id === "crossroad-opponent") view.opponentId = event.target.value;
  });

  document.addEventListener("submit", async (event) => {
    if (event.target.id !== "crossroad-form") return;
    event.preventDefault();
    view.pending = true;
    try {
      await window.api("/bets", {
        challengerId: window.currentUserId,
        opponentId: view.opponentId,
        stake: Number(view.stake),
      });
      window.toast(`Crossroad challenge sent via the ${view.lane === "left" ? "aura" : "skibidi"} road`);
    } catch {
      // window.api already surfaced the server error.
    } finally {
      view.pending = false;
      if (window.exchangeState) window.renderers.bet(window.exchangeState);
    }
  });

  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-crossroad-action]");
    if (!button || button.disabled) return;
    if (button.dataset.crossroadAction === "lane") {
      view.lane = button.dataset.lane === "right" ? "right" : "left";
      if (window.exchangeState) window.renderers.bet(window.exchangeState);
      return;
    }
    if (button.dataset.crossroadAction !== "accept" || !button.dataset.betId) return;
    view.pending = true;
    button.disabled = true;
    try {
      await window.api(`/bets/${encodeURIComponent(button.dataset.betId)}/accept`, { userId: window.currentUserId });
    } catch {
      // window.api already surfaced the server error.
    } finally {
      view.pending = false;
    }
  });
})();
