const express = require('express');
const jwt = require('jsonwebtoken');
const mysql = require('mysql2/promise');
const OpenAI = require('openai');

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
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_MODELS_ALLOW_INSECURE_TLS =
	(process.env.GITHUB_MODELS_ALLOW_INSECURE_TLS || 'false').toLowerCase() === 'true';
const LIBRE_TRANSLATE_URL = (process.env.LIBRE_TRANSLATE_URL || '').trim();
const LIBRE_TRANSLATE_ENABLED =
	(process.env.LIBRE_TRANSLATE_ENABLED || 'false').toLowerCase() === 'true' &&
	Boolean(LIBRE_TRANSLATE_URL);

function createGithubModelsClient() {
	// Keep TLS verification ON by default.
	// If explicitly enabled (debug/proxy environments), disable cert
	// verification process-wide as a fallback for GitHub Models connectivity.
	if (GITHUB_MODELS_ALLOW_INSECURE_TLS) {
		process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
	}

	return new OpenAI({
		baseURL: 'https://models.inference.ai.azure.com',
		apiKey: GITHUB_TOKEN,
	});
}

const DEFAULT_CONFIG = {
	systemPrompt: 'You are a helpful AR social assistant.',
	targetLanguage: 'English',
};

const LANGUAGE_CODE_MAP = {
	english: 'en',
	romanian: 'ro',
	french: 'fr',
	spanish: 'es',
	german: 'de',
	italian: 'it',
	portuguese: 'pt',
	dutch: 'nl',
	polish: 'pl',
	russian: 'ru',
	japanese: 'ja',
	korean: 'ko',
	chinese: 'zh',
};

function resolveTargetLanguageCode(targetLanguage) {
	if (!targetLanguage) {
		return 'en';
	}

	const normalized = String(targetLanguage).trim().toLowerCase();
	return LANGUAGE_CODE_MAP[normalized] || normalized.slice(0, 2) || 'en';
}


async function translateWithLibre({ text, targetLanguage }) {
	if (!text || !LIBRE_TRANSLATE_ENABLED) {
		return '';
	}

	const target = resolveTargetLanguageCode(targetLanguage);

	try {
		const response = await fetch(`${LIBRE_TRANSLATE_URL}/translate`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				q: text,
				source: 'auto',
				target,
				format: 'text',
			}),
		});

		if (!response.ok) {
			return '';
		}

		const data = await response.json().catch(() => ({}));
		return typeof data?.translatedText === 'string' ? data.translatedText : '';
	} catch (error) {
		console.warn('LibreTranslate error:', error);
		return '';
	}
}

async function detectLanguageWithLibre(text) {
	if (!text || !LIBRE_TRANSLATE_ENABLED) {
		return null;
	}

	try {
		const response = await fetch(`${LIBRE_TRANSLATE_URL}/detect`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				q: text,
			}),
		});

		if (!response.ok) {
			return null;
		}

		const data = await response.json().catch(() => []);
		const candidate = Array.isArray(data) ? data[0] : null;
		return typeof candidate?.language === 'string' ? candidate.language : null;
	} catch (error) {
		console.warn('LibreTranslate detect error:', error);
		return null;
	}
}

async function translateSnippetWithLibre({ text, targetLanguage }) {
	if (!text) {
		return '';
	}

	const target = resolveTargetLanguageCode(targetLanguage);
	const detected = await detectLanguageWithLibre(text);

	if (detected && detected === target) {
		return text;
	}

	return translateWithLibre({ text, targetLanguage });
}


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

