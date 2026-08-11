import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import type { Database, Payment, PaymentDB, User, NotificationLog, MessageTemplates, Settings } from "./types";

const DATA_DIR = join(import.meta.dir, "../../data");
const MAIN_DB_PATH = join(import.meta.dir, "../../bot-data/database.json");
const PAYMENTS_PATH = join(DATA_DIR, "payments.json");
const NOTIFICATION_LOG_PATH = join(DATA_DIR, "notification_log.json");
const TEMPLATES_PATH = join(DATA_DIR, "message_templates.json");
const SETTINGS_PATH = join(DATA_DIR, "settings.json");

let mainDb: Database = { users: {}, accessRequests: {}, configOwnershipTokens: {}, subnets: {} };
let paymentDb: PaymentDB = { payments: {} };
let notificationLog: NotificationLog[] = [];
let templates: MessageTemplates = { instruction: "", payment: "", expiryReminder: "", broadcast: "" };
let settings: Settings = { autoNotificationsEnabled: false };

let previousUserIds: Set<number> = new Set();
let previousTraffic: Map<number, number> = new Map();

function ensureDataDir() {
    if (!existsSync(DATA_DIR)) {
        mkdirSync(DATA_DIR, { recursive: true });
    }
}

function loadMainDb() {
    try {
        if (existsSync(MAIN_DB_PATH)) {
            const raw = readFileSync(MAIN_DB_PATH, "utf-8");
            mainDb = JSON.parse(raw);
            previousUserIds = new Set(Object.keys(mainDb.users).map(Number));
            for (const [idStr, user] of Object.entries(mainDb.users)) {
                const id = Number(idStr);
                const totalRx = (user.configs || []).reduce((s, c) => s + (c.totalRx || 0), 0);
                previousTraffic.set(id, totalRx);
            }
        }
    } catch (e) {
        console.error("[DB] Failed to load main database:", e);
    }
}

function loadPayments() {
    try {
        if (existsSync(PAYMENTS_PATH)) {
            const raw = readFileSync(PAYMENTS_PATH, "utf-8");
            paymentDb = JSON.parse(raw);
            let migrated = false;
            for (const p of Object.values(paymentDb.payments)) {
                if (!p.type) { p.type = "free"; migrated = true; }
            }
            if (migrated) savePayments();
        }
    } catch (e) {
        console.error("[DB] Failed to load payments:", e);
    }
}

function savePayments() {
    try {
        ensureDataDir();
        writeFileSync(PAYMENTS_PATH, JSON.stringify(paymentDb, null, 2));
    } catch (e) {
        console.error("[DB] Failed to save payments:", e);
    }
}

function loadNotificationLog() {
    try {
        if (existsSync(NOTIFICATION_LOG_PATH)) {
            const raw = readFileSync(NOTIFICATION_LOG_PATH, "utf-8");
            notificationLog = JSON.parse(raw);
        }
    } catch (e) {
        console.error("[DB] Failed to load notification log:", e);
    }
}

function saveNotificationLog() {
    try {
        ensureDataDir();
        const last1000 = notificationLog.slice(-1000);
        writeFileSync(NOTIFICATION_LOG_PATH, JSON.stringify(last1000, null, 2));
    } catch (e) {
        console.error("[DB] Failed to save notification log:", e);
    }
}

function loadTemplates() {
    try {
        if (existsSync(TEMPLATES_PATH)) {
            const raw = readFileSync(TEMPLATES_PATH, "utf-8");
            const data = JSON.parse(raw);
            templates = { ...templates, ...data };
            saveTemplates();
        } else {
            templates = {
                instruction: "",
                payment: "",
                expiryReminder: "",
                broadcast: "",
            };
            saveTemplates();
        }
    } catch (e) {
        console.error("[DB] Failed to load templates:", e);
    }
}

