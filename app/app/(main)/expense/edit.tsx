import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  getExpense,
  getGroup,
  getSelf,
  listMembers,
  listParties,
  listSplits,
  restoreExpense,
  saveExpense,
  softDeleteExpense,
  type Party,
} from '../../../src/db/data';
import { roundWeight, today } from '../../../src/ids';
import {
  formatINR,
  paiseToInput,
  parseINR,
  resolveSplit,
  type SplitType,
} from '../../../src/money';
import { notifyDataChanged, queueUndo } from '../../../src/refresh';
import { scheduleSync } from '../../../src/sync';
import { useSession } from '../../../src/session';
import { fonts, usePalette } from '../../../src/theme';
import { Field, FormScroll, PrimaryButton } from '../../../src/ui';

const CATEGORIES = ['Food', 'Stay', 'Travel', 'Drinks', 'Other'];

type PersonForm = { id: string; name: string; weight: number; included: boolean };
type PartyForm = {
  memberId: string;
  name: string;
  kind: 'person' | 'family';
  isSelf: boolean;
  included: boolean;
  weight: number;
  exact: string;
  shares: string;
  people: PersonForm[];
};
type Form = {
  amount: string;
  payerId: string;
  splitType: SplitType;
  note: string;
  category: string | null;
  spentOn: string;
  parties: PartyForm[];
};

