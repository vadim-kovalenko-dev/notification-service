import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { initDb, getExpiringUsers, getExpiredUsers, getNewUsers, getFirstTrafficUsers, getUserPayment, markOnboardingSent, markFirstPaymentSent, markExpiryReminderSent, markExpiredNotificationSent, getSettings } from "./db/index";
import { sendExpiryReminder, sendExpiredNotification, sendOnboarding, sendFirstPaymentRequest, isBotConfigured } from "./bot";
import apiRoutes from "./api/routes";

const PORT = Number(process.env.WEB_PORT) || 3000;

const app = new Hono();

app.route("/", apiRoutes);

async function checkSubscriptions() {
    if (!isBotConfigured()) {
        console.log("[Cron] Bot token not configured, skipping subscription check");
        return;
    }

    const settings = getSettings();
    if (!settings.autoNotificationsEnabled) {
        console.log("[Cron] Auto notifications disabled, skipping subscription check");
        return;
    }

    console.log("[Cron] Checking subscriptions...");

    const expiring = getExpiringUsers(3);
    for (const { user, payment } of expiring) {
        const paidUntil = new Date(payment.paidUntil);
        const now = new Date();
        const daysLeft = Math.ceil((paidUntil.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        const ok = await sendExpiryReminder(user.id, daysLeft);
        if (ok) markExpiryReminderSent(user.id);
        await new Promise((r) => setTimeout(r, 200));
    }

    const expired = getExpiredUsers();
    for (const { user } of expired) {
        const ok = await sendExpiredNotification(user.id);
        if (ok) markExpiredNotificationSent(user.id);
        await new Promise((r) => setTimeout(r, 200));
    }

    console.log(`[Cron] Done. Expiring: ${expiring.length}, Expired: ${expired.length}`);
}

async function checkNewUsersAndTraffic() {
    if (!isBotConfigured()) return;

    const settings = getSettings();
    if (!settings.autoNotificationsEnabled) return;

    const newUsers = getNewUsers();
    for (const userId of newUsers) {
        const payment = getUserPayment(userId);
        if (!payment?.onboardingSent) {
            console.log(`[Auto] Sending onboarding to new user ${userId}`);
            const ok = await sendOnboarding(userId);
            if (ok) markOnboardingSent(userId);
            await new Promise((r) => setTimeout(r, 200));
        }
    }

    const trafficUsers = getFirstTrafficUsers();
    for (const userId of trafficUsers) {
        const payment = getUserPayment(userId);
        if (!payment?.firstPaymentSent) {
            console.log(`[Auto] Sending first payment request to ${userId}`);
            const ok = await sendFirstPaymentRequest(userId);
            if (ok) markFirstPaymentSent(userId);
            await new Promise((r) => setTimeout(r, 200));
        }
    }
}

initDb();

function scheduleDailyAt9() {
    const now = new Date();
    const next = new Date(now);
    next.setHours(9, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    const delay = next.getTime() - now.getTime();
    console.log(`[Cron] checkSubscriptions scheduled at ${next.toLocaleString("ru-RU")} (${Math.round(delay / 60000)} min)`);
    setTimeout(() => {
        checkSubscriptions();
        setInterval(checkSubscriptions, 24 * 60 * 60 * 1000);
    }, delay);
}

scheduleDailyAt9();

setInterval(checkNewUsersAndTraffic, 30_000);

setTimeout(checkNewUsersAndTraffic, 10_000);

serve({ fetch: app.fetch, port: PORT }, (info) => {
    console.log(`[Server] Dashboard running at http://0.0.0.0:${info.port}`);
    console.log(`[Server] Bot configured: ${isBotConfigured()}`);
});
