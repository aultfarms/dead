export function syncVisualViewport(): () => void {
  const root = document.documentElement;
  let frame = 0;
  let lastHeight = '';

  const apply = () => {
    frame = 0;
    const viewport = window.visualViewport;
    if (viewport && viewport.scale > 1) return;
    const height = `${viewport?.height ?? window.innerHeight}px`;
    if (height === lastHeight) return;
    lastHeight = height;
    root.style.setProperty('--vv-height', height);
    root.style.setProperty('--vv-width', '100%');
    root.style.setProperty('--vv-offset-top', '0px');
    root.style.setProperty('--vv-offset-left', '0px');
  };

  const schedule = () => {
    if (frame) return;
    frame = window.requestAnimationFrame(apply);
  };

  apply();
  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', schedule);
  viewportListener(viewport => viewport.addEventListener('resize', schedule));

  return () => {
    if (frame) window.cancelAnimationFrame(frame);
    window.removeEventListener('resize', schedule);
    window.removeEventListener('orientationchange', schedule);
    viewportListener(viewport => viewport.removeEventListener('resize', schedule));
  };
}

function viewportListener(apply: (viewport: VisualViewport) => void): void {
  if (window.visualViewport) apply(window.visualViewport);
}
