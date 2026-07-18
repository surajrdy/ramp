(() => {
  const config = window.computeExchangeConfig;
  const runtime = { state: null, reconnectTimer: null };
  window.renderers = {};
  window.currentUserId = config.userId;

  window.escapeHtml = (value) => String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  window.userById = (state, id) => state.users.find((user) => user.id === id);

  window.toast = (text, kind = "event") => {
    const host = document.getElementById("toasts");
    if (!host) return;
    const item = document.createElement("div");
    item.className = `toast ${kind}`;
    item.textContent = text;
    host.append(item);
    window.setTimeout(() => item.remove(), 4500);
  };

  window.api = async (path, body) => {
    const url = new URL(path.replace(/^\//, ""), `${config.serverUrl}/`);
    try {
      const response = await fetch(url, {
        method: body === undefined ? "GET" : "POST",
        headers: body === undefined ? undefined : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
      return payload;
    } catch (error) {
      window.toast(error instanceof Error ? error.message : "Request failed", "error");
      throw error;
    }
  };

  function renderAll() {
    if (!runtime.state) return;
    for (const renderer of Object.values(window.renderers)) {
      try {
        renderer(runtime.state);
      } catch (error) {
        console.error(error);
        window.toast("A tab failed to render", "error");
      }
    }
  }

  function connectionStatus(text, connected) {
    const indicator = document.getElementById("connection");
    if (!indicator) return;
    indicator.textContent = text;
    indicator.classList.toggle("online", connected);
  }

  function connect() {
    window.clearTimeout(runtime.reconnectTimer);
    const wsUrl = new URL(config.serverUrl);
    wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
    connectionStatus("connecting", false);
    const socket = new WebSocket(wsUrl);
    socket.addEventListener("open", () => connectionStatus("live", true));
    socket.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === "event") window.toast(message.text);
        if (message.type === "state") {
          runtime.state = message.state;
          window.exchangeState = message.state;
          renderAll();
        }
      } catch (error) {
        console.error(error);
        window.toast("Received an invalid server message", "error");
      }
    });
    socket.addEventListener("close", () => {
      connectionStatus("reconnecting", false);
      runtime.reconnectTimer = window.setTimeout(connect, 1200);
    });
    socket.addEventListener("error", () => socket.close());
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelector(".tabs")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-tab]");
      if (!button) return;
      const selected = button.dataset.tab;
      document.querySelectorAll("[data-tab]").forEach((candidate) => candidate.classList.toggle("active", candidate === button));
      document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.toggle("active", panel.id === selected));
    });
    connect();
  });
})();