function saveTemplates() {
    try {
        ensureDataDir();
        writeFileSync(TEMPLATES_PATH, JSON.stringify(templates, null, 2));
    } catch (e) {
        console.error("[DB] Failed to save templates:", e);
    }
}

function loadSettings() {
    try {
        if (existsSync(SETTINGS_PATH)) {
            const raw = readFileSync(SETTINGS_PATH, "utf-8");
            const data = JSON.parse(raw);
            settings = { ...settings, ...data };
        }
    } catch (e) {
        console.error("[DB] Failed to load settings:", e);
    }
}

function saveSettings() {
    try {
        ensureDataDir();
        writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
    } catch (e) {
        console.error("[DB] Failed to save settings:", e);
    }
}

export function getTemplates(): MessageTemplates {
    return { ...templates };
}

export function patchTemplates(patch: Partial<MessageTemplates>) {
    if (patch.instruction !== undefined) templates.instruction = patch.instruction;
    if (patch.payment !== undefined) templates.payment = patch.payment;
    if (patch.expiryReminder !== undefined) templates.expiryReminder = patch.expiryReminder;
    if (patch.broadcast !== undefined) templates.broadcast = patch.broadcast;
    saveTemplates();
    return getTemplates();
}

export function initDb() {
    ensureDataDir();
    loadMainDb();
    loadPayments();
    loadNotificationLog();
    loadTemplates();
    loadSettings();
    console.log(`[DB] Loaded ${Object.keys(mainDb.users).length} users, ${Object.keys(paymentDb.payments).length} payments, autoNotifications: ${settings.autoNotificationsEnabled}`);

    setInterval(() => {
        loadMainDb();
    }, 30_000);
}

export function getAllUsers() {
    return mainDb.users;
}

export function getPayment(userId: number): Payment | undefined {
    return paymentDb.payments[userId];
}

export function setPayment(userId: number, data: { paidUntil: string; amount?: number; notes?: string }) {
    const existing = paymentDb.payments[userId];
    paymentDb.payments[userId] = {
        userId,
        paidUntil: data.paidUntil,
        lastPaymentAt: new Date().toISOString(),
        amount: data.amount,
        notes: data.notes,
        type: existing?.type || "free",
        expiryReminderSent: false,
        expiredNotificationSent: false,
    };
    savePayments();
    return paymentDb.payments[userId];
}

export function setUserType(userId: number, type: UserType) {
    const existing = paymentDb.payments[userId];
    if (existing) {
        existing.type = type;
    } else {
        paymentDb.payments[userId] = {
            userId,
            paidUntil: "",
            lastPaymentAt: new Date().toISOString(),
            type,
        };
    }
    savePayments();
    return paymentDb.payments[userId];
}

export function removePayment(userId: number) {
    delete paymentDb.payments[userId];
    savePayments();
}

export function patchPayment(userId: number, patch: { paidUntil?: string; name?: string }) {
    const existing = paymentDb.payments[userId];
    if (existing) {
        if (patch.paidUntil !== undefined) existing.paidUntil = patch.paidUntil;
        if (patch.name !== undefined) existing.name = patch.name;
        existing.lastPaymentAt = new Date().toISOString();
    } else if (patch.paidUntil) {
        paymentDb.payments[userId] = {
            userId,
            paidUntil: patch.paidUntil,
            lastPaymentAt: new Date().toISOString(),
            type: "free",
            name: patch.name,
            expiryReminderSent: false,
        };
    }
    savePayments();
    return paymentDb.payments[userId];
}

export function getAllPayments() {
    return paymentDb.payments;
}

export function addNotificationLog(entry: Omit<NotificationLog, "sentAt">) {
    notificationLog.push({ ...entry, sentAt: new Date().toISOString() });
    saveNotificationLog();
}

export function getNotificationLog() {
    return notificationLog;
}

