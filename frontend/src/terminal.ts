import { Terminal } from "xterm";
import "./styles/globals.css";
import "./terminal.css";
import "xterm/css/xterm.css";
const styles = getComputedStyle(document.documentElement);
const token = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
const terminal = new Terminal({
  cols: 100,
  rows: 30,
  cursorBlink: true,
  theme: {
    background: "#0d1420",
    foreground: "#e7edf9",
    cursor: token("--primary", "#2e5496"),
    selectionBackground: "#29466f",
    black: "#0d1420",
    brightBlack: "#8090a8",
    blue: token("--primary", "#2e5496"),
    brightBlue: token("--brand-azure", "#668bce"),
  },
});
const terminalElement = document.getElementById("terminal")!;
const stateElement = document.getElementById("terminal-state")!;
const stateTitle = document.getElementById("terminal-state-title")!;
const stateMessage = document.getElementById("terminal-state-message")!;
const retryButton = document.getElementById("retry-connection") as HTMLButtonElement;
const connectionBadge = document.getElementById("connection-badge")!;
const connectionLabel = document.getElementById("connection-label")!;
const sessionExpiry = document.getElementById("session-expiry")!;
const sessionExpiryValue = document.getElementById("session-expiry-value")!;

terminal.open(terminalElement);
let socket: WebSocket | null = null;
let opened = false;
let closing = false;
let attempts = 0;
let retryTimer: number | undefined;
let sessionExpiresAt = Date.parse(sessionExpiry.dataset.expiresAt || "");
let sessionEnded = false;

const setConnectionState = (state: "connecting" | "connected" | "ended" | "error") => {
  const labels = { connecting: "Connecting", connected: "Connected", ended: "Session ended", error: "Connection failed" };
  connectionBadge.dataset.state = state;
  connectionLabel.textContent = labels[state];
};

const showState = (kind: "ended" | "error") => {
  setConnectionState(kind);
  stateTitle.textContent = kind === "ended" ? "Terminal session ended" : "Unable to connect";
  stateMessage.textContent = kind === "ended"
    ? "The secure tunnel was closed or reached its watchdog timeout. Start a new terminal session from the device details page."
    : "The router did not establish the secure tunnel. You can retry while the session is still available.";
  retryButton.hidden = kind !== "error";
  stateElement.hidden = false;
};

const markSessionEnded = () => {
  if (sessionEnded) return;
  sessionEnded = true;
  if (retryTimer !== undefined) window.clearTimeout(retryTimer);
  closing = true;
  sessionExpiry.dataset.state = "ended";
  sessionExpiryValue.textContent = "Expired";
  showState("ended");
  if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
};

const renderSessionExpiry = () => {
  if (!Number.isFinite(sessionExpiresAt)) {
    sessionExpiryValue.textContent = "Unavailable";
    return;
  }
  const seconds = Math.max(0, Math.ceil((sessionExpiresAt - Date.now()) / 1000));
  if (seconds === 0) {
    markSessionEnded();
    return;
  }
  sessionExpiry.dataset.state = seconds <= 60 ? "warning" : "active";
  const minutes = Math.floor(seconds / 60);
  sessionExpiryValue.textContent = `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
};

const refreshSessionExpiry = async () => {
  if (sessionEnded) return;
  try {
    const response = await fetch("/__rms/session-status", { cache: "no-store", credentials: "same-origin" });
    if (response.status === 403 || response.status === 404) {
      markSessionEnded();
      return;
    }
    if (!response.ok) return;
    const payload = await response.json();
    if (!payload.active) {
      markSessionEnded();
      return;
    }
    const nextExpiry = Date.parse(payload.expires_at);
    if (Number.isFinite(nextExpiry)) sessionExpiresAt = nextExpiry;
    renderSessionExpiry();
  } catch (_) {
    // Keep displaying the local countdown if the status request is briefly unavailable.
  }
};

const closeWindow = () => {
  window.close();
  stateMessage.textContent = "This tab can now be closed.";
};

const connect = () => {
  if (closing || sessionEnded) return;
  opened = false;
  setConnectionState("connecting");
  stateElement.hidden = true;
  attempts += 1;
  socket = new WebSocket(`wss://${location.host}/ws`);
  socket.binaryType = "arraybuffer";
  socket.onopen = () => {
    opened = true;
    attempts = 0;
    setConnectionState("connected");
    terminal.focus();
  };
  socket.onmessage = event => terminal.write(typeof event.data === "string" ? event.data : new Uint8Array(event.data));
  socket.onclose = () => {
    if (closing) return;
    // The router tunnel may still be attaching after the launch redirect.
    // Retry only before the first successful WebSocket, so a real closed
    // session is not silently replaced with a second browser attachment.
    if (!opened && attempts < 30) {
      retryTimer = window.setTimeout(connect, 500);
      return;
    }
    if (opened) terminal.write("\r\n[Session closed]\r\n");
    showState(opened ? "ended" : "error");
  };
  // Browsers commonly emit `error` immediately before `close`; render one
  // terminal status from `close` so a normal shutdown is not shown twice.
  socket.onerror = () => {};
};
connect();
renderSessionExpiry();
window.setInterval(renderSessionExpiry, 1000);
window.setInterval(refreshSessionExpiry, 5000);
void refreshSessionExpiry();
terminal.onData(data => { if (socket && socket.readyState === WebSocket.OPEN) socket.send(data); });
retryButton.addEventListener("click", () => {
  attempts = 0;
  connect();
});
document.getElementById("close-window")?.addEventListener("click", closeWindow);
document.getElementById("state-close-window")?.addEventListener("click", closeWindow);

const closeSession = () => {
  if (closing) return;
  closing = true;
  if (retryTimer !== undefined) window.clearTimeout(retryTimer);
  // WebSocket close is normally enough, but a page unload can abort it before
  // the gateway observes the close. The same-origin beacon closes the session
  // in the core even when the TCP/WebSocket teardown is incomplete.
  navigator.sendBeacon("/close", new Blob([], { type: "application/octet-stream" }));
  if (socket) socket.close();
};
window.addEventListener("pagehide", closeSession, { once: true });
window.addEventListener("beforeunload", closeSession, { once: true });
