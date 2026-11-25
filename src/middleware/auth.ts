import { Request, Response, NextFunction } from 'express';
import { DecodedIdToken } from 'firebase-admin/auth';
import { adminAuth } from '../lib/firebase-admin.ts';
import { getOrCreateUser } from '../db/users.ts';

export interface AuthRequest extends Request {
  user?: DecodedIdToken & {
    dbUserId?: number;
    role?: string;
  };
}

export const requireAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res
      .status(401)
      .json({ error: 'Authentication required. Please sign in with Google to perform this action.' });
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    return res.status(401).json({ error: 'Authentication token is missing.' });
  }

  try {
    const decodedToken = await adminAuth.verifyIdToken(token);
    const dbUser = await getOrCreateUser(
      decodedToken.uid,
      decodedToken.email || `${decodedToken.uid}@users.local`,
      decodedToken.name
    );

    req.user = {
      ...decodedToken,
      dbUserId: dbUser?.id,
      role: dbUser?.role || 'reviewer',
    };
    return next();
  } catch (error) {
    console.error('Firebase token verification failed:', error);
    return res
      .status(401)
      .json({ error: 'Session expired or invalid. Please sign in again.' });
  }
};
