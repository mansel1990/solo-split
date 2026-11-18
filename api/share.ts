import type { PoolClient } from '@neondatabase/serverless';
import { computeBalances } from '../shared/balances.js';
import { simplifyDebts } from '../shared/debts.js';
import { formatINR, formatSignedINR } from '../shared/formatINR.js';
import { theme, brand } from '../shared/theme.js';
import type { BalanceExpense, BalanceSettlement, Transfer } from '../shared/types.js';
import { withTransaction } from './_lib/db.js';
import { HttpError } from './_lib/errors.js';
import { api } from './_lib/http.js';

const colors = theme.dark;
const mark = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="56" height="56" aria-hidden="true"><rect width="200" height="200" rx="46" fill="${theme.light.primary}"/><g transform="translate(-2,-9)"><circle cx="68" cy="80" r="13" fill="${theme.light.accent}"/><path d="M120 82 Q134 68 148 82" stroke="${theme.light.accent}" stroke-width="10" fill="none" stroke-linecap="round"/><path d="M56 122 L86 150 L140 108" stroke="${theme.light.accent}" stroke-width="18" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g></svg>`;

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inactivePage(): string {
  return shell('Link no longer active', '<p>Link no longer active.</p>');
}

function shell(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>${esc(title)}</title>
  <style>
    body { margin: 0; background: ${colors.background}; color: ${colors.text}; font-family: Poppins, system-ui, sans-serif; }
    main { max-width: 560px; margin: 0 auto; padding: 28px 20px 64px; }
    h1 { font-size: 28px; margin: 16px 0 4px; }
    h2 { font-size: 18px; margin: 28px 0 8px; }
    p, li { color: ${colors.textMuted}; line-height: 1.45; }
    ul { list-style: none; padding: 0; margin: 0; }
    li { background: ${colors.surface}; border-radius: 14px; padding: 12px 14px; margin-top: 8px; color: ${colors.text}; }
    .pos { color: ${colors.positive}; }
    .neg { color: ${colors.negative}; }
    a.pay { display: inline-block; margin-top: 16px; background: ${colors.accent}; color: ${colors.primary}; text-decoration: none; font-weight: 600; border-radius: 14px; padding: 14px 18px; }
    .brand { color: ${colors.accent}; font-weight: 600; margin-top: 28px; }
  </style>
</head>
<body>
  <main>
    ${mark}
    ${body}
    <p class="brand">${esc(brand.name)}</p>
  </main>
</body>
</html>`;
}

function moneyClass(paise: number): string {
  if (paise > 0) return 'pos';
  if (paise < 0) return 'neg';
  return '';
}

function upiLink(vpa: string, payee: string, paise: number, note: string): string {
  const params = new URLSearchParams({
    pa: vpa,
    pn: payee,
    am: (paise / 100).toFixed(2),
    cu: 'INR',
    tn: note.slice(0, 80),
  });
  return `upi://pay?${params.toString()}`;
}

type GroupSection = {
  id: string;
  name: string;
  nets: Record<string, number>;
  transfers: Transfer[];
  history: string[];
};

