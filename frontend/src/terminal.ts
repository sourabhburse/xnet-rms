import { Terminal } from "xterm";
import "xterm/css/xterm.css";
const terminal = new Terminal({ cols: 100, rows: 30, cursorBlink: true });
terminal.open(document.getElementById("terminal")!);
let socket: WebSocket | null = null;
let opened = false;
let closing = false;
let attempts = 0;
let retryTimer: number | undefined;

const connect = () => {
  if (closing) return;
  attempts += 1;
  socket = new WebSocket(`wss://${location.host}/ws`);
  socket.binaryType = "arraybuffer";
  socket.onopen = () => {
    opened = true;
    attempts = 0;
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
    terminal.write(opened ? "\r\n[Session closed]\r\n" : "\r\n[Connection failed]\r\n");
  };
  // Browsers commonly emit `error` immediately before `close`; render one
  // terminal status from `close` so a normal shutdown is not shown twice.
  socket.onerror = () => {};
};
connect();
terminal.onData(data => { if (socket && socket.readyState === WebSocket.OPEN) socket.send(data); });
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
