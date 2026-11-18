import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { listParties, saveSettlement, type Party } from '../../src/db/data';
import { today } from '../../src/ids';
import { formatINR, memberLabel, paiseToInput, parseINR } from '../../src/money';
import { notifyDataChanged } from '../../src/refresh';
import { scheduleSync } from '../../src/sync';
import { useSession } from '../../src/session';
import { fonts, usePalette } from '../../src/theme';
import { Field, PrimaryButton } from '../../src/ui';

export default function SettleScreen() {
  const colors = usePalette();
  const router = useRouter();
  const { db } = useSession();
  const params = useLocalSearchParams<{ groupId?: string; fromId?: string; toId?: string; amount?: string }>();
  const [parties, setParties] = useState<Party[]>([]);
  const [fromId, setFromId] = useState(params.fromId ?? '');
  const [toId, setToId] = useState(params.toId ?? '');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [paidOn, setPaidOn] = useState(today());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setFromId(typeof params.fromId === 'string' ? params.fromId : '');
    setToId(typeof params.toId === 'string' ? params.toId : '');
    const amountPaise = Number(params.amount ?? '');
    setAmount(Number.isSafeInteger(amountPaise) && amountPaise > 0 ? paiseToInput(amountPaise) : '');
  }, [params.amount, params.fromId, params.toId]);

  useEffect(() => {
    if (!params.groupId) return;
    let active = true;
    listParties(db, params.groupId).then((rows) => {
      if (active) setParties(rows);
    }).catch((caught) => {
      if (active) setError(caught instanceof Error ? caught.message : 'Could not load people');
    });
    return () => {
      active = false;
    };
  }, [db, params.groupId]);

  const fromName = partyName(parties, fromId);
  const toName = partyName(parties, toId);

  function chooseFrom(id: string) {
    setFromId(id);
    if (toId === id) setToId('');
  }

  function chooseTo(id: string) {
    setToId(id);
    if (fromId === id) setFromId('');
  }

  async function onSave() {
    if (!params.groupId) {
      setError('This payment is missing a group');
      return;
    }
    if (!fromId || !toId) {
      setError('Choose who paid and who received it');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn)) throw new Error('Use a date like 2026-10-06');
      const amountPaise = parseINR(amount);
      if (amountPaise <= 0) throw new Error('Amount must be greater than 0');
      await saveSettlement(db, {
        groupId: params.groupId,
        fromMember: fromId,
        toMember: toId,
        amountPaise,
        note: note.trim() || null,
        paidOn,
      });
      notifyDataChanged();
      scheduleSync();
      router.back();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not record the payment');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: 'Record payment' }} />
      <Text style={[styles.line, { color: colors.text, fontFamily: fonts.heading }]}>
        {fromName && toName ? `${fromName} pays ${toName}` : 'Who paid whom'}
      </Text>
      <Text style={[styles.label, { color: colors.textMuted, fontFamily: fonts.label }]}>Paid</Text>
      <View style={styles.chips}>
        {parties.map((party) => (
          <Chip
            key={party.member_id}
            label={memberLabel(party.name, party.is_self === 1)}
            selected={fromId === party.member_id}
            onPress={() => chooseFrom(party.member_id)}
          />
        ))}
      </View>
      <Text style={[styles.label, { color: colors.textMuted, fontFamily: fonts.label }]}>Received</Text>
      <View style={styles.chips}>
        {parties.map((party) => (
          <Chip
            key={party.member_id}
            label={memberLabel(party.name, party.is_self === 1)}
            selected={toId === party.member_id}
            onPress={() => chooseTo(party.member_id)}
          />
        ))}
      </View>
      <Field label="Amount" value={amount} onChangeText={setAmount} placeholder="6000" keyboard="decimal-pad" />
      <Field label="Date" value={paidOn} onChangeText={setPaidOn} placeholder="2026-10-06" />
      <Field label="Note" value={note} onChangeText={setNote} placeholder="Advance for the stay" />
      {amount.trim() ? (
        <Text style={[styles.preview, { color: colors.textMuted, fontFamily: fonts.body }]}>
          {preview(amount)}
        </Text>
      ) : null}
      {error ? <Text style={[styles.error, { color: colors.negative, fontFamily: fonts.body }]}>{error}</Text> : null}
      <PrimaryButton label="Save payment" onPress={() => { void onSave(); }} busy={busy} />
    </ScrollView>
  );
}

function partyName(parties: Party[], id: string): string {
  const party = parties.find((item) => item.member_id === id);
  if (!party) return '';
  return memberLabel(party.name, party.is_self === 1);
}

function preview(amount: string): string {
  try {
    const paise = parseINR(amount);
    if (paise <= 0) return 'Amount must be greater than 0';
    return formatINR(paise);
  } catch {
    return 'Enter an amount like 6000 or 49.75';
  }
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
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
  line: { fontSize: 22 },
  label: { marginTop: 18, marginBottom: 8, fontSize: 13 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  preview: { marginTop: 12, fontSize: 14 },
  error: { marginTop: 12, fontSize: 14 },
});
