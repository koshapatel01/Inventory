'use client';

// The app-wide guided tour + help launcher. Mounted once in app/layout.jsx so
// its floating "?" button and any active tour step are available on every
// page. State (which step, whether the tour is running) is kept in
// sessionStorage so a tour survives real page navigations — each step names
// the route it belongs to (see lib/tourSteps.js), and the engine below
// pushes to that route when the user advances to a step on a different page.
//
// The overlay never blocks clicks on the rest of the page (pointer-events:
// none on the spotlight box) — it's a non-modal guide, not a lightbox, so a
// curious user can interact with the real UI while a step is showing.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { TOUR_STEPS } from '@/lib/tourSteps';

const SESSION_KEY = 'uhd-tour-session';
const SEEN_KEY = 'uhd-tour-seen';

const TourContext = createContext(null);

/** Lets any component (e.g. the Help Center's "Restart tour" button) start or reset the tour. */
export function useTour() {
  const ctx = useContext(TourContext);
  if (!ctx) throw new Error('useTour must be used inside <GuideProvider>.');
  return ctx;
}

function readSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeSession(state) {
  try {
    if (state) sessionStorage.setItem(SESSION_KEY, JSON.stringify(state));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Storage can be unavailable (private browsing, etc.) — the tour still
    // works within the current page, it just won't survive a navigation.
  }
}

