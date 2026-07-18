// OWNER: Suraj — additive presentation variant over the existing virtual coinflip contract.
(() => {
  const baseRenderer = window.renderers.bet;
  const view = {
    lane: "left",
    stake: "20",
    opponentId: "",
    pending: false,
    animatedBetId: "",
    revealedBetId: "",
    revealTimer: null,
  };

  const relevantResult = (state) => [...state.bets].reverse().find((bet) => (
    bet.status === "settled"
    && Boolean(bet.opponentId)
    && (bet.challengerId === window.currentUserId || bet.opponentId === window.currentUserId)
  ));

  function raceState(result) {
    if (!result) return "waiting";
    if (view.revealedBetId === result.id) return "finished";
    if (view.animatedBetId !== result.id) {
      view.animatedBetId = result.id;
      clearTimeout(view.revealTimer);
      view.revealTimer = setTimeout(() => {
        view.revealedBetId = result.id;
        if (window.exchangeState) window.renderers.bet(window.exchangeState);
      }, 2900);
    }
    return "running";
  }

  function crossyBoard(state, activeBet, result, me, selectedOpponent) {
    const challenger = activeBet ? window.userById(state, activeBet.challengerId) : me;
    const opponent = activeBet?.opponentId ? window.userById(state, activeBet.opponentId) : selectedOpponent;
    const boardState = raceState(result);
    const challengerWon = Boolean(result && result.winnerId === challenger?.id);
    const opponentWon = Boolean(result && result.winnerId === opponent?.id);
    const winner = result ? window.userById(state, result.winnerId) : null;
    const loser = result ? (challengerWon ? opponent : challenger) : null;
    const stake = activeBet?.stake || Number(view.stake) || 0;
    const label = result
      ? `${winner?.name || "A player"} won the two-player crossing race`
      : activeBet
        ? `${challenger?.name || "One player"} is waiting to race ${opponent?.name || "an opponent"}`
        : `${me?.name || "Player one"} versus ${selectedOpponent?.name || "player two"} Crossy-style preview`;

    return `<div class="crossy-board ${boardState}" role="img" aria-label="${window.escapeHtml(label)}">
      <div class="crossy-finish"><span>FINISH</span></div>
      <div class="crossy-road" aria-hidden="true">
        <div class="crossy-lane lane-three"><span class="crossy-car car-a">🚕</span><span class="crossy-car car-b">🚙</span></div>
        <div class="crossy-lane lane-two"><span class="crossy-car car-b">🚗</span><span class="crossy-car car-c">🛻</span></div>
        <div class="crossy-lane lane-one"><span class="crossy-car car-c">🚓</span><span class="crossy-car car-a">🚐</span></div>
      </div>
      <div class="crossy-player player-one ${challengerWon ? "winner" : result ? "loser" : ""}">
        <span class="crossy-avatar">🐸</span><span class="crossy-name">${window.escapeHtml(challenger?.name || "Player 1")}</span>
      </div>
      <div class="crossy-player player-two ${opponentWon ? "winner" : result ? "loser" : ""}">
        <span class="crossy-avatar">🐔</span><span class="crossy-name">${window.escapeHtml(opponent?.name || "Player 2")}</span>
      </div>
      <div class="crossy-result-reveal" aria-live="polite">
        ${result ? `<strong>${window.escapeHtml(winner?.name || "A teammate")} crossed first · ${stake * 2} virtual credits</strong><span>${window.escapeHtml(loser?.name || "The other player")} got flattened by the Ohio commute.</span>` : activeBet ? `<strong>Waiting at the curb</strong><span>${window.escapeHtml(opponent?.name || "The opponent")} must accept to start both players.</span>` : `<strong>Two players. Three traffic lanes. One surviving aura.</strong><span>Send the 1v1 to put both teammates on the road.</span>`}
      </div>
    </div>`;
  }

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
    const activeBet = open[0] || null;
    const result = activeBet ? null : relevantResult(state);
    const selectedOpponent = window.userById(state, view.opponentId);

    panel.insertAdjacentHTML("beforeend", `
      <section class="crossroad stack" aria-labelledby="crossroad-title">
        <div class="section-heading">
          <div><div class="eyebrow">1V1 BRAINROT · VIRTUAL ONLY</div><h2 id="crossroad-title">Ohio Crossroads</h2></div>
          <span class="chip">50 / 50</span>
        </div>
        <p class="muted">Pick a simulated teammate and run the 1v1 instantly. Both virtual stakes are escrowed; the server-selected 50/50 winner reaches safety first.</p>
        ${crossyBoard(state, activeBet || result, result, me, selectedOpponent)}
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
          <button class="primary full-width" type="submit" ${!me || view.pending || open.some((bet) => bet.challengerId === window.currentUserId) ? "disabled" : ""}>${view.pending ? "Crossing…" : "Simulate 1v1 now"}</button>
          <span class="crossroad-guardrail">Lane choice is cosmetic · no cash value · no redemption</span>
        </form>

        ${incoming.length ? `<div class="crossroad-incoming stack"><strong>You got called to the crossroads</strong>${incoming.map((bet) => {
          const challenger = window.userById(state, bet.challengerId);
          return `<button class="secondary full-width" data-crossroad-action="accept" data-bet-id="${window.escapeHtml(bet.id)}" ${view.pending ? "disabled" : ""}>Face ${window.escapeHtml(challenger?.name || "a teammate")} for ${bet.stake} credits</button>`;
        }).join("")}</div>` : ""}

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
      const bet = await window.api("/bets", {
        challengerId: window.currentUserId,
        opponentId: view.opponentId,
        stake: Number(view.stake),
      });
      await window.api(`/bets/${encodeURIComponent(bet.id)}/accept`, { userId: view.opponentId });
      window.toast(`Simulated 1v1 started on the ${view.lane === "left" ? "aura" : "skibidi"} road`);
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
