const currentYear = new Date().getFullYear();
const MEMBERSHIP_FEE = 20;
const YEARLY_PAYMENT = 120;
const puroks = ["Ampalaya", "Balanghoy", "Gabi", "Kaimito", "kalabasa", "Kamansi", "Kamonggay", "Kangkong", "Kawayanan", "Lemonsito", "Mangga", "Nangka", "Nangka Lumoy", "Nangka Moler", "Sacred Heart", "Saging", "Tambis", "Tugas", "Ube"];
const disabilityTypes = ["Speech and Language Impairment", "Physical Disability", "Orthopedic", "Visual", "Psychosocial", "Mental", "Learning Disability", "Hearing Impairment", "Communication Disability", "Intellectual Disability", "Chronic Illness", "Rare Diseases", "Cancer"];
let members = [];
let activityEntries = [];
let dutySession = null;
let isAdminAuthenticated = false;
let adminUsername = "";
let activeView = "public";
let requestedPaymentFilter = "all";
let selectedPaymentYear = currentYear;
let incomeDateFrom = "";
let incomeDateTo = "";
const main = document.getElementById("mainContent");
const modalBackdrop = document.getElementById("modalBackdrop");
const activityStorageKey = "gunob-pwd-activity-log";
const dutyStorageKey = "gunob-pwd-duty-session";
document.getElementById("yearChip").textContent = `YEAR ${currentYear}`;

function loadMembers() {
  try {
    const stored = localStorage.getItem("gunob-pwd-members");
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

async function apiRequest(path, options = {}) {
  const response = await fetch(path, { credentials: "same-origin", ...options });
  const result = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result?.error || "The request could not be completed.");
  return result;
}

async function saveMembers() {
  await apiRequest("/api/admin/registry", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ members, activityEntries }),
  });
}

function loadActivityEntries() {
  try {
    return JSON.parse(localStorage.getItem(activityStorageKey) || "[]");
  } catch {
    return [];
  }
}

function loadLegacyDutySession() {
  try {
    const session = JSON.parse(localStorage.getItem(dutyStorageKey) || "null");
    return session?.date === localDateString() && session.name ? session : null;
  } catch {
    return null;
  }
}

async function loadAdminRegistry() {
  const registry = await apiRequest(`/api/admin/registry?date=${encodeURIComponent(localDateString())}`);
  members = registry.members || [];
  activityEntries = registry.activityEntries || [];
  dutySession = registry.dutySession || null;

  const legacyMembers = loadMembers();
  const legacyActivity = loadActivityEntries();
  const legacyDutySession = loadLegacyDutySession();
  if (legacyMembers.length || legacyActivity.length || legacyDutySession) {
    const imported = await apiRequest("/api/admin/registry/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ members: legacyMembers, activityEntries: legacyActivity, dutySession: legacyDutySession }),
    });
    members = imported.members || [];
    activityEntries = imported.activityEntries || [];
    dutySession = imported.dutySession || null;
    localStorage.removeItem("gunob-pwd-members");
    localStorage.removeItem(activityStorageKey);
    localStorage.removeItem(dutyStorageKey);
  }
}

async function initializeApp() {
  try {
    const session = await apiRequest("/api/auth/session");
    isAdminAuthenticated = true;
    adminUsername = session.username;
    await loadAdminRegistry();
    activeView = "overview";
  } catch {
    isAdminAuthenticated = false;
    adminUsername = "";
    members = [];
    activityEntries = [];
    dutySession = null;
    activeView = "public";
  }
  render();
}

function hasDutyToday() {
  return dutySession?.date === localDateString() && Boolean(dutySession.name);
}

function recordActivity(action, member, details, actor = hasDutyToday() ? dutySession.name : "Administrator") {
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    action,
    memberName: member?.name || "Duty session",
    memberId: member?.id || "",
    details,
    actor,
  };
  activityEntries.unshift(entry);
  activityEntries = activityEntries.slice(0, 500);
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function ageOf(birthDate) {
  const today = new Date();
  const birth = new Date(`${birthDate}T00:00:00`);
  let age = today.getFullYear() - birth.getFullYear();
  if (today.getMonth() < birth.getMonth() || (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate())) age -= 1;
  return age;
}

function isMinor(member) {
  return ageOf(member.birthDate) < 18;
}

function ageGroup(member) {
  const age = ageOf(member.birthDate);
  if (age < 18) return "Minor";
  if (age < 60) return "Adult";
  if (age < 65) return "Senior citizen";
  return "65+ (inactive)";
}

function isAgeLocked(member) {
  return ageOf(member.birthDate) >= 65;
}

function ageGroupBadge(member) {
  const group = ageGroup(member);
  const className = group === "Minor" ? "status-minor" : group === "Senior citizen" ? "status-senior" : group === "65+ (inactive)" ? "status-inactive" : "";
  return className ? `<span class="status-pill ${className}">${group}</span>` : group;
}

function isAutomaticallyInactive(member) {
  if (ageOf(member.birthDate) >= 65) return true;
  if (member.payments?.[currentYear]?.paid) return false;
  return [currentYear - 3, currentYear - 2, currentYear - 1].every((year) => {
    const payment = member.payments?.[year];
    return payment !== undefined && !payment.paid;
  });
}

function memberStatus(member) {
  return member.status === "Inactive" || isAutomaticallyInactive(member) ? "Inactive" : "Active";
}

function paymentFor(member, year = currentYear) {
  return member.payments?.[year] || { paid: false, date: "" };
}

function membershipFeeFor(member) {
  const fee = member.membershipFee || {};
  return {
    paid: true,
    date: fee.date || member.createdAt || "",
    recordedBy: fee.recordedBy || "Not recorded",
  };
}

function paymentYears() {
  const recordedYears = members.flatMap((member) => Object.keys(member.payments || {}).map(Number)).filter(Number.isInteger);
  const firstYear = Math.min(currentYear - 5, ...recordedYears);
  const lastYear = currentYear + 5;
  return Array.from({ length: lastYear - firstYear + 1 }, (_, index) => lastYear - index);
}

