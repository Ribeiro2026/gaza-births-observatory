import { db } from './index.ts';
import { users } from './schema.ts';

const DEFAULT_OWNER_ADMIN_EMAIL = 'tiago.cruz2010@gmail.com';

export function getOwnerAdminEmail(): string {
  const configured = process.env.OWNER_ADMIN_EMAIL?.trim().toLowerCase();
  return configured || DEFAULT_OWNER_ADMIN_EMAIL;
}

export function isOwnerAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  return email.trim().toLowerCase() === getOwnerAdminEmail();
}

export async function syncOwnerAdminUser(
  uid: string,
  email: string,
  displayName?: string
) {
  const normalizedEmail = email.trim().toLowerCase();
  if (!isOwnerAdminEmail(normalizedEmail)) {
    throw new Error('Only the app owner account may be synchronized.');
  }

  try {
    const name = displayName?.trim() || normalizedEmail.split('@')[0] || 'Administrator';

    const result = await db
      .insert(users)
      .values({
        uid,
        email: normalizedEmail,
        displayName: name,
        role: 'admin',
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          email: normalizedEmail,
          displayName: name,
          role: 'admin',
        },
      })
      .returning();

    return result[0];
  } catch (error) {
    console.error('Database owner profile upsert failed:', error);
    throw new Error('Failed to synchronize owner administrator profile.', { cause: error });
  }
}
