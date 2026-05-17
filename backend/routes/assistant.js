const express = require('express');
const jwt = require('jsonwebtoken');
const mysql = require('mysql2/promise');
const { GoogleGenAI } = require('@google/genai');

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
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

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

async function loadUserConfig(userId) {
	if (!userId) {
		return DEFAULT_CONFIG;
	}

	const [rows] = await pool.execute(
		'SELECT system_prompt, target_language FROM user_configs WHERE user_id = ?',
		[userId]
	);

	if (rows.length === 0) {
		return DEFAULT_CONFIG;
	}

	return {
		systemPrompt: rows[0].system_prompt || DEFAULT_CONFIG.systemPrompt,
		targetLanguage: rows[0].target_language || DEFAULT_CONFIG.targetLanguage,
	};
}

function buildPrompt({ systemPrompt, targetLanguage, userPrompt, contextHistory }) {
	const historyBlock = Array.isArray(contextHistory) && contextHistory.length > 0
		? `Recent context:\n${contextHistory.join('\n')}`
		: 'Recent context: (none)';

	return `${systemPrompt}\n\nYou are assisting in real-time. Use the target language: ${targetLanguage}.\n\n${historyBlock}\n\nUser request: ${userPrompt || 'Analyze the scene and offer guidance.'}\n\nRespond ONLY as strict JSON with keys: analysis, translation, wingmanSuggestions. Keep analysis under 120 characters. Provide up to 3 short wingmanSuggestions, each under 120 characters. If unsure, use empty strings.`;
}

function safeParseJson(text) {
	if (typeof text !== 'string') {
		return null;
	}

	const cleaned = text
		.replace(/```json\s*/i, '')
		.replace(/```\s*$/i, '')
		.trim();

	try {
		return JSON.parse(cleaned);
	} catch (error) {
		return null;
	}
}

function normalizeTranslation(value) {
	if (!value) {
		return '';
	}

	if (typeof value === 'string') {
		return value;
	}

	if (typeof value === 'object') {
		const question = value.question || value.text || '';
		const language = value.language ? ` (${value.language})` : '';
		return `${question}${language}`.trim();
	}

	return '';
}

function extractTextFromResult(result) {
	const response = result?.response;
	if (response?.text && typeof response.text === 'function') {
		return response.text();
	}

	const candidates = result?.candidates || response?.candidates;
	if (Array.isArray(candidates) && candidates.length > 0) {
		const parts = candidates[0]?.content?.parts || [];
		const text = parts
			.map((part) => (typeof part?.text === 'string' ? part.text : ''))
			.join('')
			.trim();
		return text;
	}

	return '';
}

async function logInteraction({ userId, analysis, translationSnippet }) {
	if (!userId) {
		return;
	}

	try {
		await pool.execute(
			'INSERT INTO interaction_logs (user_id, emotion_analyzed, translation_snippet) VALUES (?, ?, ?)',
			[
				userId,
				analysis ? String(analysis).slice(0, 100) : null,
				translationSnippet ? String(translationSnippet).slice(0, 500) : null,
			]
		);
	} catch (error) {
		console.warn('Interaction log insert failed:', error);
	}
}

