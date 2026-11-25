import { db } from './index.ts';
import { users } from './schema.ts';

const INITIAL_ADMIN_EMAIL = 'tiago.cruz2010@gmail.com';

export async function getOrCreateUser(
  uid: string,
  email: string,
  displayName?: string
) {
  try {
    const normalizedEmail = email.toLowerCase();
    const role = normalizedEmail === INITIAL_ADMIN_EMAIL ? 'admin' : 'reviewer';
    const name = displayName?.trim() || normalizedEmail.split('@')[0] || 'Researcher';

    const result = await db
      .insert(users)
      .values({
        uid,
        email: normalizedEmail,
        displayName: name,
        role,
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          email: normalizedEmail,
          displayName: name,
        },
      })
      .returning();

    return result[0];
  } catch (error) {
    console.error('Database user upsert failed:', error);
    throw new Error('Failed to synchronize reviewer profile.', { cause: error });
  }
}
