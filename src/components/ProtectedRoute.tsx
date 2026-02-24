import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { auth } from "../firebase/firebaseConfig";

interface Props {
  children: ReactNode;
}

export default function ProtectedRoute({ children }: Props) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;

    let timeout: ReturnType<typeof setTimeout>; 

    const resetTimer = () => {
      clearTimeout(timeout);
      timeout = setTimeout(async () => {
        await signOut(auth);
        alert("Session expired due to inactivity.");
        navigate("/admin-login", { replace: true });
      }, 10 * 60 * 1000); // 10 minutes
    };

    // Activity listeners
    window.addEventListener("mousemove", resetTimer);
    window.addEventListener("keydown", resetTimer);
    window.addEventListener("click", resetTimer);
    window.addEventListener("scroll", resetTimer);

    resetTimer(); // start timer

    return () => {
      clearTimeout(timeout);
      window.removeEventListener("mousemove", resetTimer);
      window.removeEventListener("keydown", resetTimer);
      window.removeEventListener("click", resetTimer);
      window.removeEventListener("scroll", resetTimer);
    };
  }, [user, navigate]);

  if (loading) return null;

  if (!user) {
    return <Navigate to="/admin-login" replace />;
  }

  return <>{children}</>;
}