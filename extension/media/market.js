// OWNER: Liam — replace everything below freely, keep only the window.renderers registration.
(() => {
  window.renderers.market = (state) => {
    const panel = document.getElementById("market");
    if (!panel) return;
    const me = window.userById(state, window.currentUserId);
    const openListings = state.listings
      .filter((listing) => listing.status === "open")
      .sort((left, right) => left.pricePerCredit - right.pricePerCredit);

    panel.innerHTML = `
      <div class="section-heading">
        <div><div class="eyebrow">INTERNAL ORDER BOOK</div><h2>Surplus allocations</h2></div>
        <button class="primary" data-market-action="list" ${me ? "" : "disabled"}>List my surplus</button>
      </div>
      <p class="muted">Modeled chargeback rates only. Your balance: <strong>${me ? `${me.balance}cr` : "unknown user"}</strong></p>
      <div class="card-list">
        ${openListings.length ? openListings.map((listing) => {
          const seller = window.userById(state, listing.sellerId);
          const discount = Math.round((1 - listing.pricePerCredit) * 100);
          const isMine = listing.sellerId === window.currentUserId;
          return `<article class="card listing">
            <div>
              <div class="card-title">${listing.amount}cr <span class="badge">${discount}% off</span></div>
              <div class="muted">${window.escapeHtml(seller?.name || "Unknown")} · ${listing.pricePerCredit.toFixed(2)}x internal rate</div>
            </div>
            ${isMine
              ? '<span class="mine">your listing</span>'
              : `<button data-market-action="buy" data-listing-id="${window.escapeHtml(listing.id)}">Buy</button>`}
          </article>`;
        }).join("") : '<div class="empty">No open listings yet.</div>'}
      </div>`;
  };

  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-market-action]");
    if (!button || button.disabled) return;
    button.disabled = true;
    try {
      if (button.dataset.marketAction === "buy") {
        await window.api("/trades", { listingId: button.dataset.listingId, buyerId: window.currentUserId });
      }
      if (button.dataset.marketAction === "list") {
        const suggestion = await window.api(`/price-suggestion/${encodeURIComponent(window.currentUserId)}`);
        if (suggestion.amount < 1) {
          window.toast("No forecast surplus is available to list", "error");
          return;
        }
        await window.api("/listings", {
          sellerId: window.currentUserId,
          amount: suggestion.amount,
          pricePerCredit: suggestion.pricePerCredit,
        });
      }
    } catch {
      // window.api already surfaced the server error.
    } finally {
      button.disabled = false;
    }
  });
})();
