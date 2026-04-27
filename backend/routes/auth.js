const express = require('express');
const bcrypt = require('bcryptjs');
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

function createToken(user) {
	return jwt.sign(
		{ userId: user.id, email: user.email },
		JWT_SECRET,
		{ expiresIn: '7d' }
	);
}

router.post('/register', async (req, res) => {
	try {
		const { email, password, username } = req.body || {};

		if (!email || !password || !username) {
			return res.status(400).json({ message: 'Username, email, and password are required.' });
		}

		const [existingUsers] = await pool.execute(
			'SELECT id FROM users WHERE email = ?',
			[email]
		);

		if (existingUsers.length > 0) {
			return res.status(409).json({ message: 'An account with that email already exists.' });
		}

		const hashedPassword = await bcrypt.hash(password, 10);

		const [userResult] = await pool.execute(
			'INSERT INTO users (username, email, password) VALUES (?, ?, ?)',
			[username, email, hashedPassword]
		);

		const userId = userResult.insertId;

		await pool.execute(
			'INSERT INTO user_configs (user_id, system_prompt, target_language) VALUES (?, ?, ?)',
			[userId, 'You are a helpful AR social assistant.', 'English']
		);

		const user = { id: userId, email, username };

		return res.status(201).json({
			message: 'User registered successfully.',
			token: createToken(user),
			user,
		});
	} catch (error) {
		console.error('Register error:', error);
		return res.status(500).json({ message: 'Failed to register user.' });
	}
});

router.post('/login', async (req, res) => {
	try {
		const { email, password } = req.body || {};

		if (!email || !password) {
			return res.status(400).json({ message: 'Email and password are required.' });
		}

		const [users] = await pool.execute(
			'SELECT id, email, password FROM users WHERE email = ?',
			[email]
		);

		if (users.length === 0) {
			return res.status(401).json({ message: 'Invalid email or password.' });
		}

		const user = users[0];
		const isPasswordValid = await bcrypt.compare(password, user.password);

		if (!isPasswordValid) {
			return res.status(401).json({ message: 'Invalid email or password.' });
		}

		return res.json({
			message: 'Login successful.',
			token: createToken(user),
			user: {
				id: user.id,
				email: user.email,
			},
		});
	} catch (error) {
		console.error('Login error:', error);
		return res.status(500).json({ message: 'Failed to login user.' });
	}
});

module.exports = router;
