const express = require('express');
const router = express.Router();
const pool = require('../db');
const authenticateToken = require('../middleware/auth');
const { body, validationResult } = require('express-validator');

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
            res.status(201).json(result.rows[0]);
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
    body('status').isIn(['confirmed', 'cancelled', 'completed']).withMessage('Status must be confirmed, cancelled, or completed'),
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

module.exports = router;