export default function ExpenseEditScreen() {
  const colors = usePalette();
  const router = useRouter();
  const { db } = useSession();
  const params = useLocalSearchParams<{ groupId?: string; expenseId?: string }>();
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!params.groupId) return;
      const [group, parties, members, self, expense, splits] = await Promise.all([
        getGroup(db, params.groupId),
        listParties(db, params.groupId),
        listMembers(db),
        getSelf(db),
        params.expenseId ? getExpense(db, params.expenseId) : Promise.resolve(null),
        params.expenseId ? listSplits(db, params.expenseId) : Promise.resolve([]),
      ]);
      if (!active || !group) return;
      const splitByMember = new Map(splits.map((split) => [split.member_id, split]));
      const editing = Boolean(expense);
      const nextParties: PartyForm[] = parties.map((party) => partyForm(party, members, splitByMember.get(party.member_id), editing));
      const payer = expense?.paid_by
        ?? nextParties.find((party) => party.isSelf)?.memberId
        ?? self?.id
        ?? nextParties[0]?.memberId
        ?? '';
      setForm({
        amount: expense ? paiseToInput(expense.amount_paise) : '',
        payerId: payer,
        splitType: expense?.split_type ?? group.default_split,
        note: expense?.note ?? '',
        category: expense?.category ?? null,
        spentOn: expense?.spent_on ?? today(),
        parties: nextParties,
      });
    })().catch((caught) => {
      if (active) setError(caught instanceof Error ? caught.message : 'Could not open the expense');
    });
    return () => {
      active = false;
    };
  }, [db, params.expenseId, params.groupId]);

  const preview = useMemo(() => (form ? livePreview(form) : null), [form]);

  function patch(update: Partial<Form>) {
    setForm((current) => (current ? { ...current, ...update } : current));
  }

  function patchParty(memberId: string, update: (party: PartyForm) => PartyForm) {
    setForm((current) => {
      if (!current) return current;
      return {
        ...current,
        parties: current.parties.map((party) => (party.memberId === memberId ? update(party) : party)),
      };
    });
  }

  function chooseType(splitType: SplitType) {
    setForm((current) => {
      if (!current) return current;
      if (splitType !== 'exact' || current.parties.some((party) => party.exact.trim())) {
        return { ...current, splitType };
      }
      try {
        const amount = parseINR(current.amount);
        const included = current.parties.filter((party) => party.included);
        const resolved = resolveSplit(amount, 'per_party', included.map((party) => ({ memberId: party.memberId })));
        const owed = new Map(resolved.map((share) => [share.memberId, share.owedPaise]));
        return {
          ...current,
          splitType,
          parties: current.parties.map((party) => ({
            ...party,
            exact: owed.has(party.memberId) ? paiseToInput(owed.get(party.memberId)!) : party.exact,
          })),
        };
      } catch {
        return { ...current, splitType };
      }
    });
  }

  async function onSave() {
    if (!form || !params.groupId) return;
    setBusy(true);
    setError(null);
    try {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(form.spentOn)) throw new Error('Use a date like 2026-10-06');
      if (!form.payerId) throw new Error('Choose who paid');
      const built = livePreview(form);
      if (built.error || built.amount == null) throw new Error(built.error ?? 'Enter an amount');
      await saveExpense(db, {
        id: params.expenseId,
        groupId: params.groupId,
        paidBy: form.payerId,
        amountPaise: built.amount,
        splitType: form.splitType,
        note: form.note.trim() || null,
        category: form.category,
        spentOn: form.spentOn,
        splits: built.shares.map((share) => ({
          memberId: share.memberId,
          weight: share.weight,
          people: share.people,
          owedPaise: share.owedPaise,
        })),
      });
      notifyDataChanged();
      scheduleSync();
      router.back();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    if (!params.expenseId) return;
    const id = params.expenseId;
    await softDeleteExpense(db, id);
    notifyDataChanged();
    scheduleSync();
    queueUndo('Expense removed', () => restoreExpense(db, id));
    router.back();
  }

  return (
    <FormScroll contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: params.expenseId ? 'Edit expense' : 'Add expense' }} />
      {form ? (
        <>
          <Field label="Amount" value={form.amount} onChangeText={(amount) => patch({ amount })} placeholder="21000" keyboard="decimal-pad" />
          <Text style={[styles.label, { color: colors.textMuted, fontFamily: fonts.label }]}>Paid by</Text>
          <View style={styles.chips}>
            {form.parties.map((party) => (
              <Chip
                key={party.memberId}
                label={party.isSelf ? `${party.name} (you)` : party.name}
                selected={form.payerId === party.memberId}
                onPress={() => patch({ payerId: party.memberId })}
              />
            ))}
          </View>
          <Text style={[styles.label, { color: colors.textMuted, fontFamily: fonts.label }]}>Split</Text>
          <View style={styles.chips}>
            <Chip label="Per head" selected={form.splitType === 'per_head'} onPress={() => chooseType('per_head')} />
            <Chip label="Per party" selected={form.splitType === 'per_party'} onPress={() => chooseType('per_party')} />
            <Chip label="Exact" selected={form.splitType === 'exact'} onPress={() => chooseType('exact')} />
            <Chip label="Shares" selected={form.splitType === 'shares'} onPress={() => chooseType('shares')} />
          </View>
          {form.parties.map((party) => (
            <View key={party.memberId} style={[styles.party, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              <View style={styles.partyHead}>
                <Pressable onPress={() => patchParty(party.memberId, (current) => ({ ...current, included: !current.included }))}>
                  <Text style={[styles.partyName, { color: colors.text, fontFamily: fonts.label }]}>
                    {party.included ? '✓ ' : '○ '}{party.name}
                  </Text>
                </Pressable>
                {preview?.owed.get(party.memberId) != null ? (
                  <Text style={[styles.owed, { color: colors.text, fontFamily: fonts.label }]}>
                    {formatINR(preview.owed.get(party.memberId)!)}
                  </Text>
                ) : null}
              </View>
              {party.included && form.splitType === 'per_head' ? (
                party.people.length > 0 ? (
                  <View style={styles.people}>
                    {party.people.map((person) => (
                      <Pressable
                        key={person.id}
                        onPress={() => patchParty(party.memberId, (current) => ({
                          ...current,
                          people: current.people.map((item) => (
                            item.id === person.id ? { ...item, included: !item.included } : item
                          )),
                        }))}
                      >
                        <Text style={{ color: colors.text, fontFamily: fonts.body }}>
                          {person.included ? '✓ ' : '○ '}{person.name} · {person.weight}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                ) : (
                  <Stepper
                    value={party.weight}
                    onChange={(weight) => patchParty(party.memberId, (current) => ({ ...current, weight }))}
                  />
                )
              ) : null}
              {party.included && form.splitType === 'shares' ? (
                <Field
                  label="Shares"
                  value={party.shares}
                  onChangeText={(shares) => patchParty(party.memberId, (current) => ({ ...current, shares }))}
                  keyboard="decimal-pad"
                />
              ) : null}
              {party.included && form.splitType === 'exact' ? (
                <Field
                  label="Owes"
                  value={party.exact}
                  onChangeText={(exact) => patchParty(party.memberId, (current) => ({ ...current, exact }))}
                  keyboard="decimal-pad"
                />
              ) : null}
            </View>
          ))}
          <Text style={[styles.label, { color: colors.textMuted, fontFamily: fonts.label }]}>Category</Text>
          <View style={styles.chips}>
            {CATEGORIES.map((category) => (
              <Chip
                key={category}
                label={category}
                selected={form.category === category}
                onPress={() => patch({ category: form.category === category ? null : category })}
              />
            ))}
          </View>
          <Field label="Note" value={form.note} onChangeText={(note) => patch({ note })} placeholder="Hotel" />
          <Field label="Date" value={form.spentOn} onChangeText={(spentOn) => patch({ spentOn })} placeholder="2026-10-06" />
          {preview?.error ? <Text style={[styles.error, { color: colors.negative, fontFamily: fonts.body }]}>{preview.error}</Text> : null}
          {error ? <Text style={[styles.error, { color: colors.negative, fontFamily: fonts.body }]}>{error}</Text> : null}
          <PrimaryButton label="Save expense" onPress={() => { void onSave(); }} busy={busy} />
          {params.expenseId ? (
            <Pressable onPress={() => { void onDelete(); }} style={styles.delete}>
              <Text style={[styles.deleteLabel, { color: colors.negative, fontFamily: fonts.label }]}>Delete expense</Text>
            </Pressable>
          ) : null}
        </>
      ) : (
        <Text style={{ color: colors.textMuted, fontFamily: fonts.body }}>{error ?? 'Loading…'}</Text>
      )}
    </FormScroll>
  );
}

function partyForm(
  party: Party,
  members: { id: string; name: string; family_id: string | null; weight: number }[],
  split: { weight: number | null; people: string | null; owed_paise: number } | undefined,
  editing: boolean,
): PartyForm {
  const savedPeople = parsePeople(split?.people ?? null);
  const people = members
    .filter((member) => member.family_id === party.member_id)
    .map((member) => ({
      id: member.id,
      name: member.name,
      weight: member.weight,
      included: savedPeople.length > 0 ? savedPeople.includes(member.id) : true,
    }));
  const weight = split?.weight ?? party.weight ?? party.member_weight ?? 1;
  return {
    memberId: party.member_id,
    name: party.name,
    kind: party.kind,
    isSelf: party.is_self === 1,
    included: editing ? Boolean(split) : true,
    weight,
    exact: split ? paiseToInput(split.owed_paise) : '',
    shares: String(weight),
    people,
  };
}

function parsePeople(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function headcount(party: PartyForm): number {
  if (party.people.length > 0) {
    return roundWeight(party.people.filter((person) => person.included).reduce((sum, person) => sum + person.weight, 0));
  }
  return party.weight;
}

function livePreview(form: Form): {
  error: string | null;
  amount: number | null;
  owed: Map<string, number>;
  shares: { memberId: string; weight: number | null; people: string[]; owedPaise: number }[];
} {
  const empty = { error: null, amount: null, owed: new Map<string, number>(), shares: [] };
  if (!form.amount.trim()) return empty;
  let amount: number;
  try {
    amount = parseINR(form.amount);
  } catch {
    return { ...empty, error: 'Enter an amount like 21000 or 49.75' };
  }
  if (amount <= 0) return { ...empty, error: 'Amount must be greater than 0' };
  const included = form.parties.filter((party) => party.included);
  if (included.length === 0) return { ...empty, error: 'Choose who shares this', amount };
  try {
    if (form.splitType === 'per_head') {
      for (const party of included) {
        if (headcount(party) <= 0) return { ...empty, error: `Pick at least one person in ${party.name}`, amount };
      }
    }
    const parties = included.map((party) => {
      if (form.splitType === 'exact') {
        const owedPaise = party.exact.trim() ? parseINR(party.exact) : 0;
        return { memberId: party.memberId, owedPaise };
      }
      if (form.splitType === 'shares') {
        const weight = Number(party.shares);
        if (!Number.isFinite(weight) || weight <= 0) throw new Error(`Enter shares for ${party.name}`);
        return { memberId: party.memberId, weight: roundWeight(weight) };
      }
      if (form.splitType === 'per_head') return { memberId: party.memberId, weight: headcount(party) };
      return { memberId: party.memberId };
    });
    const resolved = resolveSplit(amount, form.splitType, parties);
    return {
      error: null,
      amount,
      owed: new Map(resolved.map((share) => [share.memberId, share.owedPaise])),
      shares: resolved.map((share) => {
        const party = included.find((item) => item.memberId === share.memberId);
        const people = party?.people.filter((person) => person.included).map((person) => person.id) ?? [];
        return {
          memberId: share.memberId,
          weight: share.weight,
          people: form.splitType === 'per_head' ? people : [],
          owedPaise: share.owedPaise,
        };
      }),
    };
  } catch (caught) {
    return { ...empty, amount, error: caught instanceof Error ? caught.message : 'This split needs a change' };
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

function Stepper({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const colors = usePalette();
  return (
    <View style={styles.stepper}>
      <Pressable onPress={() => onChange(roundWeight(Math.max(0.5, value - 0.5)))} style={[styles.step, { borderColor: colors.border }]}>
        <Text style={{ color: colors.text, fontFamily: fonts.label }}>−</Text>
      </Pressable>
      <Text style={{ color: colors.text, fontFamily: fonts.label }}>{value}</Text>
      <Pressable onPress={() => onChange(roundWeight(value + 0.5))} style={[styles.step, { borderColor: colors.border }]}>
        <Text style={{ color: colors.text, fontFamily: fonts.label }}>+</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 48 },
  label: { marginTop: 18, marginBottom: 8, fontSize: 13 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  party: { marginTop: 12, borderWidth: 1, borderRadius: 16, padding: 12 },
  partyHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  partyName: { fontSize: 16 },
  owed: { fontSize: 15 },
  people: { marginTop: 8, gap: 6 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8 },
  step: { borderWidth: 1, borderRadius: 8, width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  error: { marginTop: 12, fontSize: 14 },
  delete: { marginTop: 18 },
  deleteLabel: { fontSize: 16 },
});
