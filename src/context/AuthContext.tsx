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
  role: 'admin' | null;
  isOwner: boolean;
  loading: boolean;
  signingIn: boolean;
  authError: string | null;
  clearAuthError: () => void;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  authFetch: (input: string, init?: RequestInit) => Promise<Response>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const OWNER_DENIED_MESSAGE =
  'Access restricted: only the app owner is authorized to sign in and modify records.';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<'admin' | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Keep ID token strictly in memory (never localStorage or sessionStorage)
  const tokenRef = useRef<string | null>(null);
  const verifyingUidRef = useRef<string | null>(null);

  const verifyOwnerSession = useCallback(
    async (firebaseUser: User, showErrorOnReject: boolean): Promise<boolean> => {
      if (verifyingUidRef.current === firebaseUser.uid) {
        return false;
      }
      verifyingUidRef.current = firebaseUser.uid;

      try {
        const token = await firebaseUser.getIdToken();
        const res = await fetch('/api/me', {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (res.ok) {
          const data = await res.json();
          if (data?.isOwner === true && data?.role === 'admin') {
            tokenRef.current = token;
            setUser(firebaseUser);
            setRole('admin');
            setAuthError(null);
            return true;
          }
        }

        const errData = await res.json().catch(() => ({}));
        const deniedMsg =
          typeof errData?.error === 'string' && errData.error.trim()
            ? errData.error
            : OWNER_DENIED_MESSAGE;

        // Immediately clear unauthorized Google session so non-owners are never left signed in
        tokenRef.current = null;
        setUser(null);
        setRole(null);
        if (showErrorOnReject) {
          setAuthError(deniedMsg);
        }
        await firebaseSignOut(auth).catch(() => {});
        return false;
      } catch {
        tokenRef.current = null;
        setUser(null);
        setRole(null);
        if (showErrorOnReject) {
          setAuthError('Unable to verify owner credentials. Please try again.');
        }
        await firebaseSignOut(auth).catch(() => {});
        return false;
      } finally {
        verifyingUidRef.current = null;
      }
    },
    []
  );

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
      if (nextUser) {
        await verifyOwnerSession(nextUser, true);
      } else {
        tokenRef.current = null;
        setUser(null);
        setRole(null);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, [verifyOwnerSession]);

  const signIn = useCallback(async () => {
    setAuthError(null);
    setSigningIn(true);
    try {
      const result = await signInWithPopup(auth, googleAuthProvider);
      if (result.user) {
        await verifyOwnerSession(result.user, true);
      }
    } catch (err: unknown) {
      const code =
        typeof err === 'object' && err !== null && 'code' in err
          ? String((err as { code?: unknown }).code)
          : '';
      // Do not display alarming error if user intentionally closed the Google popup
      if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') {
        const message =
          err instanceof Error ? err.message : 'Google Sign-In failed. Please try again.';
        setAuthError(message);
      }
    } finally {
      setSigningIn(false);
    }
  }, [verifyOwnerSession]);

  const signOut = useCallback(async () => {
    setAuthError(null);
    tokenRef.current = null;
    setUser(null);
    setRole(null);
    await firebaseSignOut(auth);
  }, []);

  const clearAuthError = useCallback(() => {
    setAuthError(null);
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

  const isOwner = Boolean(user && role === 'admin');

  return (
    <AuthContext.Provider
      value={{
        user,
        role,
        isOwner,
        loading,
        signingIn,
        authError,
        clearAuthError,
        signIn,
        signOut,
        authFetch,
      }}
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
