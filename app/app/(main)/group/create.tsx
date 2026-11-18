import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { createGroup, ensureSelf } from '../../../src/db/data';
import { loadProfile } from '../../../src/db/profile';
import { notifyDataChanged } from '../../../src/refresh';
import { scheduleSync } from '../../../src/sync';
import { useSession } from '../../../src/session';
import { fonts, usePalette } from '../../../src/theme';
import { Field, FormScroll, PrimaryButton } from '../../../src/ui';

export default function CreateGroupScreen() {
  const colors = usePalette();
  const router = useRouter();
  const { db } = useSession();
  const [name, setName] = useState('');
  const [split, setSplit] = useState<'per_head' | 'per_party'>('per_head');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSave() {
    setBusy(true);
    setError(null);
    try {
      const profile = await loadProfile(db);
      const selfId = await ensureSelf(db, profile?.name ?? 'Me');
      const id = await createGroup(db, name, split, selfId);
      notifyDataChanged();
      scheduleSync();
      router.replace({ pathname: '/group/[id]', params: { id } });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create the group');
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormScroll contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: 'New group' }} />
      <Field label="Name" value={name} onChangeText={setName} placeholder="Coorg trip" />
      <Text style={[styles.label, { color: colors.textMuted, fontFamily: fonts.label }]}>Default split</Text>
      <View style={styles.chips}>
        <Choice label="Per head" selected={split === 'per_head'} onPress={() => setSplit('per_head')} />
        <Choice label="Per party" selected={split === 'per_party'} onPress={() => setSplit('per_party')} />
      </View>
      <Text style={[styles.hint, { color: colors.textMuted, fontFamily: fonts.body }]}>
        You are added automatically. Add everyone else from the Parties tab.
      </Text>
      {error ? <Text style={[styles.error, { color: colors.negative, fontFamily: fonts.body }]}>{error}</Text> : null}
      <PrimaryButton label="Create group" onPress={() => { void onSave(); }} busy={busy} />
    </FormScroll>
  );
}

function Choice({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const colors = usePalette();
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.chip,
        { backgroundColor: selected ? colors.accent : colors.surface, borderColor: selected ? colors.accent : colors.border },
      ]}
    >
      <Text style={{ color: selected ? colors.primary : colors.text, fontFamily: fonts.label }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 40 },
  label: { marginTop: 16, marginBottom: 8, fontSize: 13 },
  chips: { flexDirection: 'row', gap: 8 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  hint: { marginTop: 16, fontSize: 14, lineHeight: 20 },
  error: { marginTop: 12, fontSize: 14 },
});