function formatDate(date) {
  if (!date) return "—";
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(new Date(`${date}T00:00:00`));
}

function localDateString() {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function localDate(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatCurrency(amount) {
  return new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP", maximumFractionDigits: 2 }).format(amount);
}

function incomeRecords() {
  return members.flatMap((member) => {
    const records = [];
    const membershipFee = membershipFeeFor(member);
    records.push({ member, type: "Membership fee", amount: MEMBERSHIP_FEE, date: membershipFee.date, receivedBy: membershipFee.recordedBy });
    for (const [year, payment] of Object.entries(member.payments || {})) {
      if (payment.paid) records.push({ member, type: `Yearly payment (${year})`, amount: YEARLY_PAYMENT, date: payment.date || "", receivedBy: payment.recordedBy || "Not recorded" });
    }
    return records;
  }).sort((left, right) => (right.date || "").localeCompare(left.date || ""));
}

function incomeTotal(records, start, end) {
  return records.reduce((total, record) => {
    if (!record.date) return total;
    const date = localDate(record.date);
    return date >= start && date <= end ? total + record.amount : total;
  }, 0);
}

function filterIncomeDates(records, from, to) {
  if (!from && !to) return records;
  const start = from ? localDate(from) : null;
  const end = to ? localDate(to) : null;
  return records.filter((record) => {
    if (!record.date) return false;
    const date = localDate(record.date);
    return (!start || date >= start) && (!end || date <= end);
  });
}

function sumIncome(records) {
  return records.reduce((total, record) => total + (record.date ? record.amount : 0), 0);
}

function memberSince(member) {
  return member.createdAt ? formatDate(member.createdAt) : "Not recorded";
}

function statusPill(status, automatic = false) {
  const className = status === "Active" ? "status-active" : "status-inactive";
  const label = automatic ? "Inactive · auto" : status;
  const title = automatic ? "Automatically inactive at age 65 or after 3 completed years without payment" : "";
  return `<span class="status-pill ${className}"${title ? ` title="${title}"` : ""}>${label}</span>`;
}

function pageHeading(eyebrow, title, description, action = "") {
  return `<div class="page-heading"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${description}</p></div>${action}</div>`;
}

function metric(label, value, foot, symbol) {
  return `<article class="metric-card"><div class="metric-top"><span>${label}</span><span class="metric-symbol">${symbol}</span></div><div class="metric-value">${value}</div><div class="metric-foot">${foot}</div></article>`;
}

function profileDonut(title, segments, total) {
  let previousStop = 0;
  const gradientSegments = total ? segments.map((segment) => {
    const nextStop = previousStop + segment.count / total * 100;
    const gradient = `${segment.color} ${previousStop}% ${nextStop}%`;
    previousStop = nextStop;
    return gradient;
  }) : ["#e5eae5 0% 100%"];
  const description = segments.map((segment) => `${segment.label} ${segment.count} (${total ? Math.round(segment.count / total * 100) : 0}%)`).join(", ");
  return `<section class="profile-distribution"><h3>${title}</h3><div class="distribution-content"><div class="donut-chart" role="img" aria-label="${title}: ${description}" style="background:conic-gradient(${gradientSegments.join(",")})"><span class="donut-center"><strong>${total}</strong><small>members</small></span></div><div class="chart-legend">${segments.map((segment) => `<div class="chart-legend-row"><span class="legend-swatch" style="--swatch:${segment.color}"></span><span>${segment.label}</span><strong>${segment.count}</strong><small>${total ? Math.round(segment.count / total * 100) : 0}%</small></div>`).join("")}</div></div></section>`;
}

function renderOverview() {
  const active = members.filter((member) => memberStatus(member) === "Active");
  const minors = members.filter(isMinor).length;
  const men = members.filter((member) => member.sex === "Male").length;
  const women = members.filter((member) => member.sex === "Female").length;
  const adults = members.filter((member) => ageOf(member.birthDate) >= 18 && ageOf(member.birthDate) < 60).length;
  const seniors = members.filter((member) => ageOf(member.birthDate) >= 60 && ageOf(member.birthDate) < 65).length;
  const ageLimited = members.filter((member) => ageOf(member.birthDate) >= 65).length;
  const paid = members.filter((member) => paymentFor(member).paid).length;
  const registryDisabilityTypes = [...new Set([...disabilityTypes, ...members.map((member) => member.disability).filter(Boolean)])];
  const disabilityCounts = registryDisabilityTypes.map((type) => ({ type, count: members.filter((member) => member.disability === type).length })).filter((item) => item.count > 0);
  const largest = Math.max(1, ...disabilityCounts.map((item) => item.count));
  const latest = [...members].sort((left, right) => (right.createdAt || "").localeCompare(left.createdAt || "")).slice(0, 5);
  main.innerHTML = `${pageHeading("REGISTRY SNAPSHOT", "Good morning, " + escapeHtml(dutySession.name), "Here is the current PWD registry at a glance.", `<button class="button button-primary" data-action="add-member"><span>＋</span>Add member</button>`)}
    <section class="metrics-grid" aria-label="Registry totals">
      ${metric("Registered members", members.length, "All records in the registry", "♙")}
      ${metric("Active members", active.length, `${members.length - active.length} inactive`, "✓")}
      ${metric("Minors", minors, "Members under 18 years old", "⌂")}
      ${metric(`Paid in ${currentYear}`, paid, `${members.length - paid} payment records pending`, "₱")}
    </section>
    <section class="dashboard-grid">
      <article class="panel"><div class="panel-head"><h2>Disability classification</h2><span class="panel-subtitle">${members.length} registered</span></div><div class="disability-list">${disabilityCounts.length ? disabilityCounts.map((item) => `<div class="disability-row"><span class="disability-name">${escapeHtml(item.type)}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.round(item.count / largest * 100)}%"></div></div><span class="disability-count">${item.count}</span></div>`).join("") : `<div class="table-empty">No member records yet.</div>`}</div></article>
      <article class="panel"><div class="panel-head"><h2>Annual payment status</h2><button class="button button-text" data-view="payments" data-filter="unpaid">Review unpaid →</button></div><div class="mini-summary"><div class="summary-line"><span>Payment recorded</span><strong>${paid}</strong></div><div class="summary-line"><span>Not yet recorded</span><strong>${members.length - paid}</strong></div><div class="summary-line"><span>Payment coverage</span><strong>${members.length ? Math.round(paid / members.length * 100) : 0}%</strong></div><div class="summary-line"><span>Active members</span><strong>${active.length}</strong></div></div></article>
    </section>
    <section class="overview-bottom"><article class="panel table-panel"><div class="panel-head"><h2>Recently added members</h2><button class="button button-text" data-view="members">View all →</button></div>${latest.length ? `<div class="table-wrap"><table><thead><tr><th>Member</th><th>Disability</th><th>Age group</th><th>Status</th></tr></thead><tbody>${latest.map((member) => `<tr><td><div class="member-primary">${escapeHtml(member.name)}</div><div class="member-secondary">Member since: ${escapeHtml(memberSince(member))}</div></td><td>${escapeHtml(member.disability)}</td><td>${ageGroupBadge(member)}</td><td>${statusPill(memberStatus(member), isAutomaticallyInactive(member))}</td></tr>`).join("")}</tbody></table></div>` : `<div class="table-empty">No member records yet.</div>`}</article><article class="panel"><div class="panel-head"><h2>Registry profile</h2><span class="panel-subtitle">${members.length} members</span></div><div class="profile-distributions">${profileDonut("Gender", [{ label: "Men", count: men, color: "var(--chart-green)" }, { label: "Women", count: women, color: "var(--chart-gold)" }], members.length)}${profileDonut("Age group", [{ label: "Minors", count: minors, color: "var(--chart-blue)" }, { label: "Adults", count: adults, color: "var(--chart-coral)" }, { label: "Senior citizens", count: seniors, color: "var(--chart-gold)" }, { label: "65+ · inactive", count: ageLimited, color: "var(--red)" }], members.length)}</div></article></section>`;
}

function memberRows(list) {
  if (!list.length) return `<tr><td colspan="8"><div class="table-empty">No members match this search.</div></td></tr>`;
  return list.map((member) => {
    const yearlyPayment = paymentFor(member);
    return `<tr><td><div class="member-primary">${escapeHtml(member.name)}</div><div class="member-secondary">Member since: ${escapeHtml(memberSince(member))}</div></td><td>${escapeHtml(member.purok || "Not recorded")}</td><td>${escapeHtml(member.sex)}</td><td>${escapeHtml(member.disability)}</td><td>${ageOf(member.birthDate)} ${ageGroupBadge(member)}</td><td>${statusPill(memberStatus(member), isAutomaticallyInactive(member))}</td><td><span class="status-pill ${yearlyPayment.paid ? "status-paid" : "status-unpaid"}">${yearlyPayment.paid ? "Paid" : "Not recorded"}</span></td><td>${isAgeLocked(member) ? `<span class="record-locked" title="Age 65+ records are read-only">Read only</span>` : `<button class="button button-secondary button-small" data-action="edit-member" data-id="${escapeHtml(member.id)}">Edit</button>`}</td></tr>`;
  }).join("");
}

function renderMembers() {
  main.innerHTML = `${pageHeading("MEMBER DIRECTORY", "Members", "Manage member details, eligibility, and registry status.", `<button class="button button-primary" data-action="add-member"><span>＋</span>Add member</button>`)}
    <div class="search-toolbar"><label class="search-box"><span class="search-icon">⌕</span><input id="memberSearch" type="search" placeholder="Search name or PWD ID" aria-label="Search members" /></label><select class="filter-select" id="statusFilter" aria-label="Filter by member status"><option value="all">All statuses</option><option value="Active">Active</option><option value="Inactive">Inactive</option></select></div>
    <article class="panel table-panel"><div class="panel-head"><h2>All registered members</h2><span class="table-count" id="memberCount">${members.length} records</span></div><div class="table-wrap"><table><thead><tr><th>Member</th><th>Purok</th><th>Sex</th><th>Disability</th><th>Age</th><th>Status</th><th>${currentYear} yearly payment</th><th></th></tr></thead><tbody id="memberRows">${memberRows(members)}</tbody></table></div></article>`;
  const update = () => {
    const query = document.getElementById("memberSearch").value.trim().toLowerCase();
    const status = document.getElementById("statusFilter").value;
    const filtered = members.filter((member) => (status === "all" || memberStatus(member) === status) && `${member.name} ${member.id} ${member.purok || ""}`.toLowerCase().includes(query));
    document.getElementById("memberRows").innerHTML = memberRows(filtered);
    document.getElementById("memberCount").textContent = `${filtered.length} ${filtered.length === 1 ? "record" : "records"}`;
  };
  document.getElementById("memberSearch").addEventListener("input", update);
  document.getElementById("statusFilter").addEventListener("change", update);
}

function paymentRows(list) {
  if (!list.length) return `<tr><td colspan="6"><div class="table-empty">No payment records match this filter.</div></td></tr>`;
  return list.map((member) => {
    const payment = paymentFor(member, selectedPaymentYear);
    const receivedBy = payment.paid ? payment.recordedBy || "Not recorded" : "—";
    return `<tr><td><div class="member-primary">${escapeHtml(member.name)}</div><div class="member-secondary">Member since: ${escapeHtml(memberSince(member))}</div></td><td>${statusPill(memberStatus(member), isAutomaticallyInactive(member))}</td><td><span class="status-pill ${payment.paid ? "status-paid" : "status-unpaid"}">${payment.paid ? "Paid" : "Not recorded"}</span></td><td>${payment.paid ? formatDate(payment.date) : "—"}</td><td>${escapeHtml(receivedBy)}</td><td><div class="payment-actions">${isAgeLocked(member) ? `<span class="record-locked" title="Age 65+ records are read-only">Read only</span>` : `<button class="button button-secondary button-small" data-action="edit-payment" data-id="${escapeHtml(member.id)}" data-year="${selectedPaymentYear}">Edit record</button>`}</div></td></tr>`;
  }).join("");
}

function renderPayments() {
  const paid = members.filter((member) => paymentFor(member, selectedPaymentYear).paid).length;
  const initialRows = members.filter((member) => requestedPaymentFilter === "all" || paymentFor(member, selectedPaymentYear).paid === (requestedPaymentFilter === "paid"));
  const yearOptions = paymentYears().map((year) => `<option value="${year}" ${year === selectedPaymentYear ? "selected" : ""}>${year}</option>`).join("");
  main.innerHTML = `${pageHeading("ANNUAL RECORDS", "Payments", `Review payment records by year. Three consecutive completed years marked "Not recorded" or reaching age 65 automatically makes a member inactive; missing years are not counted.`)}<div class="metrics-grid">${metric(`Paid in ${selectedPaymentYear}`, paid, `Recorded for ${selectedPaymentYear}`, "₱")}${metric("Not recorded", members.length - paid, "May include inactive members", "…")}${metric("Coverage", `${members.length ? Math.round(paid / members.length * 100) : 0}%`, `For ${selectedPaymentYear}`, "↗")}${metric("Selected year", selectedPaymentYear, "Annual payment records", "▣")}</div><div class="search-toolbar"><label class="search-box"><span class="search-icon">⌕</span><input id="paymentSearch" type="search" placeholder="Search member name or PWD ID" aria-label="Search payment records" /></label><select class="filter-select" id="paymentFilter" aria-label="Filter payment records"><option value="all" ${requestedPaymentFilter === "all" ? "selected" : ""}>All payments</option><option value="unpaid" ${requestedPaymentFilter === "unpaid" ? "selected" : ""}>Not recorded</option><option value="paid" ${requestedPaymentFilter === "paid" ? "selected" : ""}>Paid</option></select><label class="year-filter"><span>Year</span><select class="filter-select" id="paymentYearFilter" aria-label="Payment year">${yearOptions}</select></label></div><article class="panel table-panel payments-table"><div class="panel-head"><h2>Member payment records</h2><span class="table-count" id="paymentCount">${initialRows.length} ${initialRows.length === 1 ? "record" : "records"}</span></div><div class="table-wrap"><table><thead><tr><th>Member</th><th>Member status</th><th>Payment status</th><th>Date paid</th><th>Received by</th><th></th></tr></thead><tbody id="paymentRows">${paymentRows(initialRows)}</tbody></table></div></article>`;
  const update = () => {
    const query = document.getElementById("paymentSearch").value.trim().toLowerCase();
    requestedPaymentFilter = document.getElementById("paymentFilter").value;
    const filtered = members.filter((member) => {
      const matchesQuery = `${member.name} ${member.id}`.toLowerCase().includes(query);
      const matchesPayment = requestedPaymentFilter === "all" || paymentFor(member, selectedPaymentYear).paid === (requestedPaymentFilter === "paid");
      return matchesQuery && matchesPayment;
    });
    document.getElementById("paymentRows").innerHTML = paymentRows(filtered);
    document.getElementById("paymentCount").textContent = `${filtered.length} ${filtered.length === 1 ? "record" : "records"}`;
  };
  document.getElementById("paymentSearch").addEventListener("input", update);
  document.getElementById("paymentFilter").addEventListener("change", update);
  document.getElementById("paymentYearFilter").addEventListener("change", (event) => {
    selectedPaymentYear = Number(event.currentTarget.value);
    renderPayments();
  });
}

function renderIncome() {
  const today = localDate(localDateString());
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - (today.getDay() + 6) % 7);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const yearStart = new Date(today.getFullYear(), 0, 1);
  const yearEnd = new Date(today.getFullYear(), 11, 31);
  const records = incomeRecords();
  const selectedRecords = filterIncomeDates(records, incomeDateFrom, incomeDateTo);
  const selectedPeriod = incomeDateFrom || incomeDateTo ? `${incomeDateFrom ? formatDate(incomeDateFrom) : "Beginning"} – ${incomeDateTo ? formatDate(incomeDateTo) : "Today"}` : "All recorded dates";
  const rows = selectedRecords.length ? selectedRecords.map((record) => `<tr><td>${record.date ? formatDate(record.date) : "Date not recorded"}</td><td>${escapeHtml(record.type)}</td><td><div class="member-primary">${escapeHtml(record.member.name)}</div><div class="member-secondary">Member since: ${escapeHtml(memberSince(record.member))}</div></td><td><strong>${formatCurrency(record.amount)}</strong></td><td>${escapeHtml(record.receivedBy)}</td></tr>`).join("") : `<tr><td colspan="5"><div class="table-empty">No income records for the selected dates.</div></td></tr>`;
  main.innerHTML = `${pageHeading("FINANCIAL SUMMARY", "Income log", `Membership fee: ${formatCurrency(MEMBERSHIP_FEE)} · Yearly payment: ${formatCurrency(YEARLY_PAYMENT)}.`)}<form class="income-date-filter" id="incomeDateFilter"><label class="date-field"><span>From</span><input id="incomeDateFrom" name="from" type="date" value="${escapeHtml(incomeDateFrom)}" /></label><label class="date-field"><span>To</span><input id="incomeDateTo" name="to" type="date" value="${escapeHtml(incomeDateTo)}" /></label><div class="income-filter-actions"><button class="button button-primary" type="submit">Apply dates</button><button class="button button-secondary" type="button" data-action="clear-income-dates">Clear</button></div><div class="income-range-total" aria-live="polite"><span>${escapeHtml(selectedPeriod)}</span><strong>${formatCurrency(sumIncome(selectedRecords))}</strong></div><div class="form-error" id="incomeDateError"></div></form><section class="metrics-grid" aria-label="Income totals">${metric("Today", formatCurrency(incomeTotal(records, today, today)), "Paid records today", "◷")}${metric("This week", formatCurrency(incomeTotal(records, weekStart, weekEnd)), "Monday to Sunday", "▤")}${metric("This month", formatCurrency(incomeTotal(records, monthStart, monthEnd)), new Intl.DateTimeFormat("en", { month: "long", year: "numeric" }).format(today), "▣")}${metric("This year", formatCurrency(incomeTotal(records, yearStart, yearEnd)), String(today.getFullYear()), "₱")}</section><article class="panel table-panel payments-table"><div class="panel-head"><h2>Paid income records</h2><span class="table-count">${selectedRecords.length} ${selectedRecords.length === 1 ? "record" : "records"}</span></div><div class="table-wrap"><table><thead><tr><th>Date paid</th><th>Income type</th><th>Member</th><th>Amount</th><th>Received by</th></tr></thead><tbody>${rows}</tbody></table></div></article>`;
  document.getElementById("incomeDateFilter").addEventListener("submit", (event) => {
    event.preventDefault();
    const from = document.getElementById("incomeDateFrom").value;
    const to = document.getElementById("incomeDateTo").value;
    if (from && to && from > to) {
      const error = document.getElementById("incomeDateError");
      error.textContent = "The start date must be on or before the end date.";
      error.classList.add("show");
      return;
    }
    incomeDateFrom = from;
    incomeDateTo = to;
    renderIncome();
  });
}

function renderActivity() {
  const rows = activityEntries.length ? activityEntries.map((entry) => `<tr><td>${escapeHtml(new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" }).format(new Date(entry.timestamp)))}</td><td>${escapeHtml(entry.actor)}</td><td><strong>${escapeHtml(entry.action)}</strong></td><td><div class="member-primary">${escapeHtml(entry.memberName)}</div><div class="member-secondary">${escapeHtml(entry.memberId)}</div></td><td>${escapeHtml(entry.details)}</td></tr>`).join("") : `<tr><td colspan="5"><div class="table-empty">No activity has been recorded yet.</div></td></tr>`;
  main.innerHTML = `${pageHeading("ADMIN HISTORY", "Activity log", "Review member and payment changes with their date and time.")}<article class="panel table-panel"><div class="panel-head"><h2>Recent activity</h2><span class="table-count">${activityEntries.length} ${activityEntries.length === 1 ? "entry" : "entries"}</span></div><div class="table-wrap"><table><thead><tr><th>Date &amp; time</th><th>Admin</th><th>Action</th><th>Member</th><th>Details</th></tr></thead><tbody>${rows}</tbody></table></div></article>`;
}

function renderPublic() {
  main.innerHTML = `<div class="public-layout"><section class="public-intro"><div><div class="eyebrow">BARANGAY GUN-OB · PWD SERVICES</div><h1>View your payment history.</h1><p>Verify your identity to see your recorded membership and yearly payments, including when they were paid.</p></div><div class="public-seal"><span class="public-seal-mark">＋</span><span>Persons with Disabilities<br />Barangay Gun-ob</span></div></section><section class="panel lookup-panel"><h2>Member payment history</h2><p>Enter your registered name and date of birth. No account is required.</p><form id="lookupForm"><div class="field"><label for="lookupName">PWD member name</label><input id="lookupName" name="name" type="text" placeholder="Enter your registered name" autocomplete="name" required /></div><div class="field"><label for="lookupBirthDate">Date of birth</label><input id="lookupBirthDate" name="birthDate" type="date" required /></div><button type="submit" class="button button-primary">View payment history <span>→</span></button></form><div class="lookup-result" id="lookupResult" role="status" aria-live="polite"></div><div class="privacy-note"><span>◆</span><div>Only your payment history and membership start date are shown.</div></div></section></div>`;
  document.getElementById("lookupForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const name = document.getElementById("lookupName").value.trim().replace(/\s+/g, " ");
    const birthDate = document.getElementById("lookupBirthDate").value;
    const result = document.getElementById("lookupResult");
    result.className = "lookup-result show";
    result.innerHTML = `<div class="result-title">Loading payment history…</div>`;
    apiRequest("/api/public/payment-lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, birthDate }),
    }).then((history) => {
      const rows = history.payments.length ? history.payments.map((payment) => `<tr><td>${escapeHtml(payment.type)}</td><td>${payment.date ? formatDate(payment.date) : "Date not recorded"}</td><td><strong>${formatCurrency(payment.amount)}</strong></td></tr>`).join("") : `<tr><td colspan="3"><div class="table-empty">No paid payments have been recorded yet.</div></td></tr>`;
      result.className = "lookup-result show";
      result.innerHTML = `<div class="result-title">Payment history for ${escapeHtml(history.memberName)}.</div><p>Member since: ${escapeHtml(history.memberSince ? formatDate(history.memberSince) : "Not recorded")}</p><div class="table-wrap"><table><thead><tr><th>Payment</th><th>Date paid</th><th>Amount</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    }).catch((error) => {
      result.className = "lookup-result show error";
      result.innerHTML = `<div class="result-title">We couldn't verify those details.</div>${escapeHtml(error.message || "Check your registered name and date of birth, or contact the Barangay Gun-ob PWD desk.")}`;
    });
  });
}

function render() {
  const titles = { overview: "Overview", members: "Members", payments: "Payments", income: "Income log", activity: "Activity log", public: "Payment history" };
  const adminNavigation = document.getElementById("adminNavigation");
  adminNavigation.hidden = !isAdminAuthenticated;
  document.getElementById("workspaceLabel").hidden = !isAdminAuthenticated;
  document.getElementById("publicNavigationLabel").hidden = isAdminAuthenticated;
  document.getElementById("publicNavigation").hidden = isAdminAuthenticated;
  document.getElementById("authAction").textContent = isAdminAuthenticated ? "Log out" : "Admin login";
  document.getElementById("authAction").dataset.action = isAdminAuthenticated ? "logout" : "login";
  document.getElementById("yearChip").hidden = !isAdminAuthenticated || activeView === "public";
  document.getElementById("dutyLabel").hidden = !isAdminAuthenticated || activeView === "public";
  document.getElementById("dutyLabel").textContent = hasDutyToday() ? `On duty: ${dutySession.name}` : "No duty selected";
  document.getElementById("changeDuty").hidden = !isAdminAuthenticated || activeView === "public";
  if (!isAdminAuthenticated || activeView === "public") activeView = "public";
  if (isAdminAuthenticated && activeView !== "public" && !hasDutyToday()) {
    openDutyModal();
    return;
  }
  document.getElementById("pageTitle").textContent = titles[activeView];
  document.querySelectorAll(".nav-link[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === activeView));
  if (activeView === "overview") renderOverview();
  if (activeView === "members") renderMembers();
  if (activeView === "payments") renderPayments();
  if (activeView === "income") renderIncome();
  if (activeView === "activity") renderActivity();
  if (activeView === "public") renderPublic();
  main.focus({ preventScroll: true });
}

function openLoginModal() {
  modalBackdrop.innerHTML = `<section class="modal login-modal" role="dialog" aria-modal="true" aria-labelledby="loginModalTitle"><div class="modal-header"><h2 id="loginModalTitle">Admin login</h2><button class="modal-close" type="button" data-action="close-modal" aria-label="Close">×</button></div><form class="modal-form" id="loginForm"><div class="field"><label for="adminUsername">Username</label><input id="adminUsername" name="username" autocomplete="username" required /></div><div class="field"><label for="adminPassword">Password</label><input id="adminPassword" name="password" type="password" autocomplete="current-password" required /></div><div class="form-error" id="formError"></div><div class="modal-actions"><button class="button button-secondary" type="button" data-action="close-modal">Cancel</button><button class="button button-primary" type="submit">Log in</button></div></form></section>`;
  modalBackdrop.hidden = false;
  document.getElementById("adminUsername").focus();
  document.getElementById("loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    const submit = event.currentTarget.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      const session = await apiRequest("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      isAdminAuthenticated = true;
      adminUsername = session.username;
      await loadAdminRegistry();
      activeView = "overview";
      closeModal();
      render();
    } catch (error) {
      if (isAdminAuthenticated) {
        await apiRequest("/api/auth/logout", { method: "POST" }).catch(() => {});
        isAdminAuthenticated = false;
        adminUsername = "";
        members = [];
        activityEntries = [];
        dutySession = null;
        activeView = "public";
        render();
      }
      const formError = document.getElementById("formError");
      formError.textContent = error.message;
      formError.classList.add("show");
      submit.disabled = false;
    }
  });
}

