// OWNER: Seb — replace everything below freely, keep only the window.renderers registration.
(() => {
  window.renderers.team = (state) => {
    const panel = document.getElementById("team");
    if (!panel) return;
    const savings = state.suggestions.reduce((total, suggestion) => total + suggestion.projectedSavings, 0);

    panel.innerHTML = `
      <div class="savings"><span class="currency">$</span>${savings.toFixed(2)}<small>/wk estimated team savings on the table</small></div>
      <div class="section-heading"><div><div class="eyebrow">GREEDY MATCHES</div><h2>Recommended moves</h2></div></div>
      <div class="card-list suggestions">
        ${state.suggestions.length ? state.suggestions.map((suggestion) => {
          const from = window.userById(state, suggestion.fromUserId);
          const to = window.userById(state, suggestion.toUserId);
          return `<article class="card suggestion">
            <div class="card-title">${window.escapeHtml(from?.name || "Unknown")} → ${window.escapeHtml(to?.name || "Unknown")}</div>
            <div><strong>${suggestion.amount}cr</strong> saves an estimated <strong>$${suggestion.projectedSavings.toFixed(2)}/wk</strong></div>
            <div class="muted">${window.escapeHtml(suggestion.reason)}</div>
            <button class="primary" data-team-action="accept" data-suggestion-id="${window.escapeHtml(suggestion.id)}">Accept move</button>
          </article>`;
        }).join("") : '<div class="empty">The team is balanced right now.</div>'}
      </div>
      <div class="section-heading usage-heading"><div><div class="eyebrow">FORECAST</div><h2>Predicted weekly usage</h2></div></div>
      <div class="usage-list">
        ${state.users.map((user) => {
          const percent = Math.round(user.predictedUsagePct * 100);
          const width = Math.min(100, Math.max(0, percent));
          return `<div class="usage-row">
            <div class="usage-label"><span>${window.escapeHtml(user.name)}</span><strong>${percent}%</strong></div>
            <div class="usage-track"><div class="usage-fill ${percent > 85 ? "hot" : ""}" style="width:${width}%"></div></div>
          </div>`;
        }).join("")}
      </div>`;
  };

  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-team-action='accept']");
    if (!button || button.disabled) return;
    button.disabled = true;
    try {
      await window.api(`/suggestions/${encodeURIComponent(button.dataset.suggestionId)}/accept`, {});
    } catch {
      // window.api already surfaced the server error.
    } finally {
      button.disabled = false;
    }
  });
})();
