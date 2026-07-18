// OWNER: Seb — replace everything below freely, keep only the window.renderers registration.
(() => {
  let lastOnTable = null;
  let bumpTimer = null;

  function sparklineSvg(history, hot) {
    const values = Array.isArray(history) ? history.map((v) => Math.max(0, Number(v) || 0)) : [];
    if (!values.length) {
      return `<svg class="sparkline" viewBox="0 0 72 20" width="72" height="20" aria-hidden="true"><polyline fill="none" stroke-width="1.5" stroke="${hot ? "var(--vscode-errorForeground, #f14c4c)" : "#e8ff2b"}" points="0,10 72,10" /></svg>`;
    }
    const min = Math.min(...values);
    const max = Math.max(...values);
    const stroke = hot ? "var(--vscode-errorForeground, #f14c4c)" : "#e8ff2b";
    const points = values.map((value, index) => {
      const x = values.length === 1 ? 36 : (index / (values.length - 1)) * 72;
      const y = max === min ? 10 : 18 - ((value - min) / (max - min)) * 16;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(" ");
    return `<svg class="sparkline" viewBox="0 0 72 20" width="72" height="20" aria-hidden="true"><polyline fill="none" stroke-width="1.5" stroke="${stroke}" points="${points}" /></svg>`;
  }

  window.renderers.team = (state) => {
    const panel = document.getElementById("team");
    if (!panel) return;

    const onTable = state.suggestions.reduce((total, suggestion) => total + suggestion.projectedSavings, 0);
    const shouldBump = lastOnTable !== null && Math.abs(onTable - lastOnTable) > 0.005;

    panel.innerHTML = `
      <div class="savings${shouldBump ? " savings-bump" : ""}"><span class="currency">$</span>${onTable.toFixed(2)}<small>/wk estimated team savings on the table</small></div>
      <div class="savings-sub">Accept a move to clear it from the table</div>
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
          const pct = Math.round(user.predictedUsagePct * 100);
          const credits = Math.round(user.predictedUsagePct * user.weeklyQuota);
          const width = Math.min(100, Math.max(0, pct));
          const hot = pct > 85;
          return `<div class="usage-row">
            <div class="usage-label"><span>${window.escapeHtml(user.name)}</span><strong>~${credits}cr / ${user.weeklyQuota} (${pct}%)</strong></div>
            <div class="usage-viz">
              ${sparklineSvg(user.usageHistory, hot)}
              <div class="usage-track"><div class="usage-fill ${hot ? "hot" : ""}" style="width:${width}%"></div></div>
            </div>
          </div>`;
        }).join("")}
      </div>
      <button data-team-action="simulate-week" style="margin-top:18px">Run week simulation</button>`;

    if (shouldBump) {
      if (bumpTimer) clearTimeout(bumpTimer);
      bumpTimer = setTimeout(() => {
        const hero = panel.querySelector(".savings");
        if (hero) hero.classList.remove("savings-bump");
        bumpTimer = null;
      }, 450);
    }

    lastOnTable = onTable;
  };

  document.addEventListener("click", async (event) => {
    const accept = event.target.closest("[data-team-action='accept']");
    if (accept) {
      if (accept.disabled) return;
      accept.disabled = true;
      try {
        await window.api(`/suggestions/${encodeURIComponent(accept.dataset.suggestionId)}/accept`, {});
      } catch {
        // window.api already surfaced the server error.
      } finally {
        accept.disabled = false;
      }
      return;
    }

    const simulate = event.target.closest("[data-team-action='simulate-week']");
    if (!simulate || simulate.disabled) return;
    simulate.disabled = true;
    try {
      await window.api("/team/simulate-week", {});
    } catch {
      // window.api already surfaced the server error.
    } finally {
      simulate.disabled = false;
    }
  });
})();