router.post('/analyze-environment', async (req, res) => {
	try {
		console.log('AI request received:', {
			hasAuth: Boolean(req.headers.authorization),
			hasImage: Boolean(req.body?.imageBase64),
			imageMimeType: req.body?.imageMimeType || null,
		});
		if (!GEMINI_API_KEY) {
			return res.status(500).json({ message: 'GEMINI_API_KEY is not configured.' });
		}

		const userId = getUserIdFromAuthHeader(req.headers.authorization);

		if (!userId) {
			console.warn('AI request blocked: missing/invalid auth token.');
			return res.status(401).json({ message: 'Unauthorized.' });
		}

		const { imageBase64, imageMimeType, prompt, contextHistory, translationSnippet } = req.body || {};

		if (!imageBase64) {
			console.warn('AI request blocked: missing imageBase64.');
			return res.status(400).json({ message: 'imageBase64 is required.' });
		}

		const userConfig = await loadUserConfig(userId);
		const promptText = buildPrompt({
			systemPrompt: userConfig.systemPrompt,
			targetLanguage: userConfig.targetLanguage,
			userPrompt: prompt,
			contextHistory,
		});

		const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
		const result = await ai.models.generateContent({
			model: 'gemini-2.5-flash',
			contents: [
				{
					role: 'user',
					parts: [
						{ text: promptText },
						{
							inlineData: {
								mimeType: imageMimeType || 'image/jpeg',
								data: imageBase64,
							},
						},
					],
				},
			],
		});

		console.log('Gemini raw result keys:', Object.keys(result || {}));
		console.log('Gemini raw response keys:', Object.keys(result?.response || {}));
		const text = extractTextFromResult(result);
		console.log('Gemini response text:', text);
		if (!text) {
			console.log('Gemini response raw:', JSON.stringify(result || {}, null, 2));
		}
		const parsed = safeParseJson(text);
		if (parsed && typeof parsed === 'object') {
			parsed.translation = normalizeTranslation(parsed.translation);
			if (typeof parsed.analysis === 'string') {
				parsed.analysis = parsed.analysis.slice(0, 120);
			}
			if (Array.isArray(parsed.wingmanSuggestions)) {
				parsed.wingmanSuggestions = parsed.wingmanSuggestions
					.filter((item) => typeof item === 'string')
					.map((item) => item.trim().slice(0, 120))
					.filter(Boolean)
					.slice(0, 3);
			}
			console.log('Gemini response JSON:', parsed);
			await logInteraction({
				userId,
				analysis: parsed.analysis,
				translationSnippet: translationSnippet || parsed.translation,
			});
		}

		if (parsed && typeof parsed === 'object') {
			return res.json(parsed);
		}

		return res.json({
			analysis: '',
			translation: '',
			wingmanSuggestions: [],
			rawText: text,
		});
	} catch (error) {
		console.error('Gemini analyze error:', error);
		return res.status(500).json({ message: 'Failed to analyze environment.' });
	}
});

router.post('/analyze-environment/stream', async (req, res) => {
	try {
		if (!GEMINI_API_KEY) {
			return res.status(500).json({ message: 'GEMINI_API_KEY is not configured.' });
		}

		const userId = getUserIdFromAuthHeader(req.headers.authorization);

		if (!userId) {
			return res.status(401).json({ message: 'Unauthorized.' });
		}

		const { imageBase64, imageMimeType, prompt, contextHistory } = req.body || {};

		if (!imageBase64) {
			return res.status(400).json({ message: 'imageBase64 is required.' });
		}

		const userConfig = await loadUserConfig(userId);
		const promptText = buildPrompt({
			systemPrompt: userConfig.systemPrompt,
			targetLanguage: userConfig.targetLanguage,
			userPrompt: prompt,
			contextHistory,
		});

		res.setHeader('Content-Type', 'text/event-stream');
		res.setHeader('Cache-Control', 'no-cache');
		res.setHeader('Connection', 'keep-alive');

		const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
		const stream = await ai.models.generateContentStream({
			model: 'gemini-2.5-flash',
			contents: [
				{
					role: 'user',
					parts: [
						{ text: promptText },
						{
							inlineData: {
								mimeType: imageMimeType || 'image/jpeg',
								data: imageBase64,
							},
						},
					],
				},
			],
		});

		for await (const chunk of stream) {
			const delta = chunk.text();
			if (delta) {
				console.log('Gemini stream delta:', delta);
				res.write(`data: ${JSON.stringify({ delta })}\n\n`);
			}
		}

		res.write('event: done\n');
		res.write('data: {}\n\n');
		res.end();
	} catch (error) {
		console.error('Gemini stream error:', error);
		res.write('event: error\n');
		res.write(`data: ${JSON.stringify({ message: 'Failed to stream response.' })}\n\n`);
		res.end();
	}
});

module.exports = router;
