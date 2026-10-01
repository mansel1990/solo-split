import { Redirect, Stack } from 'expo-router';
import { useSession } from '../../src/session';
import { fonts, usePalette } from '../../src/theme';

export default function MainLayout() {
  const { jwt } = useSession();
  const colors = usePalette();
  if (!jwt) return <Redirect href="/sign-in" />;
  return (
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
  );
}
