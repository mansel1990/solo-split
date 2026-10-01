import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { getMe, patchMe } from '../../src/api';
import { loadProfile, saveProfile, type Profile } from '../../src/db/profile';
import { useSession } from '../../src/session';
import { fonts, usePalette } from '../../src/theme';

export default function SettingsScreen() {
  const colors = usePalette();
  const { jwt, db, signOut } = useSession();
  const [name, setName] = useState('');
  const [upi, setUpi] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!jwt) return;
    let active = true;
    (async () => {
      const cached = await loadProfile(db);
      if (!active) return;
      applyProfile(cached);
      try {
        const fresh = await getMe(jwt);
        await saveProfile(db, fresh);
        if (!active) return;
        applyProfile(fresh);
      } catch (caught) {
        if (!active || cached) return;
        setError(caught instanceof Error ? caught.message : 'Could not load your profile');
      }
    })().catch(() => {});
    return () => {
      active = false;
    };

    function applyProfile(profile: Profile | null) {
      if (!profile) return;
      setName(profile.name ?? '');
      setUpi(profile.upi_vpa ?? '');
      setEmail(profile.email);
    }
  }, [db, jwt]);

  async function onSave() {
    if (!jwt) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Name is required');
      setSaved(false);
      return;
    }
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const updated = await patchMe(jwt, {
        name: trimmed,
        upi_vpa: upi.trim() === '' ? null : upi.trim(),
      });
      await saveProfile(db, updated);
      setName(updated.name ?? '');
      setUpi(updated.upi_vpa ?? '');
      setSaved(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <Text style={[styles.label, { color: colors.textMuted, fontFamily: fonts.label }]}>Name</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        autoCapitalize="words"
        placeholder="Your name"
        placeholderTextColor={colors.textMuted}
        style={[styles.input, inputStyle(colors)]}
      />
      <Text style={[styles.label, { color: colors.textMuted, fontFamily: fonts.label }]}>UPI ID</Text>
      <TextInput
        value={upi}
        onChangeText={setUpi}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="name@upi"
        placeholderTextColor={colors.textMuted}
        style={[styles.input, inputStyle(colors)]}
      />
      {email ? <Text style={[styles.email, { color: colors.textMuted, fontFamily: fonts.body }]}>{email}</Text> : null}
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={() => { void onSave(); }}
        style={[styles.button, { backgroundColor: colors.accent, opacity: busy ? 0.6 : 1 }]}
      >
        {busy
          ? <ActivityIndicator color={colors.primary} />
          : <Text style={[styles.buttonLabel, { color: colors.primary, fontFamily: fonts.label }]}>Save</Text>}
      </Pressable>
      {saved ? <Text style={[styles.note, { color: colors.text, fontFamily: fonts.body }]}>Saved</Text> : null}
      {error ? <Text style={[styles.note, { color: colors.negative, fontFamily: fonts.body }]}>{error}</Text> : null}
      <Pressable accessibilityRole="button" onPress={() => { void signOut(); }} style={styles.signOut}>
        <Text style={[styles.signOutLabel, { color: colors.text, fontFamily: fonts.label }]}>Sign out</Text>
      </Pressable>
    </View>
  );
}

function inputStyle(colors: { text: string; surface: string; border: string }) {
  return {
    color: colors.text,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    fontFamily: fonts.body,
  };
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 20 },
  label: { marginTop: 16, marginBottom: 8, fontSize: 13 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  email: { marginTop: 12, fontSize: 14 },
  button: {
    marginTop: 24,
    minHeight: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonLabel: { fontSize: 16 },
  note: { marginTop: 12, fontSize: 14 },
  signOut: { marginTop: 28, alignSelf: 'flex-start' },
  signOutLabel: { fontSize: 16 },
});
