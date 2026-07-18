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
  const forecastCredits = (user) => Math.round(user.weeklyQuota * user.predictedUsagePct);
  const discount = (price) => Math.max(0, Math.round((1 - Number(price || 0)) * 100));
  const outlook = (user) => {
    if (user.predictedUsagePct < 0.6) return "You are likely to have credits left to share.";
    if (user.predictedUsagePct > 0.85) return "You may need more credits for this week’s workload.";
    return "Your available credits and expected usage look balanced.";
  };
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
    const amount = Number(draft.amount);
    return `<form id="market-listing-form" class="sheet stack" aria-labelledby="listing-sheet-title">
      <div class="card-row sheet-heading">
        <div>
          <div class="eyebrow">SHARE UNUSED BUDGET</div>
          <h2 id="listing-sheet-title">Offer credits to your team</h2>
        </div>
        <button class="ghost compact" type="button" data-market-action="close-sheet" aria-label="Close listing form">Close</button>
      </div>
      ${view.loadingSuggestion
        ? '<div class="empty compact-empty" role="status">Checking how many credits you are likely to need…</div>'
        : `<p class="muted">Publishing sets these credits aside for teammates. Withdraw the offer anytime before someone claims it.</p>
          <div class="field-grid">
            <label class="field" for="listing-amount"><span>Credits to share</span><input id="listing-amount" name="amount" type="number" min="1" step="1" inputmode="numeric" value="${window.escapeHtml(draft.amount)}" required></label>
            <label class="field" for="listing-price"><span>Team rate per credit</span><input id="listing-price" name="pricePerCredit" type="number" min="0.01" max="1" step="0.01" inputmode="decimal" value="${window.escapeHtml(draft.pricePerCredit)}" required></label>
          </div>
          <p class="hint">1.00 is the standard team rate. A lower rate gives the teammate receiving your credits a discount.</p>
          ${suggested ? `<p class="hint">Based on your usage outlook: share ${suggested.amount} credits with a ${discount(suggested.pricePerCredit)}% discount.</p>` : ""}
          <button class="primary full-width" type="submit" ${submitting || !me || amount < 1 ? "disabled" : ""}>${submitting ? "Publishing offer…" : amount > 0 ? `Offer ${amount} credits` : "Publish offer"}</button>`}
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
    const expectedUse = me ? forecastCredits(me) : 0;

    panel.innerHTML = `
      <section class="hero market-hero" aria-labelledby="allocation-title">
        <div class="hero-kicker" id="allocation-title">${me ? `${window.escapeHtml(me.name)}’s AI budget` : "Unknown configured user"}</div>
        <div class="hero-value">${me ? me.balance : "—"}<span> credits available</span></div>
        <div class="metric-row">
          <div class="metric"><span>Expected use this week</span><strong>${me ? `${expectedUse} credits` : "—"}</strong></div>
          <div class="metric"><span>Weekly plan</span><strong>${me ? `${me.weeklyQuota} credits` : "—"}</strong></div>
        </div>
        ${me ? `<p class="muted">${outlook(me)}</p>` : ""}
      </section>

      <section class="card workload-card stack" aria-labelledby="workload-title">
        <div class="card-row">
          <div><div class="eyebrow">LIVE DEMO</div><h2 id="workload-title">See a workload change your plan</h2></div>
          <span class="chip">300-credit job</span>
        </div>
        <p class="muted">Simulate a heavy AI job on the backend. Your expected need and team recommendations update live; your available balance stays untouched.</p>
        <button class="primary full-width" data-market-action="burst" ${!me || view.pending.has("burst") ? "disabled" : ""}>${view.pending.has("burst") ? "Running workload…" : "Simulate heavy AI workload"}</button>
      </section>

      ${showTeamHandoff ? `<aside class="handoff card-row" role="status">
        <div><strong>Your usage outlook changed</strong><span>You now expect to need about ${expectedUse} credits. Team has a recommended move.</span></div>
        <button class="secondary" data-nav-tab="team">Review recommendation</button>
      </aside>` : ""}

      <section class="stack market-section" aria-labelledby="order-book-title">
        <div class="section-heading">
          <div><div class="eyebrow">TEAM EXCHANGE</div><h2 id="order-book-title">Credits your team can share</h2></div>
          <span class="count-chip">${openListings.length} ${openListings.length === 1 ? "offer" : "offers"}</span>
        </div>
        <button class="secondary full-width" data-market-action="open-sheet" ${me ? "" : "disabled"}>Share my unused credits</button>
        ${listingSheet(me)}
        <div class="card-list allocations">
          ${openListings.length ? openListings.map((listing) => {
            const seller = window.userById(state, listing.sellerId);
            const listingDiscount = discount(listing.pricePerCredit);
            const isMine = listing.sellerId === window.currentUserId;
            const pendingKey = `${isMine ? "cancel" : "buy"}:${listing.id}`;
            return `<article class="card allocation-card">
              <div class="card-row allocation-topline">
                <div><div class="allocation-amount">${listing.amount}<span> credits</span></div><div class="rate-line">Ready to move now</div></div>
                <span class="badge">${listingDiscount}% team discount</span>
              </div>
              <div class="seller-context">
                <span>From ${window.escapeHtml(seller?.name || "a teammate")}</span>
                <span>${seller ? `expects to use ${percent(seller.predictedUsagePct)} of their weekly plan` : "usage outlook unavailable"}</span>
                <span>${when(listing.createdAt)}</span>
              </div>
              ${isMine
                ? `<button class="ghost full-width" data-market-action="cancel" data-listing-id="${window.escapeHtml(listing.id)}" ${view.pending.has(pendingKey) ? "disabled" : ""}>${view.pending.has(pendingKey) ? "Withdrawing offer…" : "Withdraw offer and return credits"}</button>`
                : `<button class="primary full-width" data-market-action="buy" data-listing-id="${window.escapeHtml(listing.id)}" ${!me || view.pending.has(pendingKey) ? "disabled" : ""}>${view.pending.has(pendingKey) ? "Moving credits…" : `Add ${listing.amount} credits to my budget`}</button>`}
            </article>`;
          }).join("") : '<div class="empty">No shared credits right now. Offer unused credits to start the exchange.</div>'}
        </div>
      </section>

      <section class="stack market-section" aria-labelledby="recent-trades-title">
        <div class="section-heading"><div><div class="eyebrow">RECENT ACTIVITY</div><h2 id="recent-trades-title">Credits moved</h2></div></div>
        <div class="trade-list">
          ${recentTrades.length ? recentTrades.map((trade) => {
            const buyer = window.userById(state, trade.buyerId);
            const seller = window.userById(state, trade.sellerId);
            const tradeDiscount = discount(trade.amount ? trade.total / trade.amount : 0);
            return `<article class="trade-row">
              <div><strong>${window.escapeHtml(seller?.name || "A teammate")} shared with ${window.escapeHtml(buyer?.name || "a teammate")}</strong><span>${trade.amount} credits · ${tradeDiscount}% team discount</span></div>
              <time datetime="${window.escapeHtml(trade.ts)}">${when(trade.ts)}</time>
            </article>`;
          }).join("") : '<div class="empty compact-empty">Team credit moves will appear here.</div>'}
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
