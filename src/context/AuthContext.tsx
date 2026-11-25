import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth';
import { auth, googleAuthProvider } from '../lib/firebase';

interface AuthContextValue {
  user: User | null;
  role: string | null;
  loading: boolean;
  authError: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  authFetch: (input: string, init?: RequestInit) => Promise<Response>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  // Keep ID token strictly in memory (never localStorage)
  const tokenRef = useRef<string | null>(null);

  const syncServerProfile = useCallback(async (firebaseUser: User) => {
    try {
      const token = await firebaseUser.getIdToken();
      tokenRef.current = token;
      const res = await fetch('/api/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setRole(data.role || 'reviewer');
      }
    } catch {
      setRole('reviewer');
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      if (nextUser) {
        await syncServerProfile(nextUser);
      } else {
        tokenRef.current = null;
        setRole(null);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, [syncServerProfile]);

  const signIn = useCallback(async () => {
    setAuthError(null);
    try {
      const result = await signInWithPopup(auth, googleAuthProvider);
      if (result.user) {
        await syncServerProfile(result.user);
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Google Sign-In was cancelled or failed.';
      setAuthError(message);
      throw err;
    }
  }, [syncServerProfile]);

  const signOut = useCallback(async () => {
    setAuthError(null);
    tokenRef.current = null;
    setRole(null);
    await firebaseSignOut(auth);
  }, []);

  const authFetch = useCallback(
    async (input: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      if (user) {
        const freshToken = await user.getIdToken();
        tokenRef.current = freshToken;
        headers.set('Authorization', `Bearer ${freshToken}`);
      } else if (tokenRef.current) {
        headers.set('Authorization', `Bearer ${tokenRef.current}`);
      }
      return fetch(input, { ...init, headers });
    },
    [user]
  );

  return (
    <AuthContext.Provider
      value={{ user, role, loading, authError, signIn, signOut, authFetch }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
