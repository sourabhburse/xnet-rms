import { Terminal } from "xterm";
import "xterm/css/xterm.css";
const terminal = new Terminal({ cols: 100, rows: 30, cursorBlink: true });
terminal.open(document.getElementById("terminal")!);
const socket = new WebSocket(`wss://${location.host}/ws`);
socket.binaryType = "arraybuffer";
let opened = false;
socket.onopen = () => {
  opened = true;
  terminal.focus();
};
socket.onmessage = event => terminal.write(typeof event.data === "string" ? event.data : new Uint8Array(event.data));
socket.onclose = () => terminal.write(opened ? "\r\n[Session closed]\r\n" : "\r\n[Connection failed]\r\n");
// Browsers commonly emit `error` immediately before `close`. Render one
// terminal status from `close` so a normal session shutdown is not shown as
// both a failure and a close.
socket.onerror = () => {};
terminal.onData(data => { if (socket.readyState === WebSocket.OPEN) socket.send(data); });
let closing = false;
const closeSession = () => {
  if (closing) return;
  closing = true;
  // WebSocket close is normally enough, but a page unload can abort it before
  // the gateway observes the close. The same-origin beacon closes the session
  // in the core even when the TCP/WebSocket teardown is incomplete.
  navigator.sendBeacon("/close", new Blob([], { type: "application/octet-stream" }));
  socket.close();
};
window.addEventListener("pagehide", closeSession, { once: true });
window.addEventListener("beforeunload", closeSession, { once: true });
