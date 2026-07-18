import * as vscode from "vscode";

const VIEW_ID = "computeExchange.view";

export function activate(context: vscode.ExtensionContext): void {
  const provider = new ComputeExchangeViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(VIEW_ID, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("computeExchange")) provider.refresh();
    }),
  );
}

export function deactivate(): void {}

class ComputeExchangeViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "media")],
    };
    view.webview.html = this.html(view.webview);
  }

  refresh(): void {
    if (this.view) this.view.webview.html = this.html(this.view.webview);
  }

  private html(webview: vscode.Webview): string {
    const configuration = vscode.workspace.getConfiguration("computeExchange");
    const serverUrl = normalizeServerUrl(configuration.get<string>("serverUrl", "http://localhost:4747"));
    const userId = configuration.get<string>("userId", "u3").trim() || "u3";
    const serverOrigin = new URL(serverUrl).origin;
    const wsOrigin = serverOrigin.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
    const nonce = nonceValue();
    const configJson = JSON.stringify({ serverUrl, userId }).replace(/</g, "\\u003c");
    const media = (name: string) => webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media", name));

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src ${serverOrigin} ${wsOrigin};">
  <link rel="stylesheet" href="${media("styles.css")}">
  <title>Compute Exchange</title>
</head>
<body>
  <header class="app-header">
    <div>
      <div class="eyebrow">INTERNAL AI BUDGET</div>
      <h1>Compute Exchange</h1>
    </div>
    <span id="connection" class="connection">connecting</span>
  </header>
  <p class="framing">Simulated allocation units only—no vendor credits, credentials, money, or cash-out.</p>
  <nav class="tabs" aria-label="Exchange sections">
    <button class="tab active" data-tab="market">Market</button>
    <button class="tab" data-tab="team">Team</button>
    <button class="tab" data-tab="bet">Degen</button>
  </nav>
  <main>
    <section id="market" class="tab-panel active" aria-label="Market"></section>
    <section id="team" class="tab-panel" aria-label="Team"></section>
    <section id="bet" class="tab-panel" aria-label="Degen"></section>
  </main>
  <div id="toasts" class="toasts" aria-live="polite"></div>
  <script nonce="${nonce}">window.computeExchangeConfig = ${configJson};</script>
  <script nonce="${nonce}" src="${media("app.js")}"></script>
  <script nonce="${nonce}" src="${media("market.js")}"></script>
  <script nonce="${nonce}" src="${media("team.js")}"></script>
  <script nonce="${nonce}" src="${media("bet.js")}"></script>
</body>
</html>`;
  }
}

function normalizeServerUrl(value: string): string {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "http://localhost:4747";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return "http://localhost:4747";
  }
}

function nonceValue(): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let value = "";
  for (let index = 0; index < 32; index += 1) {
    value += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return value;
}
