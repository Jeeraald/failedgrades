import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "../firebase/firebaseConfig";
import { useSessionTimeout } from "../utils/useSessionTimeout";
import SessionTimeoutModal from "./SessionTimeoutModal";

interface Props {
  children: ReactNode;
}

export default function ProtectedRoute({ children }: Props) {
  const [user,       setUser]       = useState<User | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);

      if (firebaseUser) {
        try {
          const snap = await getDoc(doc(db, "instructors", firebaseUser.uid));
          // setupComplete === false means explicitly flagged as incomplete (new user)
          // undefined/true means existing user or already completed
          setNeedsSetup(snap.exists() && snap.data().setupComplete === false);
        } catch {
          setNeedsSetup(false); // on Firestore error, don't block access
        }
      }

      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleLogout = async () => {
    await signOut(auth);
    navigate("/instructor-login", { replace: true });
  };

  const { showModal, countdown, extendSession, logoutNow } = useSessionTimeout({
    warningDelayMs: 5 * 60 * 1000,
    countdownSec:   20,
    onLogout:       handleLogout,
    enabled:        !!user && !needsSetup,
  });

  if (loading) return null;
  if (!user)      return <Navigate to="/instructor-login" replace />;
  if (needsSetup) return <Navigate to="/instructor/setup"  replace />;

  return (
    <>
      {children}
      {showModal && (
        <SessionTimeoutModal
          countdown={countdown}
          totalSec={20}
          onExtend={extendSession}
          onLogout={logoutNow}
        />
      )}
    </>
  );
}
