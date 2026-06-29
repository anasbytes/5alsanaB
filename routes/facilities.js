const express = require('express');
const router = express.Router();
const pool = require('../db');
const { body, validationResult } = require('express-validator');

router.get('/', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM facility');
        res.json(result.rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

router.post('/',
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('type').trim().notEmpty().withMessage('Type is required'),
    body('location').trim().notEmpty().withMessage('Location is required'),
    body('price_per_hour').isFloat({ min: 0 }).withMessage('Valid price is required'),
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        const { name, type, location, price_per_hour } = req.body;
        try {
            const result = await pool.query(
                'INSERT INTO facility (name, type, location, price_per_hour) VALUES ($1, $2, $3, $4) RETURNING *',
                [name, type, location, price_per_hour]
            );
            res.status(201).json(result.rows[0]);
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: 'Server error' });
        }
    }
);

router.get('/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query('SELECT * FROM facility WHERE id = $1', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Facility not found' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

router.put('/:id',
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('type').trim().notEmpty().withMessage('Type is required'),
    body('location').trim().notEmpty().withMessage('Location is required'),
    body('price_per_hour').isFloat({ min: 0 }).withMessage('Valid price is required'),
    async (req, res) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        const { id } = req.params;
        const { name, type, location, price_per_hour } = req.body;
        try {
            const result = await pool.query(
                'UPDATE facility SET name = $1, type = $2, location = $3, price_per_hour = $4 WHERE id = $5 RETURNING *',
                [name, type, location, price_per_hour, id]
            );
            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'Facility not found' });
            }
            res.json(result.rows[0]);
        } catch (err) {
            console.error(err);
            res.status(500).json({ error: 'Server error' });
        }
    }
);

router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query(
            'DELETE FROM facility WHERE id = $1 RETURNING *',
            [id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Facility not found' });
        }
        res.json({ message: 'Facility deleted', facility: result.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;