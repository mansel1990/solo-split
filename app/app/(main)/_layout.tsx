import { Redirect, Stack } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, AppState, Text, View } from 'react-native';
import { ensureSelf, getSelf } from '../../src/db/data';
import { loadProfile } from '../../src/db/profile';
import { useSession } from '../../src/session';
import { bindSync, syncNow, unbindSync } from '../../src/sync';
import { fonts, usePalette } from '../../src/theme';

function Ready({ children }: { children: ReactNode }) {
  const colors = usePalette();
  const { db, jwt } = useSession();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!jwt) {
        unbindSync();
        if (active) setReady(true);
        return;
      }
      bindSync(db, jwt);
      const profile = await loadProfile(db);
      const name = profile?.name?.trim() || 'Me';
      const self = await getSelf(db);
      if (!self) await syncNow();
      await ensureSelf(db, name);
      if (active) setReady(true);
      void syncNow();
    })().catch((caught) => {
      if (active) setError(caught instanceof Error ? caught.message : 'Could not open your data');
    });
    return () => {
      active = false;
    };
  }, [db, jwt]);

  useEffect(() => {
    if (!jwt) return undefined;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void syncNow();
    });
    return () => subscription.remove();
  }, [jwt]);

  if (error) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: colors.background }}>
        <Text style={{ color: colors.text, textAlign: 'center', fontFamily: fonts.body }}>{error}</Text>
      </View>
    );
  }
  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }
  return children;
}

export default function MainLayout() {
  const { jwt } = useSession();
  const colors = usePalette();
  if (!jwt) return <Redirect href="/sign-in" />;
  return (
    <Ready>
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        headerTitleStyle: { fontFamily: fonts.heading, color: colors.text },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'AllSquare' }} />
      <Stack.Screen name="settings" options={{ title: 'Settings' }} />
    </Stack>
    </Ready>
  );
}
