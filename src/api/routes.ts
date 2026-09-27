import { Hono } from "hono";
import { readFile } from "fs/promises";
import { join } from "path";
import {
    getAllUsers,
    getPayment,
    setPayment,
    setUserType,
    patchPayment,
    getAllPayments,
    getUnpaidUsers,
    getTemplates,
    patchTemplates,
    getSettings,
    patchSettings,
} from "../db/index";
import {
    sendMessage,
    sendPaymentConfirmed,
    broadcastMessage,
} from "../bot";

const app = new Hono();

const WEB_SECRET = process.env.WEB_SECRET || "admin";

function checkAuth(c: any) {
    const auth = c.req.header("Authorization");
    if (auth === `Bearer ${WEB_SECRET}`) return true;
    const cookie = c.req.header("Cookie") || "";
    if (cookie.includes(`secret=${WEB_SECRET}`)) return true;
    return false;
}

app.get("/api/users", (c) => {
    if (!checkAuth(c)) return c.json({ error: "Unauthorized" }, 401);

    const users = getAllUsers();
    const payments = getAllPayments();
    const now = new Date();

    const list = Object.values(users).map((u) => {
        const payment = payments[u.id];
        let status: string = "unpaid";
        let paidUntil: string | null = null;

        if (payment) {
            paidUntil = payment.paidUntil;
            const until = payment.paidUntil ? new Date(payment.paidUntil) : null;
            if (payment.type === "paid" && until && !isNaN(until.getTime())) {
                if (until > now) {
                    const daysLeft = Math.ceil((until.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                    if (daysLeft <= 3) status = "expiring";
                    else status = "paid";
                } else {
                    status = "expired";
                }
            }
        }

        const configs = u.configs || [];
        const totalRx = configs.reduce((s, c) => s + (c.totalRx || 0), 0);
        const totalTx = configs.reduce((s, c) => s + (c.totalTx || 0), 0);
        const activeConfigs = configs.filter((c) => c.isEnabled).length;
        const lastActiveAt = configs
            .filter((c) => c.isEnabled && c.latestHandshakeAt)
            .sort((a, b) => new Date(b.latestHandshakeAt!).getTime() - new Date(a.latestHandshakeAt!).getTime())[0]?.latestHandshakeAt || null;

        return {
            id: u.id,
            username: u.username,
            name: payment?.name || "",
            hasAccess: u.hasAccess,
            configCount: configs.length,
            activeConfigs,
            accessGrantedAt: u.accessGrantedAt,
            paidUntil,
            status,
            totalRx,
            totalTx,
            lastActiveAt,
            type: payment?.type || "free",
        };
    });

    return c.json(list);
});

app.get("/api/users/:id", (c) => {
    if (!checkAuth(c)) return c.json({ error: "Unauthorized" }, 401);

    const id = Number(c.req.param("id"));
    const users = getAllUsers();
    const user = users[id];
    if (!user) return c.json({ error: "User not found" }, 404);

    const payment = getPayment(id);
    return c.json({ user, payment });
});

app.post("/api/payments/:userId", async (c) => {
    if (!checkAuth(c)) return c.json({ error: "Unauthorized" }, 401);

    const userId = Number(c.req.param("userId"));
    const body = await c.req.json();
    const { paidUntil, amount, notes } = body;

    if (!paidUntil) return c.json({ error: "paidUntil is required" }, 400);

    const payment = setPayment(userId, { paidUntil, amount, notes });

    await sendPaymentConfirmed(userId, paidUntil);

    return c.json({ ok: true, payment });
});

app.post("/api/users/:userId/type", async (c) => {
    if (!checkAuth(c)) return c.json({ error: "Unauthorized" }, 401);

    const userId = Number(c.req.param("userId"));
    const body = await c.req.json();
    const { type } = body;

    if (type !== "free" && type !== "paid") {
        return c.json({ error: "type must be 'free' or 'paid'" }, 400);
    }

    const payment = setUserType(userId, type);
    return c.json({ ok: true, payment });
});

app.patch("/api/payments/:userId", async (c) => {
    if (!checkAuth(c)) return c.json({ error: "Unauthorized" }, 401);

    const userId = Number(c.req.param("userId"));
    const body = await c.req.json();
    const { paidUntil, name } = body;

    const payment = patchPayment(userId, { paidUntil, name });
    return c.json({ ok: true, payment });
});

app.post("/api/notify/unpaid", async (c) => {
    if (!checkAuth(c)) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const { message } = body;

    if (!message) return c.json({ error: "message is required" }, 400);

    const unpaid = getUnpaidUsers();
    let sent = 0;
    for (const user of unpaid) {
        const ok = await sendMessage(user.id, message);
        if (ok) sent++;
        await new Promise((r) => setTimeout(r, 100));
    }
    return c.json({ ok: true, total: unpaid.length, sent });
});

app.post("/api/notify/:userId", async (c) => {
    if (!checkAuth(c)) return c.json({ error: "Unauthorized" }, 401);

    const userId = Number(c.req.param("userId"));
    const body = await c.req.json();
    const { message } = body;

    if (!message) return c.json({ error: "message is required" }, 400);

    const sent = await sendMessage(userId, message);
    return c.json({ ok: sent });
});

app.post("/api/broadcast", async (c) => {
    if (!checkAuth(c)) return c.json({ error: "Unauthorized" }, 401);

    const body = await c.req.json();
    const { message } = body;

    if (!message) return c.json({ error: "message is required" }, 400);

    const users = getAllUsers();
    const userIds = Object.values(users).filter((u) => u.hasAccess).map((u) => u.id);
    const result = await broadcastMessage(userIds, message);
    return c.json({ ok: true, ...result });
});

app.get("/api/templates", (c) => {
    if (!checkAuth(c)) return c.json({ error: "Unauthorized" }, 401);
    return c.json(getTemplates());
});

app.patch("/api/templates", async (c) => {
    if (!checkAuth(c)) return c.json({ error: "Unauthorized" }, 401);
    const body = await c.req.json();
    const result = patchTemplates(body);
    return c.json({ ok: true, templates: result });
});

app.get("/api/stats", (c) => {
    if (!checkAuth(c)) return c.json({ error: "Unauthorized" }, 401);

    const users = getAllUsers();
    const payments = getAllPayments();
    const now = new Date();

    let paid = 0, unpaid = 0, expiring = 0, expired = 0, noAccess = 0;

    for (const u of Object.values(users)) {
        if (!u.hasAccess) { noAccess++; continue; }
        const p = payments[u.id];
        if (!p) { unpaid++; continue; }
        const until = p.paidUntil ? new Date(p.paidUntil) : null;
        if (!until || isNaN(until.getTime())) { unpaid++; continue; }
        if (until < now) { expired++; continue; }
        const days = Math.ceil((until.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        if (days <= 3) expiring++;
        else paid++;
    }

    return c.json({ total: Object.keys(users).length, paid, unpaid, expiring, expired, noAccess });
});

app.get("/api/settings", (c) => {
    if (!checkAuth(c)) return c.json({ error: "Unauthorized" }, 401);
    return c.json(getSettings());
});

app.patch("/api/settings", async (c) => {
    if (!checkAuth(c)) return c.json({ error: "Unauthorized" }, 401);
    const body = await c.req.json();
    const result = patchSettings(body);
    return c.json({ ok: true, settings: result });
});

app.get("/dashboard", async (c) => {
    const htmlPath = join(import.meta.dir, "../web/dashboard.html");
    const html = await readFile(htmlPath, "utf-8");
    c.header("Cache-Control", "no-store, no-cache, must-revalidate");
    return c.html(html);
});

app.get("/", async (c) => {
    const htmlPath = join(import.meta.dir, "../web/dashboard.html");
    const html = await readFile(htmlPath, "utf-8");
    c.header("Cache-Control", "no-store, no-cache, must-revalidate");
    return c.html(html);
});

export default app;
