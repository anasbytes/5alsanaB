const express = require('express');
const router = express.Router();
const pool = require('../db');
const authenticateToken = require('../middleware/auth');
const { body, validationResult } = require('express-validator');
const { sendPushNotification } = require('../utils/push');

router.get('/', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM booking');
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

router.post('/', authenticateToken,
    body('user_id').isInt().withMessage('Valid user ID is required'),
    body('facility_id').isInt().withMessage('Valid facility ID is required'),
    body('booking_date').isDate().withMessage('Valid date is required'),
    body('start_time').notEmpty().withMessage('Start time is required'),
    body('end_time').notEmpty().withMessage('End time is required'),
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        const { user_id, facility_id, booking_date, start_time, end_time } = req.body;
        try {
            const result = await pool.query(
                'INSERT INTO booking (user_id, facility_id, booking_date, start_time, end_time) VALUES ($1, $2, $3, $4, $5) RETURNING *',
                [user_id, facility_id, booking_date, start_time, end_time]
            );
            const booking = result.rows[0];

            // Notify the host
            const facilityResult = await pool.query(
                `SELECT f.name, u.push_token, u.username 
                 FROM facility f 
                 JOIN "user" u ON f.owner_id = u.id 
                 WHERE f.id = $1`,
                [facility_id]
            );
            if (facilityResult.rows.length > 0) {
                const { name, push_token } = facilityResult.rows[0];
                await sendPushNotification(
                    push_token,
                    'New Booking Request',
                    `Someone requested to book ${name} on ${booking_date}.`
                );
            }

            res.status(201).json(booking);
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: 'Server error' });
        }
    }
);

router.get('/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query('SELECT * FROM booking WHERE id = $1', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Booking not found' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

router.put('/:id', authenticateToken,
    body('status').trim().notEmpty().withMessage('Status is required'),
    body('status').isIn(['pending', 'confirmed', 'cancelled', 'completed']).withMessage('Status must be pending, confirmed, cancelled, or completed'),
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        const { id } = req.params;
        const { status } = req.body;
        try {
            const result = await pool.query(
                'UPDATE booking SET status = $1 WHERE id = $2 RETURNING *',
                [status, id]
            );
            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'Booking not found' });
            }
            res.json(result.rows[0]);
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: 'Server error' });
        }
    }
);

router.delete('/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query(
            'DELETE FROM booking WHERE id = $1 RETURNING *',
            [id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Booking not found' });
        }
        res.json({ message: 'Booking deleted', booking: result.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

router.get('/facility/:facilityId', authenticateToken, async (req, res) => {
    const { facilityId } = req.params;
    try {
        const result = await pool.query(
            "SELECT * FROM booking WHERE facility_id = $1 AND booking_date = CURRENT_DATE AND status = 'confirmed'",
            [facilityId]
        );
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

router.get('/user/:userId', authenticateToken, async (req, res) => {
    const { userId } = req.params;
    try {
        const result = await pool.query(
            `SELECT booking.*, facility.name AS facility_name, facility.type AS facility_type, 
                    facility.location AS facility_location, facility.image_url AS image_url,
                    facility.price_per_hour AS price_per_hour
             FROM booking
             JOIN facility ON booking.facility_id = facility.id
             WHERE booking.user_id = $1
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
    try {
        const result = await pool.query(
            "UPDATE booking SET status = 'cancelled' WHERE id = $1 RETURNING *",
            [bookingId]
        );
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Booking not found' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Cancel Error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

router.get('/host/:ownerId', authenticateToken, async (req, res) => {
    const { ownerId } = req.params;
    try {
        const result = await pool.query(
            `SELECT b.id, b.booking_date, b.start_time, b.end_time, b.status,
                    f.name AS facility_name, f.price_per_hour AS total_price,
                    u.username AS player_name
             FROM booking b
             JOIN facility f ON b.facility_id = f.id
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
        try {
            const result = await pool.query(
                'UPDATE booking SET status = $1 WHERE id = $2 RETURNING *',
                [status, id]
            );
            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'Booking not found' });
            }
            const booking = result.rows[0];

            const playerResult = await pool.query(
                'SELECT push_token, username FROM "user" WHERE id = $1',
                [booking.user_id]
            );
            if (playerResult.rows.length > 0) {
                const { push_token } = playerResult.rows[0];
                const statusMsg = status === 'confirmed' ? 'accepted' : 'declined';
                await sendPushNotification(
                    push_token,
                    'Booking Update',
                    `Your booking request has been ${statusMsg}.`
                );
            }

            res.json(booking);
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: 'Server error updating status.' });
        }
    }
);

module.exports = router;