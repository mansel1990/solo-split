import { brand } from '../../shared/theme';
import { Redirect } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, useColorScheme, View } from 'react-native';
import { useSession } from '../src/session';
import { fonts, usePalette } from '../src/theme';

export default function SignInScreen() {
  const { jwt, signIn } = useSession();
  const colors = usePalette();
  const scheme = useColorScheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (jwt) return <Redirect href="/(main)" />;

  async function onPress() {
    setBusy(true);
    setError(null);
    try {
      await signIn();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <Image
        source={scheme === 'dark'
          ? require('../assets/wordmark-light.png')
          : require('../assets/wordmark-dark.png')}
        style={styles.wordmark}
        resizeMode="contain"
        accessibilityLabel={brand.name}
      />
      <Text style={[styles.tagline, { color: colors.text, fontFamily: fonts.label }]}>{brand.tagline}</Text>
      <Text style={[styles.copy, { color: colors.textMuted, fontFamily: fonts.body }]}>
        One person logs the shared expenses. Everyone else opens a link.
      </Text>
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={() => { void onPress(); }}
        style={[styles.button, { backgroundColor: colors.accent, opacity: busy ? 0.6 : 1 }]}
      >
        {busy
          ? <ActivityIndicator color={colors.primary} />
          : <Text style={[styles.buttonLabel, { color: colors.primary, fontFamily: fonts.label }]}>Sign in with Google</Text>}
      </Pressable>
      {error ? <Text style={[styles.error, { color: colors.negative, fontFamily: fonts.body }]}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  wordmark: { width: 240, height: 64, marginBottom: 16 },
  tagline: { fontSize: 18, textAlign: 'center' },
  copy: { marginTop: 8, fontSize: 15, textAlign: 'center', lineHeight: 22 },
  button: {
    marginTop: 28,
    minHeight: 52,
    paddingHorizontal: 22,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonLabel: { fontSize: 16 },
  error: { marginTop: 16, textAlign: 'center', lineHeight: 22 },
});