async function logoutAdmin() {
  try {
    await apiRequest("/api/auth/logout", { method: "POST" });
  } finally {
    isAdminAuthenticated = false;
    adminUsername = "";
    members = [];
    activityEntries = [];
    dutySession = null;
    activeView = "public";
    render();
  }
}

function openMemberModal(member = null) {
  if (member && isAgeLocked(member)) return;
  const editing = Boolean(member);
  const nextNumber = Math.max(100, ...members.map((item) => Number(item.id.match(/(\d+)$/)?.[1] || 0))) + 1;
  const id = member?.id || `GN-PWD-${String(nextNumber).padStart(4, "0")}`;
  const membershipFee = membershipFeeFor(member || {});
  const automaticStatusNote = editing && isAutomaticallyInactive(member) ? `<small class="field-hint">${ageOf(member.birthDate) >= 65 ? "Automatically inactive at age 65. This age-based status cannot be changed." : "Automatically inactive: the last three completed years are marked not recorded. Add a payment record to review this status."}</small>` : "";
  modalBackdrop.innerHTML = `<section class="modal" role="dialog" aria-modal="true" aria-labelledby="memberModalTitle"><div class="modal-header"><h2 id="memberModalTitle">${editing ? "Edit member" : "Add member"}</h2><button class="modal-close" type="button" data-action="close-modal" aria-label="Close">×</button></div><form class="modal-form" id="memberForm"><input type="hidden" name="id" value="${escapeHtml(id)}" /><div class="form-grid"><div class="field full"><label for="memberName">Full name</label><input id="memberName" name="name" value="${escapeHtml(member?.name || "")}" required /></div><div class="field"><label for="memberBirthDate">Date of birth</label><input id="memberBirthDate" name="birthDate" type="date" value="${escapeHtml(member?.birthDate || "")}" required /></div><div class="field"><label for="memberSex">Sex</label><select id="memberSex" name="sex"><option ${member?.sex === "Female" ? "selected" : ""}>Female</option><option ${member?.sex === "Male" ? "selected" : ""}>Male</option></select></div><div class="field"><label for="memberDisability">Disability type</label><select id="memberDisability" name="disability">${disabilityTypes.map((type) => `<option ${member?.disability === type ? "selected" : ""}>${type}</option>`).join("")}</select></div><div class="field"><label for="memberStatus">Manual registry status</label><select id="memberStatus" name="status"><option ${member?.status !== "Inactive" ? "selected" : ""}>Active</option><option ${member?.status === "Inactive" ? "selected" : ""}>Inactive</option></select>${automaticStatusNote}</div><div class="field"><label for="membershipFeeStatus">Membership fee (${formatCurrency(MEMBERSHIP_FEE)})</label><select id="membershipFeeStatus" name="membershipFeeStatus"><option value="unpaid" ${membershipFee.paid ? "" : "selected"}>Not recorded</option><option value="paid" ${membershipFee.paid ? "selected" : ""}>Paid</option></select></div><div class="field"><label for="membershipFeeDate">Membership fee date</label><input id="membershipFeeDate" name="membershipFeeDate" type="date" value="${escapeHtml(membershipFee.date)}" ${membershipFee.paid ? "required" : ""} /></div><div class="field full"><label>Received by</label><p class="duty-receiver">${escapeHtml(dutySession.name)}</p></div></div><div class="form-error" id="formError"></div><div class="modal-actions"><button type="button" class="button button-secondary" data-action="close-modal">Cancel</button><button type="submit" class="button button-primary">${editing ? "Save changes" : "Add member"}</button></div></form></section>`;
  const sexSelect = document.getElementById("memberSex");
  const sexPlaceholder = document.createElement("option");
  sexPlaceholder.value = "";
  sexPlaceholder.textContent = "Select sex";
  sexPlaceholder.disabled = true;
  sexSelect.prepend(sexPlaceholder);
  sexSelect.required = true;
  if (!member?.sex) sexSelect.value = "";

  const disabilitySelect = document.getElementById("memberDisability");
  const disabilityPlaceholder = document.createElement("option");
  disabilityPlaceholder.value = "";
  disabilityPlaceholder.textContent = "Select disability type";
  disabilityPlaceholder.disabled = true;
  disabilitySelect.prepend(disabilityPlaceholder);
  disabilitySelect.required = true;
  if (!member?.disability) disabilitySelect.value = "";
  if (member?.disability && !disabilityTypes.includes(member.disability)) {
    const legacyOption = document.createElement("option");
    legacyOption.value = member.disability;
    legacyOption.textContent = member.disability;
    legacyOption.selected = true;
    disabilitySelect.append(legacyOption);
  }
  const membershipFeeStatusField = document.getElementById("membershipFeeStatus").closest(".field");
  membershipFeeStatusField.innerHTML = `<label>Membership fee</label><p class="duty-receiver">${formatCurrency(MEMBERSHIP_FEE)} · Paid on registration</p>`;
  const membershipFeeDateField = document.getElementById("membershipFeeDate").closest(".field");
  membershipFeeDateField.innerHTML = `<label for="memberPurok">Purok</label><select id="memberPurok" name="purok" required><option value="" ${member?.purok ? "" : "selected"} disabled>Select Purok</option>${puroks.map((purok) => `<option value="${escapeHtml(purok)}" ${member?.purok === purok ? "selected" : ""}>${escapeHtml(purok)}</option>`).join("")}</select>`;
  modalBackdrop.hidden = false;
  document.getElementById("memberName").focus();
  document.getElementById("memberForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!hasDutyToday()) {
      closeModal();
      openDutyModal();
      return;
    }
    const formData = new FormData(event.currentTarget);
    const values = Object.fromEntries(formData.entries());
    const nextMembershipFee = editing ? membershipFeeFor(member) : { paid: true, date: localDateString(), recordedBy: dutySession.name };
    if (values.birthDate > new Date().toISOString().slice(0, 10)) {
      const error = document.getElementById("formError");
      error.textContent = "Date of birth cannot be in the future.";
      error.classList.add("show");
      return;
    }
    const previousMembers = structuredClone(members);
    const previousActivityEntries = structuredClone(activityEntries);
    if (editing) {
      const changedFields = ["name", "birthDate", "sex", "disability", "status", "purok"].filter((field) => member[field] !== values[field]);
      Object.assign(member, values);
      member.membershipFee = nextMembershipFee;
      if (changedFields.length) recordActivity("Member updated", member, `Updated: ${changedFields.join(", ")}.`);
    } else {
      const addedMember = { ...values, createdAt: localDateString(), membershipFee: nextMembershipFee, payments: {} };
      members.push(addedMember);
      recordActivity("Member added", addedMember, `Added as ${addedMember.status}; disability: ${addedMember.disability}; Purok: ${addedMember.purok}; ${formatCurrency(MEMBERSHIP_FEE)} membership fee paid by ${dutySession.name}.`);
    }
    try {
      await saveMembers();
      closeModal();
      render();
    } catch (error) {
      members = previousMembers;
      activityEntries = previousActivityEntries;
      const formError = document.getElementById("formError");
      formError.textContent = error.message;
      formError.classList.add("show");
    }
  });
}

