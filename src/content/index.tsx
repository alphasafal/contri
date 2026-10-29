import { createRoot } from 'react-dom/client';
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { parsePage, type PageContext } from '../shared/repo';
import { call, DEFAULT_PREFS, type Prefs } from '../shared/protocol';
import { App } from './ui/App';
import { LogoMark } from './ui/icons';
import { installFonts } from './fonts';
import { onNavigate } from './navigation';
import { watchTheme } from './theme';
import { startBadges, OPEN_EVENT } from './badges';
import css from './widget.css?inline';

const HOST_ID = 'contri-widget-root';
const SIZE = { open: { w: 380, h: 540 }, mini: { w: 46, h: 46 } };
type Mode = 'open' | 'mini' | 'closed';

const flag = window as unknown as { __contriLoaded?: boolean };

function initialMode(prefs: Prefs, page: PageContext): Mode {
  if (!page.repo) return 'closed';
  if (prefs.widget === 'open') return 'open';
  if (prefs.widget === 'issues' && page.issue) return 'open';
  return 'mini';
}

function boot() {
  // Pointer must move this far to be counted as a drag
  const DRAG_THRESHOLD = 5;

  installFonts();
  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText =
    'position:fixed!important;z-index:2147483646!important;right:18px;bottom:18px;display:none;max-width:calc(100vw - 16px);max-height:calc(100dvh - 16px);color-scheme:light;';
  document.documentElement.append(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = css;
  const mount = document.createElement('div');
  mount.style.cssText = 'width:100%;height:100%;';
  shadow.append(style, mount);
  const stopTheme = watchTheme((theme) => (host.dataset.theme = theme));

  const clamp = () => {
    const r = host.getBoundingClientRect();
    const x = Math.max(8, Math.min(r.left, innerWidth - r.width - 8));
    const y = Math.max(8, Math.min(r.top, innerHeight - r.height - 8));
    Object.assign(host.style, { left: `${x}px`, top: `${y}px`, right: 'auto', bottom: 'auto' });
  };
  // Arrow keys and drags call this many times a second; one write after the movement settles is enough.
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const savePosition = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const r = host.getBoundingClientRect();
      void call('setPrefs', { position: { x: Math.round(r.left), y: Math.round(r.top) } }).catch(() => {});
    }, 250);
  };

  function Root() {
    const [page, setPage] = useState<PageContext>(() => parsePage(location.href));
    const [mode, setMode] = useState<Mode>('closed');
    const [prefs, setPrefs] = useState<Prefs | null>(null);
    // Keyboard users who minimize the panel land on the launcher instead of losing focus.
    const restoreFocus = useRef(false);

    useEffect(() => {
      void call('prefs', {})
        .catch(() => DEFAULT_PREFS)
        .then((p) => {
          setPrefs(p);
          setMode(initialMode(p, parsePage(location.href)));
          if (p.position) {
            Object.assign(host.style, {
              left: `${p.position.x}px`,
              top: `${p.position.y}px`,
              right: 'auto',
              bottom: 'auto',
            });
            requestAnimationFrame(clamp);
          }
        });
      const stopNav = onNavigate((href) => setPage(parsePage(href)));
      const onToggle = (message: { type?: string }) => {
        if (message?.type === 'CONTRI_TOGGLE') setMode((m) => (m === 'open' ? 'mini' : 'open'));
      };
      const onOpen = () => setMode('open');
      chrome.runtime.onMessage.addListener(onToggle);
      window.addEventListener(OPEN_EVENT, onOpen);
      window.addEventListener('resize', clamp);
      return () => {
        stopNav();
        chrome.runtime.onMessage.removeListener(onToggle);
        window.removeEventListener(OPEN_EVENT, onOpen);
        window.removeEventListener('resize', clamp);
      };
    }, []);

    // Leaving a repository hides the launcher unless the user opened CONTRI on purpose.
    useEffect(() => {
      if (!prefs) return;
      setMode((m) => {
        if (!page.repo) return m === 'open' ? 'open' : 'closed';
        if (m === 'closed') return initialMode(prefs, page);
        if (prefs.widget === 'issues' && page.issue) return 'open';
        return m;
      });
    }, [page, prefs]);

    useEffect(() => {
      host.style.display = mode === 'closed' ? 'none' : 'block';
      const size = mode === 'mini' ? SIZE.mini : SIZE.open;
      host.style.width = `${size.w}px`;
      host.style.height = `${size.h}px`;
      if (mode !== 'closed') requestAnimationFrame(clamp);
    }, [mode]);

    const move = useCallback((dx: number, dy: number) => {
      const r = host.getBoundingClientRect();
      Object.assign(host.style, { left: `${r.left + dx}px`, top: `${r.top + dy}px`, right: 'auto', bottom: 'auto' });
      clamp();
      savePosition();
    }, []);

    const didDrag = useRef(false);

    const drag = useCallback((e: ReactPointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      didDrag.current = false;
      const start = host.getBoundingClientRect();
      const x0 = e.clientX;
      const y0 = e.clientY;
      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - x0;
        const dy = ev.clientY - y0;
        if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
          didDrag.current = true;
        }
        Object.assign(host.style, {
          left: `${start.left + dx}px`,
          top: `${start.top + dy}px`,
          right: 'auto',
          bottom: 'auto',
        });
        clamp();
      };
      const end = () => {
        window.removeEventListener('pointermove', onMove, true);
        window.removeEventListener('pointerup', end, true);
        window.removeEventListener('pointercancel', end, true);
        savePosition();
      };
      window.addEventListener('pointermove', onMove, true);
      window.addEventListener('pointerup', end, true);
      window.addEventListener('pointercancel', end, true);
    }, []);

    const reset = useCallback(() => {
      Object.assign(host.style, { left: 'auto', top: 'auto', right: '18px', bottom: '18px' });
      void call('setPrefs', { position: null }).catch(() => {});
    }, []);

    if (mode === 'closed') return null;
    if (mode === 'mini')
      return (
        <button
          ref={(el) => {
            if (el && restoreFocus.current) {
              restoreFocus.current = false;
              el.focus();
            }
          }}
          className="cc-launcher"
          aria-label="Open CONTRI"
          title="CONTRI — open source compass. Drag to move."
          onPointerDown={drag}
          onClick={() => {
            const dragged = didDrag.current;
            didDrag.current = false;
            if (!dragged) setMode('open');
          }}
        >
          <LogoMark size={26} />
        </button>
      );
    return (
      <App
        page={{ repo: page.repo, issue: page.issue }}
        onMinimize={() => {
          restoreFocus.current = shadow.activeElement !== null;
          setMode('mini');
        }}
        onClose={() => setMode('closed')}
        onPositionReset={reset}
        onDrag={drag}
        onMove={move}
      />
    );
  }

  createRoot(mount).render(<Root />);
  const stopBadges = startBadges();
  window.addEventListener('pagehide', (e) => {
    if (!e.persisted) {
      stopTheme();
      stopBadges();
    }
  });
}

if (!flag.__contriLoaded && !document.getElementById(HOST_ID)) {
  flag.__contriLoaded = true;
  boot();
}
