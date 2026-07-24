const express = require('express');
const router = express.Router();
const pool = require('../db');
const authenticateToken = require('../middleware/authMiddleware');
const { sendPushNotification } = require('../utils/push');

router.post('/', authenticateToken, async (req, res) => {
    const userId = req.user.userId;
    const { facility_id, booking_date, start_time, end_time } = req.body;

    if (!facility_id || !booking_date || !start_time || !end_time) {
        return res.status(400).json({ error: 'facility_id, booking_date, start_time and end_time are required.' });
    }

    try {
        await pool.query(
            `INSERT INTO waitlist (user_id, facility_id, booking_date, start_time, end_time)
             VALUES ($1, $2, $3, $4, $5)`,
            [userId, facility_id, booking_date, start_time, end_time]
        );
        res.status(201).json({ message: 'Added to waitlist.' });
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ error: 'Already on waitlist for this slot.' });
        }
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

router.delete('/', authenticateToken, async (req, res) => {
    const userId = req.user.userId;
    const { facility_id, booking_date, start_time, end_time } = req.body;

    try {
        const result = await pool.query(
            `DELETE FROM waitlist
             WHERE user_id = $1 AND facility_id = $2 AND booking_date = $3 AND start_time = $4 AND end_time = $5`,
            [userId, facility_id, booking_date, start_time, end_time]
        );
        if (result.rowCount === 0) return res.status(404).json({ error: 'Not on waitlist.' });
        res.json({ message: 'Removed from waitlist.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

router.get('/check', authenticateToken, async (req, res) => {
    const userId = req.user.userId;
    const { facility_id, booking_date, start_time, end_time } = req.query;

    try {
        const result = await pool.query(
            `SELECT id FROM waitlist
             WHERE user_id = $1 AND facility_id = $2 AND booking_date = $3 AND start_time = $4 AND end_time = $5`,
            [userId, facility_id, booking_date, start_time, end_time]
        );
        res.json({ on_waitlist: result.rows.length > 0 });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

async function notifyWaitlist(facility_id, booking_date, start_time, end_time) {
    try {
        const waitlisted = await pool.query(
            `SELECT w.user_id, u.push_token, f.name AS facility_name
             FROM waitlist w
             JOIN "user" u ON w.user_id = u.id
             JOIN facility f ON w.facility_id = f.id
             WHERE w.facility_id = $1 AND w.booking_date = $2 AND w.start_time = $3 AND w.end_time = $4
             AND u.push_token IS NOT NULL
             ORDER BY w.created_at ASC`,
            [facility_id, booking_date, start_time, end_time]
        );

        for (const entry of waitlisted.rows) {
            await sendPushNotification(
                entry.push_token,
                '🎉 Slot Available!',
                `A slot you were waiting for at ${entry.facility_name} just opened up. Book now before it's gone!`,
                { route: 'Home' }
            );
        }

        await pool.query(
            `DELETE FROM waitlist WHERE facility_id = $1 AND booking_date = $2 AND start_time = $3 AND end_time = $4`,
            [facility_id, booking_date, start_time, end_time]
        );
    } catch (err) {
        console.error('[Waitlist] Failed to notify waitlist:', err);
    }
}

module.exports = { router, notifyWaitlist };