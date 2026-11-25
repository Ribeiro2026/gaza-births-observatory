import { Request, Response, NextFunction } from 'express';
import { DecodedIdToken } from 'firebase-admin/auth';
import { adminAuth } from '../lib/firebase-admin.ts';
import { isOwnerAdminEmail, syncOwnerAdminUser } from '../db/users.ts';

export interface AuthRequest extends Request {
  user?: DecodedIdToken & {
    dbUserId?: number;
    role: 'admin';
    isOwner: true;
  };
}

export const requireOwnerAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Owner authentication required. Please sign in with the owner Google account.',
    });
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    return res.status(401).json({ error: 'Authentication token is missing.' });
  }

  let decodedToken: DecodedIdToken;
  try {
    decodedToken = await adminAuth.verifyIdToken(token);
  } catch (error) {
    console.error('Firebase token verification failed:', error);
    return res
      .status(401)
      .json({ error: 'Session expired or invalid. Please sign in again.' });
  }

  const verifiedEmail =
    decodedToken.email_verified === true && typeof decodedToken.email === 'string'
      ? decodedToken.email.trim().toLowerCase()
      : null;

  if (!verifiedEmail || !isOwnerAdminEmail(verifiedEmail)) {
    return res.status(403).json({
      error:
        'Access restricted: only the app owner is authorized to sign in and modify records.',
    });
  }

  try {
    const dbUser = await syncOwnerAdminUser(
      decodedToken.uid,
      verifiedEmail,
      decodedToken.name
    );

    req.user = {
      ...decodedToken,
      email: verifiedEmail,
      dbUserId: dbUser?.id,
      role: 'admin',
      isOwner: true,
    };
    return next();
  } catch (error) {
    console.error('Owner profile sync failed:', error);
    return res
      .status(500)
      .json({ error: 'Unable to verify administrator profile. Please try again.' });
  }
};