export default function GuideProvider({ children }) {
  const pathname = usePathname();
  const router = useRouter();

  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [targetRect, setTargetRect] = useState(null);
  const [resolvedNoTarget, setResolvedNoTarget] = useState(false);
  const pollRef = useRef(null);

  // Restore an in-progress tour (survives navigation) or auto-launch once for
  // a first-time visitor landing on the home page. Runs once — GuideProvider
  // lives in the root layout and isn't remounted by client-side navigation.
  useEffect(() => {
    const saved = readSession();
    if (saved?.active) {
      setActive(true);
      setStepIndex(saved.stepIndex || 0);
      return;
    }
    try {
      if (pathname === '/' && !localStorage.getItem(SEEN_KEY)) {
        localStorage.setItem(SEEN_KEY, '1');
        setActive(true);
        setStepIndex(0);
      }
    } catch {
      // No localStorage — just skip auto-launch, manual start still works.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    writeSession(active ? { active: true, stepIndex } : null);
  }, [active, stepIndex]);

  const step = TOUR_STEPS[stepIndex] || null;
  const stepIsHere = active && step && step.path === pathname;

  // Find (and keep tracking) this step's target element while it's visible.
  useEffect(() => {
    setTargetRect(null);
    setResolvedNoTarget(false);
    if (pollRef.current) clearTimeout(pollRef.current);
    if (!stepIsHere) return;

    if (!step.selector) {
      setResolvedNoTarget(true);
      return undefined;
    }

    let cancelled = false;
    let el = null;

    function measure() {
      if (!el || cancelled) return;
      setTargetRect(el.getBoundingClientRect());
    }

    function attempt(triesLeft) {
      if (cancelled) return;
      el = document.querySelector(step.selector);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        pollRef.current = setTimeout(measure, 350);
        return;
      }
      if (triesLeft <= 0) {
        setResolvedNoTarget(true);
        return;
      }
      pollRef.current = setTimeout(() => attempt(triesLeft - 1), 100);
    }
    attempt(40);

    function onViewportChange() {
      measure();
    }
    window.addEventListener('scroll', onViewportChange, true);
    window.addEventListener('resize', onViewportChange);

    return () => {
      cancelled = true;
      if (pollRef.current) clearTimeout(pollRef.current);
      window.removeEventListener('scroll', onViewportChange, true);
      window.removeEventListener('resize', onViewportChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIsHere, stepIndex]);

  const goToStep = useCallback(
    (index) => {
      const next = TOUR_STEPS[index];
      if (!next) {
        setActive(false);
        return;
      }
      setStepIndex(index);
      if (next.path !== pathname) router.push(next.path);
    },
    [pathname, router]
  );

  const startTour = useCallback(() => {
    try {
      localStorage.setItem(SEEN_KEY, '1');
    } catch {
      // Ignore — starting the tour still works without persistence.
    }
    setActive(true);
    setMenuOpen(false);
    goToStep(0);
  }, [goToStep]);

  const stopTour = useCallback(() => {
    setActive(false);
    writeSession(null);
  }, []);

  const value = { active, startTour, restartTour: startTour, stopTour };

  const showOverlay = stepIsHere && (targetRect || resolvedNoTarget);
  const showLauncher = !showOverlay;

  return (
    <TourContext.Provider value={value}>
      {children}

      {showOverlay && (
        <TourStep
          step={step}
          index={stepIndex}
          total={TOUR_STEPS.length}
          targetRect={targetRect}
          onNext={() => goToStep(stepIndex + 1)}
          onBack={() => goToStep(stepIndex - 1)}
          onSkip={stopTour}
        />
      )}

      {showLauncher && (
        <div className="tour-launcher">
          {menuOpen && (
            <div className="tour-menu">
              <button type="button" className="tour-menu-item" onClick={startTour}>
                {active ? 'Restart the guided tour' : 'Take the guided tour'}
              </button>
              <Link href="/help" className="tour-menu-item" onClick={() => setMenuOpen(false)}>
                Open Help Center
              </Link>
            </div>
          )}
          <button
            type="button"
            className="tour-help-btn"
            aria-label="Help and guided tour"
            title="Help and guided tour"
            onClick={() => setMenuOpen((o) => !o)}
          >
            ?
          </button>
        </div>
      )}
    </TourContext.Provider>
  );
}

function TourStep({ step, index, total, targetRect, onNext, onBack, onSkip }) {
  const isLast = index === total - 1;
  const style = targetRect ? cardStyleFor(targetRect, step.placement) : centeredCardStyle();

  return (
    <>
      {targetRect && (
        <div
          className="tour-spotlight"
          style={{
            top: targetRect.top - 6,
            left: targetRect.left - 6,
            width: targetRect.width + 12,
            height: targetRect.height + 12,
          }}
        />
      )}
      <div className="tour-card" style={style}>
        <button type="button" className="tour-card-close" aria-label="Close tour" onClick={onSkip}>×</button>
        <div className="tour-card-progress">Step {index + 1} of {total}</div>
        <h3 className="tour-card-title">{step.title}</h3>
        <p className="tour-card-body">{step.body}</p>
        <div className="tour-card-actions">
          <button type="button" className="tour-btn-ghost" onClick={onSkip}>Skip tour</button>
          <div style={{ display: 'flex', gap: 8 }}>
            {index > 0 && <button type="button" className="tour-btn-ghost" onClick={onBack}>Back</button>}
            <button type="button" className="tour-btn-primary" onClick={onNext}>{isLast ? 'Finish' : 'Next'}</button>
          </div>
        </div>
      </div>
    </>
  );
}

function centeredCardStyle() {
  return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
}

function cardStyleFor(rect, placement) {
  const gap = 16;
  const cardWidth = 320;
  const viewportW = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const viewportH = typeof window !== 'undefined' ? window.innerHeight : 800;

  let top;
  let left = rect.left + rect.width / 2 - cardWidth / 2;
  let transform = '';

  if (placement === 'top' && rect.top > 220) {
    top = rect.top - gap;
    transform = 'translateY(-100%)';
  } else if (placement === 'left' && rect.left > cardWidth + gap) {
    top = rect.top + rect.height / 2;
    left = rect.left - gap;
    transform = 'translate(-100%, -50%)';
  } else if (placement === 'right' && rect.right + cardWidth + gap < viewportW) {
    top = rect.top + rect.height / 2;
    left = rect.right + gap;
    transform = 'translateY(-50%)';
  } else {
    // Default/fallback: below the target, flipped above if there's no room.
    top = rect.bottom + gap;
    if (top + 200 > viewportH) {
      top = rect.top - gap;
      transform = 'translateY(-100%)';
    }
  }

  left = Math.max(16, Math.min(left, viewportW - cardWidth - 16));
  return { top, left, transform, width: cardWidth };
}
