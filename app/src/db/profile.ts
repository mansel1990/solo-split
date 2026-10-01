import type { SQLiteDatabase } from 'expo-sqlite';

export type Profile = {
  id: string;
  email: string;
  name: string | null;
  upi_vpa: string | null;
};

export async function saveProfile(db: SQLiteDatabase, profile: Profile): Promise<void> {
  await db.runAsync('delete from users');
  await db.runAsync(
    'insert into users (id, email, name, upi_vpa) values (?, ?, ?, ?)',
    profile.id,
    profile.email,
    profile.name,
    profile.upi_vpa,
  );
}

export async function loadProfile(db: SQLiteDatabase): Promise<Profile | null> {
  return db.getFirstAsync<Profile>('select id, email, name, upi_vpa from users limit 1');
}

/** Drop the signed-in owner's local rows so the next account starts empty. */
export async function clearLocalData(db: SQLiteDatabase): Promise<void> {
  await db.execAsync('BEGIN');
  try {
    await db.execAsync(`
      delete from expense_splits;
      delete from settlements;
      delete from share_links;
      delete from group_members;
      delete from expenses;
      delete from groups;
      delete from members where family_id is not null;
      delete from members;
      delete from users;
      update sync_state set cursor = 0 where id = 1;
    `);
    await db.execAsync('COMMIT');
  } catch (error) {
    await db.execAsync('ROLLBACK');
    throw error;
  }
}
