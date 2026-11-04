import { createHmac, timingSafeEqual } from "node:crypto";
import cors from "cors";
import express from "express";
import { readRegistry, writeRegistry } from "./registryStore.js";

const app = express();
const frontendOrigin = process.env.FRONTEND_URL || "http://localhost:3001";
const cookieName = "gunob_admin_session";
const sessionLifetime = 8 * 60 * 60 * 1000;
const loginAttempts = new Map();
const publicLookupAttempts = new Map();

app.use(cors({ origin: frontendOrigin, credentials: true }));
app.use(express.json({ limit: "2mb" }));

function localDateString() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function ageAtDate(birthDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(birthDate || ""))) return 0;
  const [year, month, day] = birthDate.split("-").map(Number);
  const today = new Date();
  return today.getFullYear() - year - (today.getMonth() + 1 < month || (today.getMonth() + 1 === month && today.getDate() < day) ? 1 : 0);
}

function memberFingerprint(member) {
  return JSON.stringify({
    id: member.id,
    name: member.name,
    birthDate: member.birthDate,
    sex: member.sex,
    disability: member.disability,
    status: member.status,
    purok: member.purok || "",
    createdAt: member.createdAt || "",
    membershipFee: member.membershipFee || {},
    payments: Object.fromEntries(Object.entries(member.payments || {}).sort(([left], [right]) => left.localeCompare(right))),
  });
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function sign(value) {
  return createHmac("sha256", process.env.SESSION_SECRET).update(value).digest("base64url");
}

function makeSession(username) {
  const payload = Buffer.from(JSON.stringify({ username, expiresAt: Date.now() + sessionLifetime })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

function readSession(request) {
  if (!process.env.SESSION_SECRET) return null;
  const cookieHeader = request.headers.cookie || "";
  const cookie = cookieHeader.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`));
  if (!cookie) return null;
  const token = decodeURIComponent(cookie.slice(cookieName.length + 1));
  const [payload, signature] = token.split(".");
  if (!payload || !signature || !safeEqual(signature, sign(payload))) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return session.expiresAt > Date.now() ? session : null;
  } catch {
    return null;
  }
}

function requireAdmin(request, response, next) {
  const session = readSession(request);
  if (!session) return response.status(401).json({ error: "Admin login required." });
  request.admin = session;
  next();
}

function rateLimited(bucket, key, limit, windowMs) {
  const now = Date.now();
  const entry = bucket.get(key);
  if (!entry || entry.expiresAt <= now) {
    bucket.set(key, { count: 1, expiresAt: now + windowMs });
    return false;
  }
  if (entry.count >= limit) return true;
  entry.count += 1;
  return false;
}

function appendDutyActivity(registry, name, previousName = "") {
  const activityEntries = Array.isArray(registry.activityEntries) ? registry.activityEntries : [];
  activityEntries.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    action: "Duty assignment",
    memberName: "Duty session",
    memberId: "",
    details: previousName ? `${previousName} handed duty to ${name}.` : `${name} started duty.`,
    actor: name,
  });
  return activityEntries.slice(0, 500);
}

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok", service: "gunob-pwd-api" });
});

app.get("/api/auth/session", (request, response) => {
  const session = readSession(request);
  if (!session) return response.status(401).json({ error: "No active admin session." });
  response.json({ username: session.username, expiresAt: session.expiresAt });
});

app.post("/api/auth/login", (request, response) => {
  if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD || !process.env.SESSION_SECRET) {
    return response.status(503).json({ error: "Admin login is not configured. Set the backend credentials in backend/.env." });
  }
  if (rateLimited(loginAttempts, request.ip, 5, 15 * 60 * 1000)) {
    return response.status(429).json({ error: "Too many login attempts. Try again in 15 minutes." });
  }
  const { username, password } = request.body || {};
  if (!safeEqual(username || "", process.env.ADMIN_USERNAME) || !safeEqual(password || "", process.env.ADMIN_PASSWORD)) {
    return response.status(401).json({ error: "Username or password is incorrect." });
  }
  loginAttempts.delete(request.ip);
  const isProduction = process.env.NODE_ENV === "production";
  const cookieAttributes = `HttpOnly; Path=/; SameSite=${isProduction ? "None" : "Lax"}; Max-Age=28800${isProduction ? "; Secure" : ""}`;
  response.setHeader("Set-Cookie", `${cookieName}=${makeSession(process.env.ADMIN_USERNAME)}; ${cookieAttributes}`);
  response.json({ username: process.env.ADMIN_USERNAME });
});

app.post("/api/auth/logout", (request, response) => {
  const isProduction = process.env.NODE_ENV === "production";
  const cookieAttributes = `HttpOnly; Path=/; SameSite=${isProduction ? "None" : "Lax"}; Max-Age=0${isProduction ? "; Secure" : ""}`;
  response.setHeader("Set-Cookie", `${cookieName}=; ${cookieAttributes}`);
  response.status(204).end();
});

app.post("/api/public/payment-lookup", (request, response, next) => {
  if (rateLimited(publicLookupAttempts, request.ip, 15, 60 * 1000)) {
    return response.status(429).json({ error: "Too many lookups. Try again in a minute." });
  }
  next();
}, async (request, response, next) => {
  try {
    const name = String(request.body?.name || "").trim().replace(/\s+/g, " ").toLowerCase();
    const birthDate = String(request.body?.birthDate || "");
    if (!name || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return response.status(400).json({ error: "Enter your registered name and date of birth." });
    const registry = await readRegistry();
    const member = registry.members.find((item) => item.name.trim().replace(/\s+/g, " ").toLowerCase() === name && item.birthDate === birthDate);
    if (!member) return response.status(404).json({ error: "We couldn't verify those details." });

    const membershipFee = member.membershipFee || { paid: true, date: member.createdAt || "", recordedBy: "" };
    const payments = [];
    if (membershipFee.paid) payments.push({ type: "Membership fee", amount: 20, date: membershipFee.date || member.createdAt || "" });
    for (const [year, payment] of Object.entries(member.payments || {})) {
      if (payment.paid) payments.push({ type: `Yearly payment (${year})`, amount: 120, date: payment.date || "" });
    }
    payments.sort((left, right) => (right.date || "").localeCompare(left.date || ""));
    response.json({ memberName: member.name, memberSince: member.createdAt || "", payments });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/registry", requireAdmin, async (request, response, next) => {
  try {
    const registry = await readRegistry(request.query.date || localDateString());
    const dutySession = registry.dutySession?.date === (request.query.date || localDateString()) ? registry.dutySession : null;
    response.json({ members: registry.members, activityEntries: registry.activityEntries, dutySession });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/registry/import", requireAdmin, async (request, response, next) => {
  try {
    const registry = await readRegistry(localDateString());
    if (!Array.isArray(request.body?.members) || !Array.isArray(request.body?.activityEntries)) {
      return response.status(400).json({ error: "Invalid import data." });
    }
    const imported = {
      members: [...registry.members],
      activityEntries: [...registry.activityEntries],
      dutySession: registry.dutySession || (request.body.dutySession?.date === localDateString() ? request.body.dutySession : null),
    };
    const memberIds = new Set(imported.members.map((member) => member.id));
    for (const member of request.body.members.slice(0, 10000)) {
      if (!memberIds.has(member.id)) {
        imported.members.push(member);
        memberIds.add(member.id);
      }
    }
    const activityIds = new Set(imported.activityEntries.map((entry) => entry.id));
    for (const entry of request.body.activityEntries.slice(0, 500)) {
      if (!activityIds.has(entry.id)) {
        imported.activityEntries.push(entry);
        activityIds.add(entry.id);
      }
    }
    imported.activityEntries = imported.activityEntries.slice(0, 500);
    await writeRegistry(imported);
    response.json({ members: imported.members, activityEntries: imported.activityEntries, dutySession: imported.dutySession });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/duty", requireAdmin, async (request, response, next) => {
  try {
    const name = String(request.body?.name || "").trim().slice(0, 100);
    if (!name) return response.status(400).json({ error: "Enter the name of the staff member on duty." });
    const registry = await readRegistry(localDateString());
    const previousName = registry.dutySession?.date === localDateString() ? registry.dutySession.name : "";
    registry.dutySession = { date: localDateString(), name };
    registry.activityEntries = appendDutyActivity(registry, name, previousName);
    await writeRegistry(registry);
    response.json({ dutySession: registry.dutySession, activityEntries: registry.activityEntries });
  } catch (error) {
    next(error);
  }
});

app.put("/api/admin/registry", requireAdmin, async (request, response, next) => {
  try {
    const registry = await readRegistry(localDateString());
    if (registry.dutySession?.date !== localDateString() || !registry.dutySession.name) {
      return response.status(409).json({ error: "Assign today's duty person before making changes.", code: "duty_required" });
    }
    if (!Array.isArray(request.body?.members) || !Array.isArray(request.body?.activityEntries)) {
      return response.status(400).json({ error: "Invalid registry data." });
    }
    const incomingMembers = new Map(request.body.members.map((member) => [member.id, member]));
    for (const member of registry.members) {
      if (ageAtDate(member.birthDate) >= 65) {
        const incoming = incomingMembers.get(member.id);
        if (!incoming || memberFingerprint(incoming) !== memberFingerprint(member)) {
          return response.status(403).json({ error: "Members age 65 and over are read-only." });
        }
      }
    }
    for (const member of request.body.members) {
      if (!member.id || !member.name || !member.birthDate || !member.sex || !member.disability || !member.status) {
        return response.status(400).json({ error: "Every member must have name, date of birth, sex, disability, and status." });
      }
    }

    const existingActivityIds = new Set(registry.activityEntries.map((entry) => entry.id));
    const newActivityEntries = request.body.activityEntries.filter((entry) => !existingActivityIds.has(entry.id)).slice(0, 500).map((entry) => ({
      id: String(entry.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
      timestamp: new Date().toISOString(),
      actor: registry.dutySession.name,
      action: String(entry.action || "Registry updated").slice(0, 120),
      memberName: String(entry.memberName || "Duty session").slice(0, 160),
      memberId: String(entry.memberId || "").slice(0, 80),
      details: String(entry.details || "").slice(0, 1000),
    }));
    const activityEntries = [...newActivityEntries, ...registry.activityEntries].slice(0, 500);
    const nextRegistry = {
      members: request.body.members.slice(0, 10000),
      activityEntries,
      dutySession: registry.dutySession,
    };
    await writeRegistry(nextRegistry);
    response.json({ saved: true });
  } catch (error) {
    next(error);
  }
});

app.use((error, _request, response, _next) => {
  console.error(error);
  response.status(500).json({ error: "The request could not be completed." });
});

export default app;