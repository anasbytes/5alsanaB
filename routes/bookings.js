const express = require('express');
const router = express.Router();
const pool = require('../db');
const authenticateToken = require('../middleware/authMiddleware');
const { body, validationResult } = require('express-validator');
const { sendPushNotification } = require('../utils/push');
const { notifyWaitlist } = require('./waitlist');

router.post('/', authenticateToken,
    body('facility_id').isInt().withMessage('Valid facility ID is required'),
    body('room_id').isInt().withMessage('Valid room ID is required'),
    body('booking_date').isDate().withMessage('Valid date is required'),
    body('start_time').notEmpty().withMessage('Start time is required'),
    body('end_time').notEmpty().withMessage('End time is required'),
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        const { facility_id, room_id, booking_date, start_time, end_time } = req.body;
        const user_id = req.user.userId;

        if (end_time <= start_time) {
            return res.status(400).json({ error: 'End time must be after start time.' });
        }
        const today = new Date().toISOString().split('T')[0];
        if (booking_date < today) {
            return res.status(400).json({ error: 'Booking date cannot be in the past.' });
        }

        const client = await pool.connect();

        try {
            await client.query('BEGIN');
            await client.query('SELECT id FROM facility WHERE id = $1 FOR UPDATE', [facility_id]);

            const roomCheck = await pool.query(
                'SELECT id FROM room WHERE id = $1 AND facility_id = $2 AND is_active = true',
                [room_id, facility_id]
            );
            if (roomCheck.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'Room not found or does not belong to this facility.' });
            }

            const blockCheck = await client.query(
                `SELECT id FROM blocked_slot
                 WHERE facility_id = $1
                 AND blocked_date = $2
                 AND (room_id IS NULL OR room_id = $3)
                 AND (
                   is_full_day = true
                   OR (start_time < $5 AND end_time > $4)
                 )`,
                [facility_id, booking_date, room_id, start_time, end_time]
            );
            if (blockCheck.rows.length > 0) {
                await client.query('ROLLBACK');
                return res.status(409).json({ error: 'This slot is blocked by the host.' });
            }

            const overlapCheck = await client.query(
                `SELECT id FROM booking
                 WHERE room_id = $1
                 AND booking_date = $2
                 AND status IN ('confirmed', 'pending')
                 AND (start_time < $4 AND end_time > $3)`,
                [room_id, booking_date, start_time, end_time]
            );

            if (overlapCheck.rows.length > 0) {
                await client.query('ROLLBACK');
                return res.status(409).json({ error: 'Time slot is already booked or pending.' });
            }

            const result = await client.query(
                'INSERT INTO booking (user_id, facility_id, room_id, booking_date, start_time, end_time, status) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
                [user_id, facility_id, room_id, booking_date, start_time, end_time, 'pending']
            );
            const booking = result.rows[0];

            await client.query('COMMIT');

            const facilityResult = await pool.query(
                `SELECT f.name, u.push_token 
                 FROM facility f 
                 JOIN "user" u ON f.owner_id = u.id 
                 WHERE f.id = $1`,
                [facility_id]
            );

            if (facilityResult.rows.length > 0 && facilityResult.rows[0].push_token) {
                const { name, push_token } = facilityResult.rows[0];
                await sendPushNotification(
                    push_token,
                    'New Booking Request',
                    `Someone requested to book ${name} on ${booking_date}.`,
                    { route: 'HostRequests', bookingId: booking.id }
                );
            }

            res.status(201).json(booking);
        } catch (err) {
            await client.query('ROLLBACK');
            console.error(err);
            res.status(500).json({ error: 'Server error' });
        } finally {
            client.release();
        }
    }
);

