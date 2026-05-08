import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { auth } from "../firebase/firebaseConfig";
import { useSessionTimeout } from "../utils/useSessionTimeout";
import SessionTimeoutModal from "./SessionTimeoutModal";

interface Props {
  children: ReactNode;
}

export default function ProtectedRoute({ children }: Props) {
  const [user, setUser]       = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate              = useNavigate();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleLogout = async () => {
    await signOut(auth);
    navigate("/instructor-login", { replace: true });
  };

  const { showModal, countdown, extendSession, logoutNow } = useSessionTimeout({
    warningDelayMs: 5 * 60 * 1000, // show warning after 5 min of inactivity
    countdownSec:   20,
    onLogout:       handleLogout,
    enabled:        !!user,
  });

  if (loading) return null;

  if (!user) return <Navigate to="/instructor-login" replace />;

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
