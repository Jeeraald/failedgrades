import { useState, useEffect, useRef, useCallback } from "react";

interface Options {
  /** Ms of inactivity before showing the warning modal. Default: 5 minutes. */
  warningDelayMs?: number;
  /** Seconds shown in the countdown before auto-logout. Default: 20. */
  countdownSec?: number;
  /** Called when the user should be logged out (either auto or manual). */
  onLogout: () => void;
  /** Set to false to disable the hook (e.g. when no session exists). */
  enabled?: boolean;
}

export function useSessionTimeout({
  warningDelayMs = 5 * 60 * 1000,
  countdownSec = 20,
  onLogout,
  enabled = true,
}: Options) {
  const [showModal, setShowModal] = useState(false);
  const [countdown, setCountdown] = useState(countdownSec);

  // All mutable state lives in a ref so callbacks never go stale
  const r = useRef({
    warningTimer:   null as ReturnType<typeof setTimeout>  | null,
    countdownTimer: null as ReturnType<typeof setInterval> | null,
    isModalOpen:    false,
    onLogout,
    warningDelayMs,
    countdownSec,
  });

  // Keep refs in sync with latest props every render
  r.current.onLogout       = onLogout;
  r.current.warningDelayMs = warningDelayMs;
  r.current.countdownSec   = countdownSec;

  const clearTimers = useCallback(() => {
    if (r.current.warningTimer)   { clearTimeout(r.current.warningTimer);   r.current.warningTimer   = null; }
    if (r.current.countdownTimer) { clearInterval(r.current.countdownTimer); r.current.countdownTimer = null; }
  }, []);

  const doLogout = useCallback(() => {
    clearTimers();
    r.current.isModalOpen = false;
    setShowModal(false);
    r.current.onLogout();
  }, [clearTimers]);

  const scheduleWarning = useCallback(() => {
    if (r.current.warningTimer) clearTimeout(r.current.warningTimer);
    r.current.warningTimer = setTimeout(() => {
      r.current.warningTimer  = null;
      r.current.isModalOpen   = true;
      let remaining = r.current.countdownSec;
      setCountdown(remaining);
      setShowModal(true);

      r.current.countdownTimer = setInterval(() => {
        remaining -= 1;
        setCountdown(remaining);
        if (remaining <= 0) {
          clearInterval(r.current.countdownTimer!);
          r.current.countdownTimer = null;
          r.current.isModalOpen    = false;
          setShowModal(false);
          r.current.onLogout();
        }
      }, 1000);
    }, r.current.warningDelayMs);
  }, []);

  const extendSession = useCallback(() => {
    clearTimers();
    r.current.isModalOpen = false;
    setShowModal(false);
    setCountdown(r.current.countdownSec);
    scheduleWarning();
  }, [clearTimers, scheduleWarning]);

  useEffect(() => {
    if (!enabled) return;

    const onActivity = () => {
      if (r.current.isModalOpen) return; // ignore events while warning is visible
      scheduleWarning();
    };

    const events = ["mousemove", "keydown", "click", "scroll", "touchstart"];
    events.forEach(e => window.addEventListener(e, onActivity));
    scheduleWarning(); // start the first timer immediately

    return () => {
      clearTimers();
      events.forEach(e => window.removeEventListener(e, onActivity));
    };
  }, [enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  return { showModal, countdown, extendSession, logoutNow: doLogout };
}