router.get('/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    const userId = req.user.userId;
    try {
        const result = await pool.query(
            `SELECT b.* 
             FROM booking b
             JOIN facility f ON b.facility_id = f.id
             WHERE b.id = $1 AND (b.user_id = $2 OR f.owner_id = $2)`,
            [id, userId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Booking not found or unauthorized' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

router.get('/facility/:facilityId', authenticateToken, async (req, res) => {
    const { facilityId } = req.params;
    const { room_id } = req.query;
    try {
        const params = [facilityId];
        let query = "SELECT * FROM booking WHERE facility_id = $1 AND booking_date >= CURRENT_DATE AND status IN ('confirmed', 'pending')";
        if (room_id) {
            params.push(room_id);
            query += ` AND room_id = $2`;
        }
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

router.get('/player/me', authenticateToken, async (req, res) => {
    const userId = req.user.userId;
    try {
        const result = await pool.query(
            `SELECT booking.*, facility.name AS facility_name, facility.type AS facility_type,
            facility.location AS facility_location,
            room.name AS room_name, room.price_per_hour AS price_per_hour,
            (EXTRACT(EPOCH FROM (booking.end_time::time - booking.start_time::time)) / 3600) * room.price_per_hour AS total_price,
            COALESCE(json_agg(fi.image_url ORDER BY fi.display_order) FILTER (WHERE fi.image_url IS NOT NULL), '[]') AS images
     FROM booking
     JOIN facility ON booking.facility_id = facility.id
     LEFT JOIN room ON booking.room_id = room.id
     LEFT JOIN facility_image fi ON fi.facility_id = facility.id
     WHERE booking.user_id = $1
     GROUP BY booking.id, facility.name, facility.type, facility.location, room.name, room.price_per_hour
     ORDER BY booking.booking_date DESC, booking.start_time DESC`,
            [userId]
        );
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

router.put('/:bookingId/cancel', authenticateToken, async (req, res) => {
    const { bookingId } = req.params;
    const userId = req.user.userId;
    try {
        const result = await pool.query(
            "UPDATE booking SET status = 'cancelled' WHERE id = $1 AND user_id = $2 RETURNING *",
            [bookingId, userId]
        );
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Booking not found or unauthorized' });
        }
        const booking = result.rows[0];

        const facilityResult = await pool.query(
            `SELECT f.name, u.push_token 
             FROM facility f 
             JOIN "user" u ON f.owner_id = u.id 
             WHERE f.id = $1`,
            [booking.facility_id]
        );

        if (facilityResult.rows.length > 0 && facilityResult.rows[0].push_token) {
            const { name, push_token } = facilityResult.rows[0];
            await sendPushNotification(
                push_token,
                'Booking Cancelled',
                `A player has cancelled their booking for ${name} on ${booking.booking_date}.`,
                { route: 'HostRequests', bookingId: booking.id }
            );
        }

        res.json(booking);

        notifyWaitlist(booking.facility_id, booking.booking_date, booking.start_time, booking.end_time);
    } catch (err) {
        console.error('Cancel Error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

router.get('/host/me', authenticateToken, async (req, res) => {
    const ownerId = req.user.userId;
    try {
        const result = await pool.query(
            `SELECT b.id, b.booking_date, b.start_time, b.end_time, b.status,
                    f.name AS facility_name,
                    r.name AS room_name, r.price_per_hour,
                    u.username AS player_name,
                    (EXTRACT(EPOCH FROM (b.end_time::time - b.start_time::time)) / 3600) * r.price_per_hour AS total_price
             FROM booking b
             JOIN facility f ON b.facility_id = f.id
             LEFT JOIN room r ON b.room_id = r.id
             JOIN "user" u ON b.user_id = u.id
             WHERE f.owner_id = $1
             ORDER BY b.booking_date DESC, b.start_time DESC`,
            [ownerId]
        );
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error while fetching host bookings.' });
    }
});

const VALID_TRANSITIONS = {
    pending: ['confirmed', 'cancelled'],
    confirmed: ['completed', 'cancelled'],
    cancelled: [],
    completed: []
};

router.put('/:id/status', authenticateToken,
    body('status').trim().notEmpty().withMessage('Status is required'),
    body('status').isIn(['pending', 'confirmed', 'cancelled', 'completed']).withMessage('Invalid status'),
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        const { id } = req.params;
        const { status } = req.body;
        const hostId = req.user.userId;
        try {
            const current = await pool.query(
                `SELECT b.status FROM booking b
                 JOIN facility f ON b.facility_id = f.id
                 WHERE b.id = $1 AND f.owner_id = $2`,
                [id, hostId]
            );
            if (current.rows.length === 0) {
                return res.status(404).json({ error: 'Booking not found or unauthorized' });
            }
            const currentStatus = current.rows[0].status;
            if (!VALID_TRANSITIONS[currentStatus].includes(status)) {
                return res.status(400).json({ error: `Cannot change status from ${currentStatus} to ${status}` });
            }

            const result = await pool.query(
                `UPDATE booking b
                 SET status = $1
                 FROM facility f
                 WHERE b.id = $2 AND b.facility_id = f.id AND f.owner_id = $3
                 RETURNING b.*`,
                [status, id, hostId]
            );
            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'Booking not found or unauthorized' });
            }
            const booking = result.rows[0];

            const playerResult = await pool.query(
                'SELECT push_token FROM "user" WHERE id = $1',
                [booking.user_id]
            );
            if (playerResult.rows.length > 0 && playerResult.rows[0].push_token) {
                const { push_token } = playerResult.rows[0];
                const statusMsg = status === 'confirmed' ? 'accepted' : 'declined';
                await sendPushNotification(
                    push_token,
                    'Booking Update',
                    `Your booking request has been ${statusMsg}.`,
                    { route: 'Bookings', bookingId: booking.id }
                );
            }

            res.json(booking);

            if (status === 'cancelled') {
                notifyWaitlist(booking.facility_id, booking.booking_date, booking.start_time, booking.end_time);
            }
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: 'Server error updating status.' });
        }
    }
);

module.exports = router;