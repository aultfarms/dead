export function syncVisualViewport(): () => void {
  const root = document.documentElement;

  const update = () => {
    const viewport = window.visualViewport;
    root.style.setProperty('--vv-height', `${viewport?.height ?? window.innerHeight}px`);
    root.style.setProperty('--vv-width', `${viewport?.width ?? window.innerWidth}px`);
    root.style.setProperty('--vv-offset-top', `${viewport?.offsetTop ?? 0}px`);
    root.style.setProperty('--vv-offset-left', `${viewport?.offsetLeft ?? 0}px`);
  };

  update();
  window.addEventListener('resize', update);
  window.addEventListener('orientationchange', update);
  viewportListener(viewport => viewport.addEventListener('resize', update));
  viewportListener(viewport => viewport.addEventListener('scroll', update));

  return () => {
    window.removeEventListener('resize', update);
    window.removeEventListener('orientationchange', update);
    viewportListener(viewport => viewport.removeEventListener('resize', update));
    viewportListener(viewport => viewport.removeEventListener('scroll', update));
  };
}

function viewportListener(apply: (viewport: VisualViewport) => void): void {
  if (window.visualViewport) apply(window.visualViewport);
}
