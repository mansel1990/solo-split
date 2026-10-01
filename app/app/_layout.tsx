import {
  Poppins_400Regular,
  Poppins_600SemiBold,
  Poppins_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/poppins';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';
import { SessionProvider } from '../src/session';
import { fonts, ThemeProvider, usePalette } from '../src/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Poppins_400Regular,
    Poppins_600SemiBold,
    Poppins_800ExtraBold,
  });

  if (!fontsLoaded && !fontError) return null;

  return (
    <ThemeProvider>
      <SessionProvider>
        <BootedShell />
      </SessionProvider>
    </ThemeProvider>
  );
}

function BootedShell() {
  const colors = usePalette();
  const scheme = useColorScheme();

  useEffect(() => {
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        initialRouteName="(main)"
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
          headerTitleStyle: { fontFamily: fonts.heading, color: colors.text },
          headerShadowVisible: false,
        }}
      >
        <Stack.Screen name="sign-in" />
        <Stack.Screen name="(main)" />
      </Stack>
    </>
  );
}
