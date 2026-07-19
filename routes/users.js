const express = require('express');
const router = express.Router();
const pool = require('../db');
const bcrypt = require('bcrypt');
const authenticateToken = require('../middleware/authMiddleware');
const { body, validationResult } = require('express-validator');

// Admin route: Get all users
router.get('/', authenticateToken, async (req, res) => {
    // Note: You should ideally add role-based checking here to ensure only admins/hosts can see all users.
    try {
        const result = await pool.query('SELECT id, username, email, phone_number, role FROM "user"');
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get a specific user (Secured: Users can only get their own data, or use 'me')
router.get('/:id', authenticateToken, async (req, res) => {
    let targetId = req.params.id;

    // Convenience feature: Allow the frontend to just call GET /users/me
    if (targetId === 'me') {
        targetId = req.user.userId;
    } else if (parseInt(targetId) !== req.user.userId) {
        // SECURITY FIX: Prevent reading other users' private data
        return res.status(403).json({ error: 'Unauthorized to view this profile' });
    }

    try {
        const result = await pool.query(
            'SELECT id, username, email, phone_number, role FROM "user" WHERE id = $1',
            [targetId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

// Update a user (Secured: Users can only update their own profile)
router.put('/:id', authenticateToken,
    body('username').optional().trim().toLowerCase().notEmpty().withMessage('Username cannot be empty'),
    body('email').optional({ checkFalsy: true }).isEmail().normalizeEmail().withMessage('Invalid email format'),
    body('phone_number').optional().notEmpty().withMessage('Phone number cannot be empty'),
    body('password').optional().isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }

        let targetId = req.params.id;

        // Convenience feature for frontend
        if (targetId === 'me') {
            targetId = req.user.userId;
        } else if (parseInt(targetId) !== req.user.userId) {
            // SECURITY FIX: Prevent updating other users' profiles
            return res.status(403).json({ error: 'Unauthorized to update this profile' });
        }

        const { username, email, phone_number, password, push_token } = req.body;

        try {
            const fields = [];
            const values = [];
            let index = 1;

            if (username !== undefined) { fields.push(`username = $${index++}`); values.push(username); }
            if (email !== undefined) { fields.push(`email = $${index++}`); values.push(email); }
            if (phone_number !== undefined) { fields.push(`phone_number = $${index++}`); values.push(phone_number); }
            if (push_token !== undefined) { fields.push(`push_token = $${index++}`); values.push(push_token); }
            if (password !== undefined) {
                const hashedPassword = await bcrypt.hash(password, 10);
                fields.push(`password = $${index++}`);
                values.push(hashedPassword);
            }

            if (fields.length === 0) {
                return res.status(400).json({ error: 'No fields to update' });
            }

            values.push(targetId);
            const result = await pool.query(
                `UPDATE "user" SET ${fields.join(', ')} WHERE id = $${index} RETURNING id, username, email, phone_number, role`,
                values
            );

            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'User not found' });
            }
            res.json(result.rows[0]);
        } catch (err) {
            console.error(err);
            if (err.code === '23505') {
                return res.status(409).json({ error: 'Username, email, or phone number is already taken.' });
            }
            res.status(500).json({ error: 'Server error' });
        }
    }
);

// Delete a user (Secured: Users can only delete their own profile)
// Delete a user (Secured: Users can only delete their own profile)
router.delete('/:id', authenticateToken, async (req, res) => {
    let targetId = req.params.id;

    if (targetId === 'me') {
        targetId = req.user.userId;
    } else if (parseInt(targetId) !== req.user.userId) {
        // SECURITY FIX: Prevent deleting other users
        return res.status(403).json({ error: 'Unauthorized to delete this profile' });
    }

    try {
        // 1. Delete all bookings made by this player
        // (Change 'user_id' if your column is named differently, e.g., 'player_id')
        await pool.query('DELETE FROM bookings WHERE user_id = $1', [targetId]);

        // 2. Delete all facilities created by this user (if they are a host)
        // (Change 'host_id' if your column is named differently, e.g., 'owner_id')
        await pool.query('DELETE FROM facilities WHERE host_id = $1', [targetId]);

        // 3. Finally, delete the user account
        const result = await pool.query(
            'DELETE FROM "user" WHERE id = $1 RETURNING id, username, email, phone_number, role',
            [targetId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        res.json({ message: 'User deleted', user: result.rows[0] });
    } catch (err) {
        console.error("Account deletion error:", err);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;