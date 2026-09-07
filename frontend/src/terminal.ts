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
window.addEventListener("beforeunload", () => socket.close());