function buildPrompt({ systemPrompt, targetLanguage, userPrompt, contextHistory, dialogueSegments }) {
    const hasHistory = Array.isArray(contextHistory) && contextHistory.length > 0;
    const hasDialogue = Array.isArray(dialogueSegments) && dialogueSegments.length > 0;

    const dialogueBlock = hasDialogue
        ? `LIVE DIALOGUE (speaker-labeled — USER is the operative wearing the AR HUD; OTHER is the person they're talking to):\n${dialogueSegments
              .map((s) => `${(s.speaker || 'UNKNOWN').toUpperCase()}: ${String(s.text || '').trim()}`)
              .filter((line) => line.length > 8)
              .join('\n')}`
        : '';

    const speakerInstruction = hasDialogue
        ? `IMPORTANT: Suggestions are advice for USER on what to say next. Never suggest USER repeat or rephrase what USER already said. Suggestions should respond to or build on what OTHER said.`
        : '';

    const historyBlock = hasHistory
        ? `CONVERSATION SO FAR (use this to give specific, progressive suggestions — do NOT give generic advice if context exists):\n${contextHistory.map((h, i) => `[${i + 1}] ${h}`).join('\n')}`
        : 'CONVERSATION SO FAR: (none yet — give general icebreaker suggestions)';

    const contextInstruction = hasHistory
        ? `IMPORTANT: The conversation has already started. Your suggestions MUST reference or build upon what was already said. Do NOT suggest things that already happened (like "ask about their project" if they already talked about their project). Progress the conversation forward.`
        : '';

    return `${systemPrompt}

You are a real-time social wingman assistant. Target language for wingmanSuggestions: ${targetLanguage}.

${dialogueBlock}

${speakerInstruction}

${historyBlock}

${contextInstruction}

Current scene: ${userPrompt || 'Analyze the scene and offer guidance.'}

Respond ONLY as strict JSON with keys: analysis, translation, wingmanSuggestions.
- analysis: max 120 chars, describe what's happening socially right now
- translation: empty string
- wingmanSuggestions: exactly 3 suggestions, each under 120 chars, in ${targetLanguage}, that are SPECIFIC to the conversation history above — not generic tips`;
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

router.post('/translate', async (req, res) => {
	try {
		const userId = getUserIdFromAuthHeader(req.headers.authorization);

		if (!userId) {
			return res.status(401).json({ message: 'Unauthorized.' });
		}

		const { translationSnippet } = req.body || {};
		if (!translationSnippet) {
			return res.json({ translation: '' });
		}

		const userConfig = await loadUserConfig(userId);
		const translatedText = await translateSnippetWithLibre({
			text: translationSnippet,
			targetLanguage: userConfig.targetLanguage,
		});

		return res.json({ translation: translatedText || '' });
	} catch (error) {
		console.error('Translate error:', error);
		return res.status(500).json({ message: 'Failed to translate.' });
	}
});

router.get('/health', async (req, res) => {
    try {
        return res.json({
            ok: true,
            githubModelsConfigured: Boolean(GITHUB_TOKEN),
			githubModelsInsecureTls: GITHUB_MODELS_ALLOW_INSECURE_TLS,
			libreTranslateEnabled: LIBRE_TRANSLATE_ENABLED,
			libreTranslateUrl: LIBRE_TRANSLATE_ENABLED ? LIBRE_TRANSLATE_URL : null,
        });
    } catch (error) {
        return res.status(500).json({ ok: false });
    }
});

router.get('/logs', async (req, res) => {
	try {
		const userId = getUserIdFromAuthHeader(req.headers.authorization);

		if (!userId) {
			return res.status(401).json({ message: 'Unauthorized.' });
		}

		const limitRaw = Number(req.query.limit);
		const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;

		const [rows] = await pool.execute(
			`SELECT id, emotion_analyzed, translation_snippet, created_at FROM interaction_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT ${limit}`,
			[userId]
		);

		return res.json({
			logs: rows.map((row) => ({
				id: row.id,
				analysis: row.emotion_analyzed,
				translationSnippet: row.translation_snippet,
				createdAt: row.created_at,
			})),
		});
	} catch (error) {
		console.error('Logs error:', error);
		return res.status(500).json({ message: 'Failed to load logs.' });
	}
});

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
		if (!GITHUB_TOKEN) {
			return res.status(500).json({ message: 'GITHUB_TOKEN is not configured.' });
		}

		const userId = getUserIdFromAuthHeader(req.headers.authorization);

		if (!userId) {
			console.warn('AI request blocked: missing/invalid auth token.');
			return res.status(401).json({ message: 'Unauthorized.' });
		}

		const { imageBase64, imageMimeType, prompt, contextHistory, translationSnippet, dialogueSegments } = req.body || {};

		if (!imageBase64) {
			console.warn('AI request blocked: missing imageBase64.');
			return res.status(400).json({ message: 'imageBase64 is required.' });
		}

		const sanitizedImageBase64 = String(imageBase64)
			.replace(/^data:[^;]+;base64,/, '')
			.trim();

		const userConfig = await loadUserConfig(userId);
		const translatedText = translationSnippet
			? await translateSnippetWithLibre({
				text: translationSnippet,
				targetLanguage: userConfig.targetLanguage,
			})
			: '';
		const nextContextHistory = Array.isArray(contextHistory) ? [...contextHistory] : [];
		if (translationSnippet) {
			nextContextHistory.unshift(`Heard: ${translationSnippet}`);
		}
		const promptText = buildPrompt({
			systemPrompt: userConfig.systemPrompt,
			targetLanguage: userConfig.targetLanguage,
			userPrompt: prompt,
			contextHistory: nextContextHistory,
			dialogueSegments,
		});

		let parsed = null;
		let text = '';
		try {
			const client = createGithubModelsClient();

			const result = await client.chat.completions.create({
				model: 'gpt-4o-mini',
				messages: [
					{
						role: 'user',
						content: [
							{ type: 'text', text: promptText },
							{
								type: 'image_url',
								image_url: {
									url: `data:${imageMimeType || 'image/jpeg'};base64,${sanitizedImageBase64}`,
									detail: 'low', // use 'low' to save on rate limits
								},
							},
						],
					},
				],
				max_tokens: 512,
				temperature: 0.7,
			});

			text = result.choices?.[0]?.message?.content || '';
			console.log('GitHub Models response text:', text);
			parsed = safeParseJson(text);
		} catch (error) {
			console.error('GitHub Models analyze error:', {
				message: error?.message,
				status: error?.status,
				code: error?.code,
				name: error?.name,
			});
			return res.json({
				analysis: '',
				translation: translatedText || '',
				wingmanSuggestions: [],
				error: 'github-models-unavailable',
			});
		}
		if (parsed && typeof parsed === 'object') {
			parsed.translation = translatedText || '';
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
				translationSnippet: translatedText || translationSnippet || parsed.translation,
			});
		}

		if (parsed && typeof parsed === 'object') {
			return res.json(parsed);
		}

		return res.json({
			analysis: '',
			translation: translatedText || '',
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
		if (!GITHUB_TOKEN) {
			return res.status(500).json({ message: 'GITHUB_TOKEN is not configured.' });
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

		const client = createGithubModelsClient();

		const stream = await client.chat.completions.create({
			model: 'gpt-4o-mini',
			stream: true,
			messages: [
				{
					role: 'user',
					content: [
						{ type: 'text', text: promptText },
						{
							type: 'image_url',
							image_url: {
								url: `data:${imageMimeType || 'image/jpeg'};base64,${sanitizedImageBase64}`,
								detail: 'low',
							},
						},
					],
				},
			],
			max_tokens: 512,
		});

		for await (const chunk of stream) {
			const delta = chunk.choices?.[0]?.delta?.content || '';
			if (delta) {
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
