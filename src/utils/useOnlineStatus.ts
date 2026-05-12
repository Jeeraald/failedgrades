import { useState, useEffect, useRef } from "react";

export type SyncStatus = "online" | "offline" | "reconnected";

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [status, setStatus] = useState<SyncStatus>(
    navigator.onLine ? "online" : "offline"
  );
  // Must live in a ref — the event listener return value is discarded by the browser
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onOnline = () => {
      setIsOnline(true);
      setStatus("reconnected");
      if (settleTimer.current) clearTimeout(settleTimer.current);
      settleTimer.current = setTimeout(() => setStatus("online"), 3000);
    };
    const onOffline = () => {
      setIsOnline(false);
      setStatus("offline");
      if (settleTimer.current) { clearTimeout(settleTimer.current); settleTimer.current = null; }
    };

    window.addEventListener("online",  onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online",  onOnline);
      window.removeEventListener("offline", onOffline);
      if (settleTimer.current) clearTimeout(settleTimer.current);
    };
  }, []);

  return { isOnline, status };
}
