export interface UserConfig {
    creator: number;
    userGivenName: string;
    wgEasyClientId: string;
    deviceId: string;
    createdAt: string;
    isEnabled: boolean;
    totalRx?: number;
    totalTx?: number;
    lastKnownRx?: number;
    lastKnownTx?: number;
    latestHandshakeAt?: string | null;
    sharedWith?: number;
    dailyUsage?: { date: string; rx: number; tx: number }[];
}

export interface User {
    id: number;
    username?: string;
    hasAccess: boolean;
    accessRequestedAt?: string;
    accessGrantedAt?: string;
    configs: UserConfig[];
    subnets: Record<string, boolean>;
    settings: { utc: number; city?: string; chart?: any };
    state?: { action: string; data?: any; messageId?: number };
}

export interface Database {
    users: Record<number, User>;
    accessRequests: Record<number, any>;
    configOwnershipTokens: Record<string, any>;
    subnets: Record<string, any>;
}

export type UserType = "free" | "paid";

export interface Payment {
    userId: number;
    paidUntil: string;
    lastPaymentAt: string;
    amount?: number;
    notes?: string;
    type: UserType;
    name?: string;
    onboardingSent?: boolean;
    firstPaymentSent?: boolean;
    expiryReminderSent?: boolean;
    expiredNotificationSent?: boolean;
}

export interface PaymentDB {
    payments: Record<number, Payment>;
}

export interface NotificationLog {
    userId: number;
    message: string;
    sentAt: string;
    type: 'reminder' | 'expiry' | 'manual' | 'payment_confirmed' | 'onboarding' | 'first_payment';
}

export interface MessageTemplates {
    instruction: string;
    payment: string;
    expiryReminder: string;
    broadcast: string;
}

export interface Settings {
    autoNotificationsEnabled: boolean;
}
