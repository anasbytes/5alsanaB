const express = require('express');
const router = express.Router();
const pool = require('../db');
const authenticateToken = require('../middleware/authMiddleware');
const { body, validationResult } = require('express-validator');

function requireHost(req, res, next) {
    if (req.user.role !== 'host') return res.status(403).json({ error: 'Only hosts can perform this action' });
    next();
}

// GET /rooms/facility/:facilityId — public, returns active rooms for a facility
router.get('/facility/:facilityId', async (req, res) => {
    const { facilityId } = req.params;
    try {
        const result = await pool.query(
            'SELECT * FROM room WHERE facility_id = $1 AND is_active = true ORDER BY id ASC',
            [facilityId]
        );
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /rooms — host creates a room for one of their facilities
router.post('/', authenticateToken, requireHost,
    body('facility_id').isInt().withMessage('Valid facility ID required'),
    body('name').trim().notEmpty().isLength({ max: 100 }).withMessage('Room name required'),
    body('price_per_hour').isFloat({ min: 0 }).withMessage('Valid price required'),
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const { facility_id, name, price_per_hour } = req.body;
        const ownerId = req.user.userId;
        try {
            const facilityCheck = await pool.query(
                'SELECT id FROM facility WHERE id = $1 AND owner_id = $2 AND is_active = true',
                [facility_id, ownerId]
            );
            if (facilityCheck.rows.length === 0) return res.status(404).json({ error: 'Facility not found or unauthorized' });

            const result = await pool.query(
                'INSERT INTO room (facility_id, name, price_per_hour) VALUES ($1, $2, $3) RETURNING *',
                [facility_id, name, price_per_hour]
            );
            res.status(201).json(result.rows[0]);
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: 'Server error' });
        }
    }
);

// PUT /rooms/:id — host updates a room
router.put('/:id', authenticateToken, requireHost,
    body('name').trim().notEmpty().isLength({ max: 100 }).withMessage('Room name required'),
    body('price_per_hour').isFloat({ min: 0 }).withMessage('Valid price required'),
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

        const { id } = req.params;
        const { name, price_per_hour } = req.body;
        const ownerId = req.user.userId;
        try {
            const result = await pool.query(
                `UPDATE room SET name = $1, price_per_hour = $2
                 FROM facility
                 WHERE room.id = $3 AND room.facility_id = facility.id AND facility.owner_id = $4
                 RETURNING room.*`,
                [name, price_per_hour, id, ownerId]
            );
            if (result.rows.length === 0) return res.status(404).json({ error: 'Room not found or unauthorized' });
            res.json(result.rows[0]);
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: 'Server error' });
        }
    }
);

// DELETE /rooms/:id — soft delete
router.delete('/:id', authenticateToken, requireHost, async (req, res) => {
    const { id } = req.params;
    const ownerId = req.user.userId;
    try {
        const result = await pool.query(
            `UPDATE room SET is_active = false
             FROM facility
             WHERE room.id = $1 AND room.facility_id = facility.id AND facility.owner_id = $2
             RETURNING room.*`,
            [id, ownerId]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Room not found or unauthorized' });
        res.json({ message: 'Room deactivated', room: result.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;