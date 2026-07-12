const express = require('express');
const router = express.Router();
const pool = require('../db');
const bcrypt = require('bcrypt');
const authenticateToken = require('../middleware/auth');
const { body, validationResult } = require('express-validator');

router.get('/', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, username, email, phone_number, role FROM "user"');
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

router.get('/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query(
            'SELECT id, username, email, phone_number, role FROM "user" WHERE id = $1',
            [id]
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

router.put('/:id', authenticateToken,
    body('username').optional().trim().notEmpty().withMessage('Username cannot be empty'),
    body('phone_number').optional().notEmpty().withMessage('Phone number cannot be empty'),
    body('password').optional().isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        const { id } = req.params;
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

            values.push(id);
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
                return res.status(409).json({ error: 'Username or phone number is already taken.' });
            }
            res.status(500).json({ error: 'Server error' });
        }
    }
);

router.delete('/:id', authenticateToken, async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query(
            'DELETE FROM "user" WHERE id = $1 RETURNING id, username, email, phone_number, role',
            [id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json({ message: 'User deleted', user: result.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;