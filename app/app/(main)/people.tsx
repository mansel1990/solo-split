import { Stack, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  listMembers,
  restoreMember,
  saveMember,
  softDeleteMember,
  type Member,
} from '../../src/db/data';
import { normalizePhone, roundWeight } from '../../src/ids';
import { queueUndo, subscribeData } from '../../src/refresh';
import { scheduleSync } from '../../src/sync';
import { useSession } from '../../src/session';
import { fonts, usePalette } from '../../src/theme';
import { Field, PrimaryButton, UndoHost } from '../../src/ui';

export default function PeopleScreen() {
  const colors = usePalette();
  const { db } = useSession();
  const [members, setMembers] = useState<Member[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [familyId, setFamilyId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [kind, setKind] = useState<'person' | 'family'>('person');
  const [weight, setWeight] = useState('1');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setMembers(await listMembers(db));
  }, [db]);

  useFocusEffect(useCallback(() => {
    void reload();
    return subscribeData(() => { void reload(); });
  }, [reload]));

  function resetForm() {
    setEditing(null);
    setFamilyId(null);
    setName('');
    setPhone('');
    setKind('person');
    setWeight('1');
    setError(null);
  }

  function edit(member: Member) {
    setEditing(member.id);
    setFamilyId(member.family_id);
    setName(member.name);
    setPhone(member.phone ?? '');
    setKind(member.kind);
    setWeight(String(member.weight));
    setError(null);
  }

  async function onSave() {
    setBusy(true);
    setError(null);
    try {
      const parsedWeight = Number(weight);
      if (!Number.isFinite(parsedWeight)) throw new Error('Weight must be a number like 1 or 0.5');
      const selfEditing = members.some((member) => member.id === editing && member.is_self);
      await saveMember(db, {
        id: editing ?? undefined,
        name,
        kind: familyId || selfEditing ? 'person' : kind,
        phone: normalizePhone(phone),
        familyId,
        weight: roundWeight(parsedWeight),
      });
      resetForm();
      scheduleSync();
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  function onDelete(member: Member) {
    if (member.is_self) return;
    Alert.alert(`Remove ${member.name}?`, 'Past expenses keep their name. Undo is available for a few seconds.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            const deletedAt = await softDeleteMember(db, member.id);
            if (editing === member.id) resetForm();
            scheduleSync();
            queueUndo(`${member.name} removed`, () => restoreMember(db, member.id, deletedAt));
            await reload();
          })();
        },
      },
    ]);
  }

  const families = members.filter((member) => !member.family_id);
  const title = familyId ? 'Person in the family' : editing ? 'Edit person' : 'Add a person';

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: 'People' }} />
      <Text style={[styles.heading, { color: colors.text, fontFamily: fonts.heading }]}>{title}</Text>
      <Field label="Name" value={name} onChangeText={setName} placeholder="Ravi" />
      {familyId || members.some((member) => member.id === editing && member.is_self) ? null : (
        <View style={styles.chips}>
          <Chip label="Person" selected={kind === 'person'} onPress={() => setKind('person')} />
          <Chip label="Family" selected={kind === 'family'} onPress={() => setKind('family')} />
        </View>
      )}
      <Field label="Phone" value={phone} onChangeText={setPhone} placeholder="+91 98765 43210" keyboard="phone-pad" />
      <Field label="Weight" value={weight} onChangeText={setWeight} placeholder="1 or 0.5" keyboard="decimal-pad" />
      {error ? <Text style={[styles.error, { color: colors.negative, fontFamily: fonts.body }]}>{error}</Text> : null}
      <PrimaryButton label={editing ? 'Save' : 'Add'} onPress={() => { void onSave(); }} busy={busy} />
      {editing ? (
        <Pressable onPress={resetForm} style={styles.cancel}>
          <Text style={[styles.cancelLabel, { color: colors.textMuted, fontFamily: fonts.label }]}>Cancel</Text>
        </Pressable>
      ) : null}

      <View style={styles.list}>
        {families.map((member) => {
          const kids = members.filter((child) => child.family_id === member.id);
          return (
            <View key={member.id} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Pressable onPress={() => edit(member)}>
                <Text style={[styles.name, { color: colors.text, fontFamily: fonts.label }]}>
                  {member.name}{member.is_self ? ' (you)' : ''}{member.kind === 'family' ? ' · family' : ''}
                </Text>
                <Text style={[styles.meta, { color: colors.textMuted, fontFamily: fonts.body }]}>
                  {[member.phone, `weight ${member.weight}`].filter(Boolean).join(' · ')}
                </Text>
              </Pressable>
              {kids.map((child) => (
                <Pressable key={child.id} onPress={() => edit(child)} style={styles.child}>
                  <Text style={[styles.childName, { color: colors.text, fontFamily: fonts.body }]}>
                    {child.name} · {child.weight}
                  </Text>
                </Pressable>
              ))}
              <View style={styles.row}>
                {member.kind === 'family' ? (
                  <Pressable onPress={() => { resetForm(); setFamilyId(member.id); setKind('person'); }}>
                    <Text style={[styles.action, { color: colors.accent, fontFamily: fonts.label }]}>Add person</Text>
                  </Pressable>
                ) : null}
                {member.is_self ? null : (
                  <Pressable onPress={() => onDelete(member)}>
                    <Text style={[styles.action, { color: colors.negative, fontFamily: fonts.label }]}>Remove</Text>
                  </Pressable>
                )}
              </View>
            </View>
          );
        })}
      </View>
      <UndoHost />
    </ScrollView>
  );
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const colors = usePalette();
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.chip,
        {
          backgroundColor: selected ? colors.accent : colors.surface,
          borderColor: selected ? colors.accent : colors.border,
        },
      ]}
    >
      <Text style={{ color: selected ? colors.primary : colors.text, fontFamily: fonts.label }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 48 },
  heading: { fontSize: 22 },
  chips: { flexDirection: 'row', gap: 8, marginTop: 16 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  error: { marginTop: 12, fontSize: 14 },
  cancel: { marginTop: 12 },
  cancelLabel: { fontSize: 15 },
  list: { marginTop: 28, gap: 12 },
  card: { borderWidth: 1, borderRadius: 16, padding: 14 },
  name: { fontSize: 17 },
  meta: { marginTop: 4, fontSize: 13 },
  child: { marginTop: 8, marginLeft: 8 },
  childName: { fontSize: 15 },
  row: { flexDirection: 'row', gap: 16, marginTop: 12 },
  action: { fontSize: 14 },
});
