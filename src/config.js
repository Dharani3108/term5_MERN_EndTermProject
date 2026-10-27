// Central configuration. Values come from environment variables (optionally
// loaded from a local .env file) with safe development defaults.
try {
  process.loadEnvFile();
} catch {
  // No .env file present: rely on the real environment.
}

const env = process.env;
const isProduction = env.NODE_ENV === 'production';

export const config = {
  isProduction,
  port: Number(env.PORT) || 3000,
  dbPath: env.DB_PATH || './data/slotwise.db',
  timezone: env.CAMPUS_TZ || 'Asia/Kolkata',
  sessionDays: 7,
  cookieSecure: isProduction,
  adminEmail: (env.ADMIN_EMAIL || 'admin@slotwise.app').toLowerCase(),
  adminPassword: env.ADMIN_PASSWORD || 'Admin@123',
  seedDemo: env.SEED_DEMO !== 'false',
  jobIntervalMs: Number(env.JOB_INTERVAL_MS) || 60_000,

  // Booking policy. These rules are what keep the schedule fair to everyone.
  policy: {
    slotMinutes: 30, // grid granularity
    bookingWindowDays: 14, // how far ahead a slot can be booked
    weeklyQuotaMinutes: 600, // 10 hours per student per week
    maxActiveBookings: 5, // upcoming bookings a student can hold at once
    maxWaitlistEntries: 5, // open waitlist entries per student
    checkInEarlyMinutes: 10, // check-in opens this long before start
    noShowGraceMinutes: 15, // unclaimed bookings are released after this
    strikeLimit: 3, // no-shows that pause booking rights
    strikeWindowDays: 30, // rolling window for counting no-shows
    reminderMinutes: 30, // reminder notification lead time
  },
};