function closeModal() {
  modalBackdrop.hidden = true;
  modalBackdrop.innerHTML = "";
}

function openDutyModal() {
  const required = !hasDutyToday();
  const previousName = hasDutyToday() ? dutySession.name : "";
  modalBackdrop.innerHTML = `<section class="modal duty-modal" role="dialog" aria-modal="true" aria-labelledby="dutyModalTitle"><div class="modal-header"><h2 id="dutyModalTitle">Who is on Duty Today</h2>${required ? "" : `<button class="modal-close" type="button" data-action="close-modal" aria-label="Close">×</button>`}</div><form class="modal-form" id="dutyForm">${previousName ? `<p class="payment-member-name">Current duty: <strong>${escapeHtml(previousName)}</strong></p>` : ""}<div class="field"><label for="dutyName">Staff member name</label><input id="dutyName" name="name" type="text" maxlength="100" autocomplete="name" placeholder="Enter the name of the staff member on duty" required /></div><div class="form-error" id="formError"></div><div class="modal-actions">${required ? `<button class="button button-secondary" type="button" data-action="public-lookup">Public payment lookup</button>` : `<button class="button button-secondary" type="button" data-action="close-modal">Cancel</button>`}<button class="button button-primary" type="submit">${required ? "Start duty" : "Save duty change"}</button></div></form></section>`;
  modalBackdrop.hidden = false;
  document.getElementById("dutyName").focus();
  document.getElementById("dutyForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = new FormData(event.currentTarget).get("name").trim();
    if (!name) return;
    const submit = event.currentTarget.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      const result = await apiRequest("/api/admin/duty", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      dutySession = result.dutySession;
      activityEntries = result.activityEntries || activityEntries;
      closeModal();
      render();
    } catch (error) {
      const formError = document.getElementById("formError");
      formError.textContent = error.message;
      formError.classList.add("show");
      submit.disabled = false;
    }
  });
}

