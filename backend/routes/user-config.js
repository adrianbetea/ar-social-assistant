const express = require('express');
const jwt = require('jsonwebtoken');
const mysql = require('mysql2/promise');

const router = express.Router();

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'root',
    database: process.env.DB_NAME || 'ar_social_assistant',
    waitForConnections: true,
    connectionLimit: 10,
});

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

const DEFAULT_CONFIG = {
    systemPrompt: 'You are a helpful AR social assistant.',
    targetLanguage: 'English',
};

function getUserIdFromAuthHeader(headerValue) {
    if (!headerValue) {
        return null;
    }

    const [scheme, token] = headerValue.split(' ');
    if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) {
        return null;
    }

    try {
        const payload = jwt.verify(token, JWT_SECRET);
        return payload.userId;
    } catch (error) {
        return null;
    }
}

function sanitizePrompt(value) {
    if (typeof value !== 'string') {
        return DEFAULT_CONFIG.systemPrompt;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : DEFAULT_CONFIG.systemPrompt;
}

function sanitizeLanguage(value) {
    if (typeof value !== 'string') {
        return DEFAULT_CONFIG.targetLanguage;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : DEFAULT_CONFIG.targetLanguage;
}

router.get('/config', async (req, res) => {
    try {
        const userId = getUserIdFromAuthHeader(req.headers.authorization);

        if (!userId) {
            return res.json(DEFAULT_CONFIG);
        }

        const [rows] = await pool.execute(
            'SELECT system_prompt, target_language FROM user_configs WHERE user_id = ?',
            [userId]
        );

        if (rows.length === 0) {
            return res.json(DEFAULT_CONFIG);
        }

        return res.json({
            systemPrompt: rows[0].system_prompt || DEFAULT_CONFIG.systemPrompt,
            targetLanguage: rows[0].target_language || DEFAULT_CONFIG.targetLanguage,
        });
    } catch (error) {
        console.error('Get config error:', error);
        return res.status(500).json({ message: 'Failed to load user configuration.' });
    }
});

router.put('/config', async (req, res) => {
    try {
        const userId = getUserIdFromAuthHeader(req.headers.authorization);

        if (!userId) {
            return res.status(401).json({ message: 'Unauthorized.' });
        }

        const nextPrompt = sanitizePrompt(req.body?.systemPrompt);
        const nextLanguage = sanitizeLanguage(req.body?.targetLanguage);

        const [rows] = await pool.execute(
            'SELECT id FROM user_configs WHERE user_id = ?',
            [userId]
        );

        if (rows.length === 0) {
            await pool.execute(
                'INSERT INTO user_configs (user_id, system_prompt, target_language) VALUES (?, ?, ?)',
                [userId, nextPrompt, nextLanguage]
            );
        } else {
            await pool.execute(
                'UPDATE user_configs SET system_prompt = ?, target_language = ? WHERE user_id = ?',
                [nextPrompt, nextLanguage, userId]
            );
        }

        return res.json({
            message: 'Configuration updated.',
            systemPrompt: nextPrompt,
            targetLanguage: nextLanguage,
        });
    } catch (error) {
        console.error('Update config error:', error);
        return res.status(500).json({ message: 'Failed to update user configuration.' });
    }
});

module.exports = router;