async function loadPage(client: PoolClient, token: string): Promise<string | null> {
  const linkResult = await client.query(
    `select sl.user_id, sl.group_id, sl.member_id, u.name as owner_name, u.upi_vpa
     from allsquare.share_links sl
     join allsquare.users u on u.id = sl.user_id
     where sl.token = $1 and sl.revoked_at is null`,
    [token],
  );
  const link = linkResult.rows[0] as {
    user_id: string;
    group_id: string | null;
    member_id: string | null;
    owner_name: string | null;
    upi_vpa: string | null;
  } | undefined;
  if (!link) return null;

  const memberRows = await client.query(
    `select id, name, is_self from allsquare.members where user_id = $1`,
    [link.user_id],
  );
  const names = new Map<string, string>();
  let selfId: string | null = null;
  let selfName = link.owner_name || 'AllSquare';
  for (const row of memberRows.rows as { id: string; name: string; is_self: boolean }[]) {
    names.set(row.id, row.name);
    if (row.is_self) {
      selfId = row.id;
      if (!link.owner_name) selfName = row.name;
    }
  }
  const label = (id: string) => names.get(id) ?? 'Someone';

  let groups: { id: string; name: string }[] = [];
  if (link.group_id) {
    const groupResult = await client.query(
      `select id, name from allsquare.groups where id = $1 and user_id = $2 and deleted_at is null`,
      [link.group_id, link.user_id],
    );
    const group = groupResult.rows[0] as { id: string; name: string } | undefined;
    if (!group) return null;
    groups = [group];
  } else if (link.member_id) {
    const groupResult = await client.query(
      `select distinct g.id, g.name
       from allsquare.groups g
       where g.user_id = $1 and g.deleted_at is null and (
         g.id in (select group_id from allsquare.group_members where user_id = $1 and member_id = $2)
         or g.id in (select group_id from allsquare.expenses where user_id = $1 and paid_by = $2 and deleted_at is null)
         or g.id in (
           select e.group_id from allsquare.expense_splits s
           join allsquare.expenses e on e.id = s.expense_id
           where e.user_id = $1 and s.member_id = $2 and e.deleted_at is null
         )
         or g.id in (
           select group_id from allsquare.settlements
           where user_id = $1 and deleted_at is null and (from_member = $2 or to_member = $2)
         )
       )
       order by g.name`,
      [link.user_id, link.member_id],
    );
    groups = groupResult.rows as { id: string; name: string }[];
  } else {
    return null;
  }

  if (link.member_id) {
    const member = (memberRows.rows as { id: string; deleted_at?: string | null }[])
      .find((row) => row.id === link.member_id);
    if (!member) return null;
  }

  const groupIds = groups.map((group) => group.id);
  const expenses = groupIds.length === 0 ? [] : (await client.query(
    `select id, group_id, paid_by, amount_paise, note, category, spent_on
     from allsquare.expenses
     where user_id = $1 and deleted_at is null and group_id = any($2::uuid[])
     order by spent_on desc, created_at desc`,
    [link.user_id, groupIds],
  )).rows as {
    id: string;
    group_id: string;
    paid_by: string;
    amount_paise: number;
    note: string | null;
    category: string | null;
    spent_on: string;
  }[];

  const expenseIds = expenses.map((expense) => expense.id);
  const splits = expenseIds.length === 0 ? [] : (await client.query(
    `select expense_id, member_id, owed_paise
     from allsquare.expense_splits
     where expense_id = any($1::uuid[])`,
    [expenseIds],
  )).rows as { expense_id: string; member_id: string; owed_paise: number }[];

  const settlements = groupIds.length === 0 ? [] : (await client.query(
    `select group_id, from_member, to_member, amount_paise, note, paid_on
     from allsquare.settlements
     where user_id = $1 and deleted_at is null and group_id = any($2::uuid[])
     order by paid_on desc`,
    [link.user_id, groupIds],
  )).rows as {
    group_id: string;
    from_member: string;
    to_member: string;
    amount_paise: number;
    note: string | null;
    paid_on: string;
  }[];

  const parties = groupIds.length === 0 ? [] : (await client.query(
    `select group_id, member_id from allsquare.group_members
     where user_id = $1 and deleted_at is null and group_id = any($2::uuid[])`,
    [link.user_id, groupIds],
  )).rows as { group_id: string; member_id: string }[];

  const splitsByExpense = new Map<string, { memberId: string; owedPaise: number }[]>();
  for (const split of splits) {
    const list = splitsByExpense.get(split.expense_id) ?? [];
    list.push({ memberId: split.member_id, owedPaise: Number(split.owed_paise) });
    splitsByExpense.set(split.expense_id, list);
  }

  const sections: GroupSection[] = groups.map((group) => {
    const groupExpenses: BalanceExpense[] = expenses
      .filter((expense) => expense.group_id === group.id)
      .map((expense) => ({
        paidBy: expense.paid_by,
        amountPaise: Number(expense.amount_paise),
        splits: splitsByExpense.get(expense.id) ?? [],
      }));
    const groupSettlements: BalanceSettlement[] = settlements
      .filter((row) => row.group_id === group.id)
      .map((row) => ({
        fromMemberId: row.from_member,
        toMemberId: row.to_member,
        amountPaise: Number(row.amount_paise),
      }));
    const nets = computeBalances(groupExpenses, groupSettlements);
    for (const party of parties) {
      if (party.group_id === group.id && nets[party.member_id] == null) nets[party.member_id] = 0;
    }
    let transfers: Transfer[] = [];
    try {
      transfers = simplifyDebts(nets);
    } catch {
      transfers = [];
    }
    const history = [
      ...expenses.filter((expense) => expense.group_id === group.id).map((expense) => ({
        on: String(expense.spent_on).slice(0, 10),
        text: `${label(expense.paid_by)} paid ${formatINR(Number(expense.amount_paise))}${expense.note ? ` · ${expense.note}` : expense.category ? ` · ${expense.category}` : ''}`,
      })),
      ...settlements.filter((row) => row.group_id === group.id).map((row) => ({
        on: String(row.paid_on).slice(0, 10),
        text: `${label(row.from_member)} paid ${label(row.to_member)} ${formatINR(Number(row.amount_paise))}`,
      })),
    ].sort((a, b) => b.on.localeCompare(a.on)).slice(0, 40);
    return { id: group.id, name: group.name, nets, transfers, history: history.map((item) => `${item.on} · ${item.text}`) };
  });

  const title = link.member_id
    ? `${label(link.member_id)}${groups.length === 1 ? ` · ${groups[0]?.name ?? ''}` : ''}`
    : (groups[0]?.name ?? brand.name);

  const blocks = sections.map((section) => {
    const netRows = Object.entries(section.nets)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const balanceList = netRows.map(([id, net]) => (
      `<li><span>${esc(label(id))}</span> <span class="${moneyClass(net)}">${esc(formatSignedINR(net))}</span></li>`
    )).join('');
    const transferList = section.transfers.map((transfer) => (
      `<li>${esc(label(transfer.fromMemberId))} pays ${esc(label(transfer.toMemberId))} ${esc(formatINR(transfer.amountPaise))}</li>`
    )).join('');
    const historyList = section.history.map((line) => `<li>${esc(line)}</li>`).join('');
    const heading = groups.length > 1 ? `<h2>${esc(section.name)}</h2>` : '';
    return `${heading}
      <h2>Balances</h2>
      <ul>${balanceList || '<li>Settled</li>'}</ul>
      <h2>Who pays whom</h2>
      <ul>${transferList || '<li>Settled</li>'}</ul>
      <h2>History</h2>
      <ul>${historyList || '<li>No expenses yet</li>'}</ul>`;
  }).join('');

  let pay = '';
  if (link.member_id && selfId && link.upi_vpa) {
    const owedToMe = sections.flatMap((section) => section.transfers)
      .filter((transfer) => transfer.fromMemberId === link.member_id && transfer.toMemberId === selfId)
      .reduce((sum, transfer) => sum + transfer.amountPaise, 0);
    if (owedToMe > 0) {
      const href = upiLink(link.upi_vpa, selfName, owedToMe, title);
      pay = `<a class="pay" href="${esc(href)}">Pay ${esc(selfName)} ${esc(formatINR(owedToMe))}</a>`;
    }
  }

  const intro = link.member_id
    ? `<p>Shared by ${esc(selfName)}</p>`
    : `<p>Logged by ${esc(selfName)}</p>`;

  return shell(title, `<h1>${esc(title)}</h1>${intro}${pay}${blocks || '<p>Nothing to show yet.</p>'}`);
}

function tokenOf(url: string | undefined): string | null {
  if (!url) return null;
  const parsed = new URL(url, 'http://localhost');
  return parsed.searchParams.get('token');
}

export default api(async (req, res) => {
  if (req.method !== 'GET') throw new HttpError(405, 'method not allowed');
  const token = tokenOf(req.url);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  if (!token || !/^[A-Za-z0-9_-]{16,128}$/.test(token)) {
    res.statusCode = 404;
    res.end(inactivePage());
    return;
  }

  const html = await withTransaction((client) => loadPage(client, token));
  res.statusCode = html ? 200 : 404;
  res.end(html ?? inactivePage());
});