function editPayment(member, year) {
  if (isAgeLocked(member)) return;
  const payment = paymentFor(member, year);
  modalBackdrop.innerHTML = `<section class="modal" role="dialog" aria-modal="true" aria-labelledby="paymentModalTitle"><div class="modal-header"><h2 id="paymentModalTitle">Edit ${year} payment</h2><button class="modal-close" type="button" data-action="close-modal" aria-label="Close">×</button></div><form class="modal-form" id="paymentForm"><p class="payment-member-name">${escapeHtml(member.name)} <span>Member since: ${escapeHtml(memberSince(member))}</span></p><div class="field"><label for="paymentStatus">Payment status</label><select id="paymentStatus" name="status"><option value="unpaid" ${payment.paid ? "" : "selected"}>Not recorded</option><option value="paid" ${payment.paid ? "selected" : ""}>Paid</option></select></div><div class="field"><label for="paymentDate">Date paid</label><input id="paymentDate" name="date" type="date" value="${escapeHtml(payment.date)}" ${payment.paid ? "required" : ""} /></div><div class="field"><label>Received by</label><p class="duty-receiver">${escapeHtml(dutySession.name)}</p></div><div class="form-error" id="formError"></div><div class="modal-actions"><button type="button" class="button button-secondary" data-action="close-modal">Cancel</button><button type="submit" class="button button-primary">Save payment</button></div></form></section>`;
  modalBackdrop.hidden = false;
  document.getElementById("paymentStatus").focus();
  document.getElementById("paymentStatus").addEventListener("change", (event) => {
    document.getElementById("paymentDate").required = event.currentTarget.value === "paid";
  });
  document.getElementById("paymentForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!hasDutyToday()) {
      closeModal();
      openDutyModal();
      return;
    }
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    if (values.status === "paid" && !values.date) {
      const error = document.getElementById("formError");
      error.textContent = "Enter the payment date before saving a paid record.";
      error.classList.add("show");
      return;
    }
    const updatedPayment = values.status === "paid" ? { paid: true, date: values.date, recordedBy: dutySession.name } : { paid: false, date: "", recordedBy: "" };
    const changed = payment.paid !== updatedPayment.paid || payment.date !== updatedPayment.date || payment.recordedBy !== updatedPayment.recordedBy;
    const previousMembers = structuredClone(members);
    const previousActivityEntries = structuredClone(activityEntries);
    member.payments ||= {};
    member.payments[year] = updatedPayment;
    if (changed) {
      const action = !payment.paid && updatedPayment.paid ? "Payment marked paid" : payment.paid && !updatedPayment.paid ? "Payment marked not recorded" : "Payment record updated";
      const details = updatedPayment.paid ? `${year}: paid ${updatedPayment.date}; received by ${updatedPayment.recordedBy}.` : `${year}: payment marked not recorded.`;
      recordActivity(action, member, details);
    }
    try {
      await saveMembers();
      closeModal();
      renderPayments();
    } catch (error) {
      members = previousMembers;
      activityEntries = previousActivityEntries;
      const formError = document.getElementById("formError");
      formError.textContent = error.message;
      formError.classList.add("show");
    }
  });
}

