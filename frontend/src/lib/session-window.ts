const SESSION_WINDOW_STYLE = `
  :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f4f6fa; color: #13233f; }
  main { display: grid; justify-items: center; gap: 16px; padding: 32px; text-align: center; }
  .mark { display: flex; gap: 5px; align-items: center; }
  .mark i { display: block; width: 12px; height: 12px; border-radius: 50%; background: #3f6ab3; animation: breathe 1.2s ease-in-out infinite; }
  .mark i:nth-child(2) { animation-delay: .12s; }
  .mark i:nth-child(3) { animation-delay: .24s; }
  .mark i:nth-child(4) { animation-delay: .36s; }
  @keyframes breathe { 0%, 100% { opacity: .4; transform: scale(.85); } 50% { opacity: 1; transform: scale(1); } }
  @media (prefers-reduced-motion: reduce) { .mark i { animation: none; } }
`;

export function openSessionWindow(label: string): Window | null {
  const tab = window.open('about:blank', '_blank');
  if (!tab) return null;

  tab.document.title = `XNET RMS - ${label}`;
  tab.document.body.innerHTML = `
    <main>
      <div class="mark" aria-label="XNET RMS loading"><i></i><i></i><i></i><i></i></div>
      <strong>Connecting to ${label}</strong>
      <span>Please wait while the secure router session is prepared.</span>
    </main>
  `;
  const style = tab.document.createElement('style');
  style.textContent = SESSION_WINDOW_STYLE;
  tab.document.head.appendChild(style);
  return tab;
}

export function navigateSessionWindow(tab: Window | null, launchUrl: string): void {
  if (tab && !tab.closed) {
    tab.location.href = launchUrl;
    return;
  }
  window.open(launchUrl, '_blank');
}
