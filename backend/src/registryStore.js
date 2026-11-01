import { neon } from "@neondatabase/serverless";

let database;

function getDatabase() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required to connect to Neon.");
  database ||= neon(process.env.DATABASE_URL);
  return database;
}

function asDate(value) {
  if (!value) return "";
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

export async function initializeRegistryStore() {
  const sql = getDatabase();
  await sql`CREATE TABLE IF NOT EXISTS pwd_members (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    birth_date DATE NOT NULL,
    sex TEXT NOT NULL,
    disability_type TEXT NOT NULL,
    registry_status TEXT NOT NULL,
    purok TEXT NOT NULL DEFAULT '',
    created_at DATE,
    membership_fee_date DATE,
    membership_fee_recorded_by TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS pwd_yearly_payments (
    member_id TEXT NOT NULL REFERENCES pwd_members(id) ON DELETE CASCADE,
    payment_year INTEGER NOT NULL,
    paid BOOLEAN NOT NULL DEFAULT FALSE,
    paid_date DATE,
    received_by TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (member_id, payment_year)
  )`;
  await sql`CREATE TABLE IF NOT EXISTS pwd_activity_log (
    entry_id TEXT PRIMARY KEY,
    occurred_at TIMESTAMPTZ NOT NULL,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    member_name TEXT NOT NULL,
    member_id TEXT NOT NULL DEFAULT '',
    details TEXT NOT NULL
  )`;
  await sql`CREATE TABLE IF NOT EXISTS pwd_duty_sessions (
    duty_date DATE PRIMARY KEY,
    staff_name TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS pwd_payments_date_idx ON pwd_yearly_payments (paid_date)`;
  await sql`CREATE INDEX IF NOT EXISTS pwd_activity_timestamp_idx ON pwd_activity_log (occurred_at DESC)`;
}

export async function readRegistry(dutyDate = "") {
  const sql = getDatabase();
  const [memberRows, paymentRows, activityRows, dutyRows] = await Promise.all([
    sql`SELECT id, name, birth_date, sex, disability_type, registry_status, purok, created_at, membership_fee_date, membership_fee_recorded_by FROM pwd_members ORDER BY created_at DESC NULLS LAST, name`,
    sql`SELECT member_id, payment_year, paid, paid_date, received_by FROM pwd_yearly_payments ORDER BY payment_year DESC`,
    sql`SELECT entry_id, occurred_at, actor, action, member_name, member_id, details FROM pwd_activity_log ORDER BY occurred_at DESC LIMIT 500`,
    dutyDate ? sql`SELECT duty_date, staff_name FROM pwd_duty_sessions WHERE duty_date = ${dutyDate}` : sql`SELECT duty_date, staff_name FROM pwd_duty_sessions WHERE duty_date = CURRENT_DATE`,
  ]);

  const members = memberRows.map((row) => ({
    id: row.id,
    name: row.name,
    birthDate: asDate(row.birth_date),
    sex: row.sex,
    disability: row.disability_type,
    status: row.registry_status,
    purok: row.purok || "",
    createdAt: asDate(row.created_at),
    membershipFee: { paid: true, date: asDate(row.membership_fee_date), recordedBy: row.membership_fee_recorded_by || "Not recorded" },
    payments: {},
  }));
  const membersById = new Map(members.map((member) => [member.id, member]));
  for (const row of paymentRows) {
    const member = membersById.get(row.member_id);
    if (!member) continue;
    member.payments[row.payment_year] = { paid: row.paid, date: asDate(row.paid_date), recordedBy: row.received_by || "" };
  }

  return {
    members,
    activityEntries: activityRows.map((row) => ({
      id: row.entry_id,
      timestamp: row.occurred_at instanceof Date ? row.occurred_at.toISOString() : new Date(row.occurred_at).toISOString(),
      actor: row.actor,
      action: row.action,
      memberName: row.member_name,
      memberId: row.member_id,
      details: row.details,
    })),
    dutySession: dutyRows[0] ? { date: asDate(dutyRows[0].duty_date), name: dutyRows[0].staff_name } : null,
  };
}

export async function writeRegistry(registry) {
  const sql = getDatabase();
  const operations = [];

  for (const member of registry.members) {
    const membershipFee = member.membershipFee || { date: member.createdAt || "", recordedBy: "Not recorded" };
    operations.push(sql`INSERT INTO pwd_members (id, name, birth_date, sex, disability_type, registry_status, purok, created_at, membership_fee_date, membership_fee_recorded_by)
      VALUES (${member.id}, ${member.name}, ${member.birthDate}, ${member.sex}, ${member.disability}, ${member.status}, ${member.purok || ""}, ${member.createdAt || null}, ${membershipFee.date || null}, ${membershipFee.recordedBy || "Not recorded"})
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, birth_date = EXCLUDED.birth_date, sex = EXCLUDED.sex, disability_type = EXCLUDED.disability_type, registry_status = EXCLUDED.registry_status, purok = EXCLUDED.purok, created_at = EXCLUDED.created_at, membership_fee_date = EXCLUDED.membership_fee_date, membership_fee_recorded_by = EXCLUDED.membership_fee_recorded_by, updated_at = NOW()`);

    for (const [year, payment] of Object.entries(member.payments || {})) {
      operations.push(sql`INSERT INTO pwd_yearly_payments (member_id, payment_year, paid, paid_date, received_by)
        VALUES (${member.id}, ${Number(year)}, ${Boolean(payment.paid)}, ${payment.date || null}, ${payment.recordedBy || ""})
        ON CONFLICT (member_id, payment_year) DO UPDATE SET paid = EXCLUDED.paid, paid_date = EXCLUDED.paid_date, received_by = EXCLUDED.received_by, updated_at = NOW()`);
    }
  }

  for (const entry of registry.activityEntries.slice(0, 500)) {
    operations.push(sql`INSERT INTO pwd_activity_log (entry_id, occurred_at, actor, action, member_name, member_id, details)
      VALUES (${entry.id}, ${entry.timestamp}, ${entry.actor}, ${entry.action}, ${entry.memberName}, ${entry.memberId || ""}, ${entry.details})
      ON CONFLICT (entry_id) DO NOTHING`);
  }

  if (registry.dutySession?.date && registry.dutySession.name) {
    operations.push(sql`INSERT INTO pwd_duty_sessions (duty_date, staff_name)
      VALUES (${registry.dutySession.date}, ${registry.dutySession.name})
      ON CONFLICT (duty_date) DO UPDATE SET staff_name = EXCLUDED.staff_name, updated_at = NOW()`);
  }

  if (operations.length) await sql.transaction(operations);
}