document.addEventListener("click", (event) => {
  const viewButton = event.target.closest("[data-view]");
  if (viewButton) {
    activeView = viewButton.dataset.view;
    requestedPaymentFilter = viewButton.dataset.filter || "all";
    if (viewButton.dataset.filter === "unpaid") selectedPaymentYear = currentYear;
    document.getElementById("sidebar").classList.remove("open");
    document.querySelector(".mobile-shade")?.classList.remove("show");
    render();
    return;
  }
  const actionButton = event.target.closest("[data-action]");
  if (!actionButton) return;
  if (actionButton.dataset.action === "login") {
    openLoginModal();
    return;
  }
  if (actionButton.dataset.action === "logout") {
    logoutAdmin();
    return;
  }
  if (actionButton.dataset.action === "login") {
    openLoginModal();
    return;
  }
  if (actionButton.dataset.action === "logout") {
    logoutAdmin();
    return;
  }
  if (actionButton.dataset.action === "change-duty") openDutyModal();
  if (actionButton.dataset.action === "clear-income-dates") {
    incomeDateFrom = "";
    incomeDateTo = "";
    renderIncome();
    return;
  }
  if (actionButton.dataset.action === "public-lookup") {
    activeView = "public";
    closeModal();
    initializeApp();
    return;
  }
  if (!hasDutyToday() && !["close-modal"].includes(actionButton.dataset.action)) {
    openDutyModal();
    return;
  }
  if (actionButton.dataset.action === "add-member") openMemberModal();
  if (actionButton.dataset.action === "edit-member") openMemberModal(members.find((member) => member.id === actionButton.dataset.id));
  if (actionButton.dataset.action === "edit-payment") {
    const member = members.find((item) => item.id === actionButton.dataset.id);
    if (member) editPayment(member, Number(actionButton.dataset.year));
  }
  if (actionButton.dataset.action === "close-modal") closeModal();
});

modalBackdrop.addEventListener("click", (event) => {
  if (event.target === modalBackdrop && !document.getElementById("dutyForm")) closeModal();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !modalBackdrop.hidden && !document.getElementById("dutyForm")) closeModal();
});

const shade = document.createElement("div");
shade.className = "mobile-shade";
document.body.append(shade);
document.getElementById("menuToggle").addEventListener("click", () => {
  document.getElementById("sidebar").classList.add("open");
  shade.classList.add("show");
});
document.getElementById("closeSidebar").addEventListener("click", () => {
  document.getElementById("sidebar").classList.remove("open");
  shade.classList.remove("show");
});
shade.addEventListener("click", () => {
  document.getElementById("sidebar").classList.remove("open");
  shade.classList.remove("show");
});

initializeApp();