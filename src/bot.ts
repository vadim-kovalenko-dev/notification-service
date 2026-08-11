import { addNotificationLog, getTemplates } from "./db/index";
import { execFileSync } from "child_process";

const BOT_TOKEN = process.env.NOTIFICATION_BOT_TOKEN || "";

const API_URL = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;

export async function sendMessage(userId: number, text: string): Promise<boolean> {
    try {
        const body = JSON.stringify({ chat_id: userId, text, parse_mode: "HTML" });
        const result = execFileSync(
            "curl", ["-s", "-4", "-k", "-X", "POST", API_URL,
                "-H", "Content-Type: application/json",
                "-d", body],
            { timeout: 10000 }
        ).toString();
        const data = JSON.parse(result);
        if (!data.ok) {
            console.error(`[Telegram] Failed to send to ${userId}:`, data.description);
            return false;
        }
        addNotificationLog({ userId, message: text, type: "manual" });
        return true;
    } catch (e) {
        console.error(`[Telegram] Error sending to ${userId}:`, e);
        return false;
    }
}

export async function sendPaymentConfirmed(userId: number, paidUntil: string): Promise<boolean> {
    const date = new Date(paidUntil).toLocaleDateString("ru-RU");
    const text = `✅ Оплата подтверждена!\n\nВаша подписка действует до: <b>${date}</b>\n\nСпасибо за оплату!`;
    return sendMessage(userId, text);
}

export async function sendExpiryReminder(userId: number, daysLeft: number): Promise<boolean> {
    const tpl = getTemplates().expiryReminder || getTemplates().payment;
    if (!tpl) return false;
    const result = await sendMessage(userId, tpl);
    if (result) {
        addNotificationLog({ userId, message: tpl, type: "reminder" });
    }
    return result;
}

export async function sendExpiredNotification(userId: number): Promise<boolean> {
    const tpl = getTemplates().payment;
    if (!tpl) return false;
    const result = await sendMessage(userId, tpl);
    if (result) {
        addNotificationLog({ userId, message: tpl, type: "expiry" });
    }
    return result;
}

export function isBotConfigured(): boolean {
    return BOT_TOKEN.length > 0;
}

export async function sendOnboarding(userId: number): Promise<boolean> {
    const tpl = getTemplates().instruction;
    if (!tpl) return false;
    const result = await sendMessage(userId, tpl);
    if (result) {
        addNotificationLog({ userId, message: tpl, type: "onboarding" });
    }
    return result;
}

export async function sendFirstPaymentRequest(userId: number): Promise<boolean> {
    const tpl = getTemplates().payment;
    if (!tpl) return false;
    const result = await sendMessage(userId, tpl);
    if (result) {
        addNotificationLog({ userId, message: tpl, type: "first_payment" });
    }
    return result;
}

export async function broadcastMessage(userIds: number[], text: string): Promise<{ total: number; sent: number }> {
    let sent = 0;
    for (const id of userIds) {
        const ok = await sendMessage(id, text);
        if (ok) sent++;
        await new Promise((r) => setTimeout(r, 200));
    }
    return { total: userIds.length, sent };
}
