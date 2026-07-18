// OWNER: Suraj — replace everything below freely, keep only the window.renderers registration.
(() => {
  const view = {
    burstComplete: false,
    sheetOpen: false,
    loadingSuggestion: false,
    suggestion: null,
    draft: null,
    pending: new Set(),
  };

  const percent = (value) => `${Math.round(Math.max(0, value || 0) * 100)}%`;
  const rate = (value) => Number(value || 0).toFixed(2);
  const when = (value) => {
    const timestamp = new Date(value).getTime();
    if (!Number.isFinite(timestamp)) return "recently";
    const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
    if (minutes < 1) return "just now";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  function renderCurrent() {
    if (window.exchangeState) window.renderers.market(window.exchangeState);
  }

  function listingSheet(me) {
    if (!view.sheetOpen) return "";
    const suggested = view.suggestion;
    const draft = view.draft || { amount: "", pricePerCredit: "" };
    const submitting = view.pending.has("list");
    return `<form id="market-listing-form" class="sheet stack" aria-labelledby="listing-sheet-title">
      <div class="card-row sheet-heading">
        <div>
          <div class="eyebrow">LIST SURPLUS</div>
          <h2 id="listing-sheet-title">Offer internal allocation</h2>
        </div>
        <button class="ghost compact" type="button" data-market-action="close-sheet" aria-label="Close listing form">Close</button>
      </div>
      ${view.loadingSuggestion
        ? '<div class="empty compact-empty" role="status">Calculating a forecast-aware price…</div>'
        : `<p class="muted">Edit the server suggestion before listing. Credits move into escrow until bought or cancelled.</p>
          <div class="field-grid">
            <label class="field" for="listing-amount"><span>Credits</span><input id="listing-amount" name="amount" type="number" min="1" step="1" inputmode="numeric" value="${window.escapeHtml(draft.amount)}" required></label>
            <label class="field" for="listing-price"><span>Internal rate</span><input id="listing-price" name="pricePerCredit" type="number" min="0.01" max="1" step="0.01" inputmode="decimal" value="${window.escapeHtml(draft.pricePerCredit)}" required></label>
          </div>
          ${suggested ? `<p class="hint">Suggested from your forecast: ${suggested.amount}cr at ${rate(suggested.pricePerCredit)}x.</p>` : ""}
          <button class="primary full-width" type="submit" ${submitting || !me || Number(draft.amount) < 1 ? "disabled" : ""}>${submitting ? "Listing…" : "Move to escrow & list"}</button>`}
    </form>`;
  }

  window.renderers.market = (state) => {
    const panel = document.getElementById("market");
    if (!panel) return;
    const me = window.userById(state, window.currentUserId);
    const openListings = state.listings
      .filter((listing) => listing.status === "open")
      .sort((left, right) => left.pricePerCredit - right.pricePerCredit || left.createdAt.localeCompare(right.createdAt));
    const recentTrades = [...state.trades]
      .sort((left, right) => new Date(right.ts).getTime() - new Date(left.ts).getTime())
      .slice(0, 5);
    const showTeamHandoff = Boolean(me && view.burstComplete && me.predictedUsagePct > 0.85);

    panel.innerHTML = `
      <section class="hero market-hero" aria-labelledby="allocation-title">
        <div class="hero-kicker" id="allocation-title">${me ? `${window.escapeHtml(me.name)} · available allocation` : "Unknown configured user"}</div>
        <div class="hero-value">${me ? me.balance : "—"}<span>cr</span></div>
        <div class="metric-row">
          <div class="metric"><span>Forecast</span><strong>${me ? percent(me.predictedUsagePct) : "—"}</strong></div>
          <div class="metric"><span>Weekly quota</span><strong>${me ? `${me.weeklyQuota}cr` : "—"}</strong></div>
        </div>
      </section>

      <section class="card workload-card stack" aria-labelledby="workload-title">
        <div class="card-row">
          <div><div class="eyebrow">LIVE BACKEND DEMO</div><h2 id="workload-title">Create real demand</h2></div>
          <span class="chip">+300cr</span>
        </div>
        <p class="muted">Records a simulated agent workload on the server. It changes the forecast and recommendations, but never mints or burns allocation.</p>
        <button class="primary full-width" data-market-action="burst" ${!me || view.pending.has("burst") ? "disabled" : ""}>${view.pending.has("burst") ? "Running workload…" : "Run 300cr agent burst"}</button>
      </section>

      ${showTeamHandoff ? `<aside class="handoff card-row" role="status">
        <div><strong>Forecast changed</strong><span>Open Team to apply the server’s allocation move.</span></div>
        <button class="secondary" data-nav-tab="team">Open Team</button>
      </aside>` : ""}

      <section class="stack market-section" aria-labelledby="order-book-title">
        <div class="section-heading">
          <div><div class="eyebrow">INTERNAL ORDER BOOK</div><h2 id="order-book-title">Available allocations</h2></div>
          <span class="count-chip">${openListings.length} open</span>
        </div>
        <button class="secondary full-width" data-market-action="open-sheet" ${me ? "" : "disabled"}>List surplus allocation</button>
        ${listingSheet(me)}
        <div class="card-list allocations">
          ${openListings.length ? openListings.map((listing) => {
            const seller = window.userById(state, listing.sellerId);
            const discount = Math.max(0, Math.round((1 - listing.pricePerCredit) * 100));
            const isMine = listing.sellerId === window.currentUserId;
            const pendingKey = `${isMine ? "cancel" : "buy"}:${listing.id}`;
            return `<article class="card allocation-card">
              <div class="card-row allocation-topline">
                <div><div class="allocation-amount">${listing.amount}<span>cr</span></div><div class="rate-line">${rate(listing.pricePerCredit)}x internal rate</div></div>
                <span class="badge">${discount}% below baseline</span>
              </div>
              <div class="seller-context">
                <span>${window.escapeHtml(seller?.name || "Unknown seller")}</span>
                <span>${seller ? `${percent(seller.predictedUsagePct)} forecast` : "Forecast unavailable"}</span>
                <span>${when(listing.createdAt)}</span>
              </div>
              ${isMine
                ? `<button class="ghost full-width" data-market-action="cancel" data-listing-id="${window.escapeHtml(listing.id)}" ${view.pending.has(pendingKey) ? "disabled" : ""}>${view.pending.has(pendingKey) ? "Cancelling…" : "Cancel & return escrow"}</button>`
                : `<button class="primary full-width" data-market-action="buy" data-listing-id="${window.escapeHtml(listing.id)}" ${!me || view.pending.has(pendingKey) ? "disabled" : ""}>${view.pending.has(pendingKey) ? "Reallocating…" : `Reallocate ${listing.amount}cr to me`}</button>`}
            </article>`;
          }).join("") : '<div class="empty">No open allocations. List forecast surplus to start the exchange.</div>'}
        </div>
      </section>

      <section class="stack market-section" aria-labelledby="recent-trades-title">
        <div class="section-heading"><div><div class="eyebrow">SERVER-SETTLED</div><h2 id="recent-trades-title">Recent reallocations</h2></div></div>
        <div class="trade-list">
          ${recentTrades.length ? recentTrades.map((trade) => {
            const buyer = window.userById(state, trade.buyerId);
            const seller = window.userById(state, trade.sellerId);
            return `<article class="trade-row">
              <div><strong>${window.escapeHtml(seller?.name || "Unknown")} → ${window.escapeHtml(buyer?.name || "Unknown")}</strong><span>${trade.amount}cr · ${rate(trade.amount ? trade.total / trade.amount : 0)}x rate</span></div>
              <time datetime="${window.escapeHtml(trade.ts)}">${when(trade.ts)}</time>
            </article>`;
          }).join("") : '<div class="empty compact-empty">Completed reallocations will appear here.</div>'}
        </div>
      </section>`;
  };

  async function runPending(key, action) {
    view.pending.add(key);
    renderCurrent();
    try {
      await action();
    } catch {
      // window.api already surfaced the server error.
    } finally {
      view.pending.delete(key);
      renderCurrent();
    }
  }

  async function openListingSheet() {
    view.sheetOpen = true;
    view.loadingSuggestion = true;
    view.suggestion = null;
    view.draft = null;
    renderCurrent();
    try {
      const suggestion = await window.api(`/price-suggestion/${encodeURIComponent(window.currentUserId)}`);
      view.suggestion = suggestion;
      view.draft = {
        amount: String(suggestion.amount),
        pricePerCredit: String(suggestion.pricePerCredit),
      };
      if (suggestion.amount < 1) window.toast("No forecast surplus is available to list", "error");
    } catch {
      // window.api already surfaced the server error.
    } finally {
      view.loadingSuggestion = false;
      renderCurrent();
    }
  }

  document.addEventListener("input", (event) => {
    if (!event.target.closest("#market-listing-form") || !view.draft) return;
    if (event.target.name === "amount") view.draft.amount = event.target.value;
    if (event.target.name === "pricePerCredit") view.draft.pricePerCredit = event.target.value;
  });

  document.addEventListener("submit", (event) => {
    if (event.target.id !== "market-listing-form") return;
    event.preventDefault();
    const form = event.target;
    const data = new FormData(form);
    const amount = Number(data.get("amount"));
    const pricePerCredit = Number(data.get("pricePerCredit"));
    runPending("list", async () => {
      await window.api("/listings", { sellerId: window.currentUserId, amount, pricePerCredit });
      view.sheetOpen = false;
      view.suggestion = null;
      view.draft = null;
    });
  });

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-market-action]");
    if (!button || button.disabled) return;
    const action = button.dataset.marketAction;
    const listingId = button.dataset.listingId;
    if (action === "open-sheet") openListingSheet();
    if (action === "close-sheet") {
      view.sheetOpen = false;
      renderCurrent();
    }
    if (action === "burst") runPending("burst", async () => {
      await window.api("/usage/simulate", { userId: window.currentUserId, credits: 300 });
      view.burstComplete = true;
    });
    if (action === "buy" && listingId) runPending(`buy:${listingId}`, () => (
      window.api("/trades", { listingId, buyerId: window.currentUserId })
    ));
    if (action === "cancel" && listingId) runPending(`cancel:${listingId}`, () => (
      window.api(`/listings/${encodeURIComponent(listingId)}/cancel`, { sellerId: window.currentUserId })
    ));
  });
})();