export function getExpiringUsers(daysThreshold: number) {
    const now = new Date();
    const threshold = new Date(now.getTime() + daysThreshold * 24 * 60 * 60 * 1000);
    const result: { user: User; payment: Payment }[] = [];

    for (const [idStr, payment] of Object.entries(paymentDb.payments)) {
        const userId = Number(idStr);
        if (payment.expiryReminderSent) continue;
        const paidUntil = new Date(payment.paidUntil);
        if (paidUntil <= threshold && paidUntil >= now) {
            const user = mainDb.users[userId];
            if (user) {
                result.push({ user, payment });
            }
        }
    }
    return result;
}

export function getExpiredUsers() {
    const now = new Date();
    const result: { user: User; payment: Payment }[] = [];

    for (const [idStr, payment] of Object.entries(paymentDb.payments)) {
        const userId = Number(idStr);
        if (payment.expiredNotificationSent) continue;
        const paidUntil = new Date(payment.paidUntil);
        if (paidUntil < now) {
            const user = mainDb.users[userId];
            if (user) {
                result.push({ user, payment });
            }
        }
    }
    return result;
}

export function getUnpaidUsers() {
    const now = new Date();
    const result: User[] = [];

    for (const [idStr, user] of Object.entries(mainDb.users)) {
        const userId = Number(idStr);
        if (!user.hasAccess) continue;
        const payment = paymentDb.payments[userId];
        if (payment && payment.type === "paid" && new Date(payment.paidUntil) < now) {
            result.push(user);
        }
    }
    return result;
}

export function getNewUsers(): number[] {
    const currentIds = new Set(Object.keys(mainDb.users).map(Number));
    return [...currentIds].filter((id) => !previousUserIds.has(id));
}

export function getFirstTrafficUsers(): number[] {
    const result: number[] = [];
    for (const [idStr, user] of Object.entries(mainDb.users)) {
        const id = Number(idStr);
        const totalRx = (user.configs || []).reduce((s, c) => s + (c.totalRx || 0), 0);
        const prevRx = previousTraffic.get(id) || 0;
        if (totalRx > 0 && prevRx === 0) {
            result.push(id);
        }
    }
    return result;
}

export function markOnboardingSent(userId: number) {
    const existing = paymentDb.payments[userId];
    if (existing) {
        existing.onboardingSent = true;
    } else {
        paymentDb.payments[userId] = {
            userId,
            paidUntil: "",
            lastPaymentAt: new Date().toISOString(),
            type: "free",
            onboardingSent: true,
        };
    }
    savePayments();
}

export function markFirstPaymentSent(userId: number) {
    const existing = paymentDb.payments[userId];
    if (existing) {
        existing.firstPaymentSent = true;
    } else {
        paymentDb.payments[userId] = {
            userId,
            paidUntil: "",
            lastPaymentAt: new Date().toISOString(),
            type: "free",
            firstPaymentSent: true,
        };
    }
    savePayments();
}

export function markExpiryReminderSent(userId: number) {
    const existing = paymentDb.payments[userId];
    if (existing) {
        existing.expiryReminderSent = true;
    } else {
        paymentDb.payments[userId] = {
            userId,
            paidUntil: "",
            lastPaymentAt: new Date().toISOString(),
            type: "free",
            expiryReminderSent: true,
        };
    }
    savePayments();
}

export function markExpiredNotificationSent(userId: number) {
    const existing = paymentDb.payments[userId];
    if (existing) {
        existing.expiredNotificationSent = true;
    } else {
        paymentDb.payments[userId] = {
            userId,
            paidUntil: "",
            lastPaymentAt: new Date().toISOString(),
            type: "free",
            expiredNotificationSent: true,
        };
    }
    savePayments();
}

export function getUserPayment(userId: number): Payment | undefined {
    return paymentDb.payments[userId];
}

export function getSettings(): Settings {
    return { ...settings };
}

export function patchSettings(patch: Partial<Settings>): Settings {
    if (patch.autoNotificationsEnabled !== undefined) settings.autoNotificationsEnabled = patch.autoNotificationsEnabled;
    saveSettings();
    return getSettings();
}
