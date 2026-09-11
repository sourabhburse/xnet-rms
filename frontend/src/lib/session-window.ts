const SESSION_WINDOW_STYLE = `
  :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f4f6fa; color: #13233f; }
  main { display: grid; justify-items: center; gap: 16px; padding: 32px; text-align: center; }
  .mark { display: block; width: 36px; height: 24px; animation: breathe 1.2s ease-in-out infinite; }
  @keyframes breathe { 0%, 100% { opacity: .4; transform: scale(.85); } 50% { opacity: 1; transform: scale(1); } }
  @media (prefers-reduced-motion: reduce) { .mark { animation: none; } }
`;

export function openSessionWindow(label: string): Window | null {
  const tab = window.open('about:blank', '_blank');
  if (!tab) return null;

  tab.document.title = `XNET RMS - ${label}`;
  tab.document.body.innerHTML = `
    <main>
      <svg viewBox="0 0 62 24" role="img" aria-label="XNET" class="mark" xmlns="http://www.w3.org/2000/svg">
        <circle cx="12" cy="12" fill="#203864" r="11"></circle>
        <circle cx="24" cy="12" fill="#2e5496" r="11"></circle>
        <circle cx="36" cy="12" fill="#3f6bb0" r="11"></circle>
        <circle cx="48" cy="12" fill="#668bce" r="11"></circle>
      </svg>
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
