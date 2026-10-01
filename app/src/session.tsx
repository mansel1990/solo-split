import {
  GoogleSignin,
  isErrorWithCode,
  statusCodes,
} from '@react-native-google-signin/google-signin';
import * as SecureStore from 'expo-secure-store';
import * as SplashScreen from 'expo-splash-screen';
import * as SQLite from 'expo-sqlite';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Text, View } from 'react-native';
import { exchangeGoogleIdToken } from './api';
import { googleWebClientId } from './config';
import { migrate } from './db/migrations';
import { clearLocalData, saveProfile } from './db/profile';

const JWT_KEY = 'allsquare.jwt';

type SessionValue = {
  jwt: string | null;
  db: SQLite.SQLiteDatabase;
  signIn: () => Promise<'ok' | 'cancelled'>;
  signOut: () => Promise<void>;
};

const SessionContext = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}

type Boot =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; db: SQLite.SQLiteDatabase; jwt: string | null };

export function SessionProvider({ children }: { children: ReactNode }) {
  const [boot, setBoot] = useState<Boot>({ status: 'loading' });
  const [jwt, setJwt] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        GoogleSignin.configure({ webClientId: googleWebClientId() });
        const db = await SQLite.openDatabaseAsync('allsquare.db');
        await db.execAsync('PRAGMA foreign_keys = ON');
        await migrate(db);
        const stored = await SecureStore.getItemAsync(JWT_KEY);
        if (cancelled) return;
        setJwt(stored);
        setBoot({ status: 'ready', db, jwt: stored });
      } catch (error) {
        if (cancelled) return;
        SplashScreen.hideAsync().catch(() => {});
        setBoot({
          status: 'error',
          message: error instanceof Error ? error.message : 'The app could not start',
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const db = boot.status === 'ready' ? boot.db : null;

  const signIn = useCallback(async (): Promise<'ok' | 'cancelled'> => {
    if (!db) throw new Error('The local database is not open yet');
    try {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      const response = await GoogleSignin.signIn();
      if (response.type !== 'success') return 'cancelled';
      const idToken = response.data.idToken;
      if (!idToken) {
        throw new Error('Google did not return an ID token. Check the web client id in the app config.');
      }
      const result = await exchangeGoogleIdToken(idToken);
      await SecureStore.setItemAsync(JWT_KEY, result.jwt);
      await saveProfile(db, result.user);
      setJwt(result.jwt);
      return 'ok';
    } catch (error) {
      if (isErrorWithCode(error) && error.code === statusCodes.SIGN_IN_CANCELLED) {
        return 'cancelled';
      }
      if (isErrorWithCode(error)) {
        const detail = error.message || 'Google sign-in failed';
        if (error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
          throw new Error('Google Play Services is not available on this phone.');
        }
        throw new Error(
          `${detail} (${error.code}). If this is DEVELOPER_ERROR, the Android OAuth client SHA-1 does not match this build.`,
        );
      }
      throw error;
    }
  }, [db]);

  const signOut = useCallback(async () => {
    if (!db) return;
    await SecureStore.deleteItemAsync(JWT_KEY);
    try {
      await GoogleSignin.signOut();
    } catch {
      // The session can exist from the stored JWT without a Google session.
    }
    await clearLocalData(db);
    setJwt(null);
  }, [db]);

  const value = useMemo<SessionValue | null>(() => {
    if (!db) return null;
    return { jwt, db, signIn, signOut };
  }, [db, jwt, signIn, signOut]);

  if (boot.status === 'error') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#F3F6FA' }}>
        <Text style={{ color: '#0B1F3A', textAlign: 'center' }}>{boot.message}</Text>
      </View>
    );
  }
  if (!value) return null;
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
