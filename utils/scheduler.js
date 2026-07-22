const cron = require('node-cron');
const pool = require('../db');
const { sendPushNotification } = require('./push');

function startScheduler() {
    cron.schedule('*/15 * * * *', async () => {
        console.log('[Scheduler] Checking for upcoming bookings...');
        try {
            const result = await pool.query(
                `SELECT 
                    b.id,
                    b.booking_date,
                    b.start_time,
                    f.name AS facility_name,
                    u.push_token
                 FROM booking b
                 JOIN facility f ON b.facility_id = f.id
                 JOIN "user" u ON b.user_id = u.id
                 WHERE b.status IN ('confirmed', 'pending')
                 AND b.reminder_sent = FALSE
                 AND u.push_token IS NOT NULL
                 AND (
                     b.booking_date::date + b.start_time::time
                 ) BETWEEN (NOW() + INTERVAL '55 minutes') AND (NOW() + INTERVAL '70 minutes')`
            );

            if (result.rows.length === 0) {
                console.log('[Scheduler] No upcoming bookings to notify.');
                return;
            }

            console.log(`[Scheduler] Sending ${result.rows.length} reminder(s)...`);

            for (const booking of result.rows) {
                try {
                    await sendPushNotification(
                        booking.push_token,
                        '⏰ Booking Reminder',
                        `Your booking at ${booking.facility_name} starts in about 1 hour!`,
                        { route: 'Bookings' }
                    );

                    await pool.query(
                        'UPDATE booking SET reminder_sent = TRUE WHERE id = $1',
                        [booking.id]
                    );

                    console.log(`[Scheduler] Reminder sent for booking #${booking.id}`);
                } catch (err) {
                    console.error(`[Scheduler] Failed to notify booking #${booking.id}:`, err);
                }
            }
        } catch (err) {
            console.error('[Scheduler] Error running reminder job:', err);
        }
    });

    cron.schedule('* * * * *', async () => {
    try {
        await pool.query(
            `UPDATE booking
             SET status = 'active'
             WHERE status = 'confirmed'
             AND (booking_date::date + start_time::time) <= NOW()
             AND (booking_date::date + end_time::time) > NOW()`
        );

        await pool.query(
            `UPDATE booking
             SET status = 'completed'
             WHERE status IN ('confirmed', 'active')
             AND (booking_date::date + end_time::time) <= NOW()`
        );
    } catch (err) {
        console.error('[Scheduler] Error updating booking statuses:', err);
    }
});

    console.log('[Scheduler] Booking reminder scheduler started.');
}

module.exports = { startScheduler };