const express = require('express');
const jwt = require('jsonwebtoken');
const mysql = require('mysql2/promise');
const { GoogleGenAI } = require('@google/genai');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const WHISPER_URL = process.env.WHISPER_URL || 'http://localhost:5001';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const pool = mysql.createPool({
	host: process.env.DB_HOST || 'localhost',
	port: Number(process.env.DB_PORT || 3306),
	user: process.env.DB_USER || 'root',
	password: process.env.DB_PASSWORD || 'root',
	database: process.env.DB_NAME || 'ar_social_assistant',
	waitForConnections: true,
	connectionLimit: 5,
});

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

function resolveLanguageCode(lang) {
	if (!lang) return 'en';
	const normalized = String(lang).trim().toLowerCase();
	return LANGUAGE_CODE_MAP[normalized] || normalized.slice(0, 2) || 'en';
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

async function getUserTargetLanguage(userId) {
	try {
		const [rows] = await pool.execute(
			'SELECT target_language FROM user_configs WHERE user_id = ?',
			[userId]
		);
		if (rows.length > 0 && rows[0].target_language) {
			return rows[0].target_language;
		}
	} catch (error) {
		console.warn('Failed to fetch user config:', error);
	}
	return 'English';
}

async function translateWithMyMemory(text, sourceLanguage, targetLanguage) {
	const sourceCode = resolveLanguageCode(sourceLanguage);
	const targetCode = resolveLanguageCode(targetLanguage);
	console.log('[MyMemory] langpair:', sourceCode, '|', targetCode, 'text:', JSON.stringify(text));
	const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${sourceCode}|${targetCode}`;
	const response = await fetch(url);
	if (!response.ok) throw new Error(`MyMemory HTTP ${response.status}`);
	const data = await response.json();
	console.log('[MyMemory] responseStatus:', data.responseStatus, 'translated:', JSON.stringify(data.responseData?.translatedText));
	if (data.responseStatus === 200 && data.responseData?.translatedText) {
		const translated = data.responseData.translatedText;
		// MyMemory sometimes returns all-caps for short text - normalize
		if (translated === translated.toUpperCase() && text !== text.toUpperCase()) {
			return translated.charAt(0).toUpperCase() + translated.slice(1).toLowerCase();
		}
		return translated;
	}
	throw new Error(data.responseDetails || 'MyMemory translation failed');
}

async function translate(text, targetLanguage, sourceLanguage) {
	// Primary: MyMemory — fast dedicated translation API (~100ms)
	try {
		const translated = await translateWithMyMemory(text, sourceLanguage || 'English', targetLanguage);
		console.log('MyMemory translate:', text, '->', translated);
		return translated;
	} catch (error) {
		console.warn('MyMemory failed:', error.message);
	}

	// Fallback: Gemini (slow but handles edge cases)
	try {
		const result = await ai.models.generateContent({
			model: 'gemini-2.5-flash',
			contents: `Translate to ${targetLanguage}. Return ONLY the translation, nothing else:\n${text}`,
		});
		let translated = '';
		if (result?.text && typeof result.text === 'function') {
			translated = result.text();
		} else if (typeof result?.text === 'string') {
			translated = result.text;
		} else if (result?.response?.text && typeof result.response.text === 'function') {
			translated = result.response.text();
		} else if (result?.candidates?.[0]?.content?.parts?.[0]?.text) {
			translated = result.candidates[0].content.parts[0].text;
		}
		if (translated?.trim()) {
			console.log('Gemini fallback translate:', text, '->', translated.trim());
			return translated.trim();
		}
	} catch (error) {
		console.warn('Gemini fallback failed:', error.message?.substring(0, 80));
	}

	return text;
}

router.get('/health', async (req, res) => {
	try {
		const response = await fetch(`${WHISPER_URL}/health`);
		const data = await response.json();
		return res.json(data);
	} catch (error) {
		return res.status(503).json({ ok: false, error: 'Whisper server unreachable.' });
	}
});

async function getUserVoiceEmbedding(userId) {
	try {
		const [rows] = await pool.execute(
			'SELECT voice_embedding FROM users WHERE id = ?',
			[userId]
		);
		const raw = rows?.[0]?.voice_embedding;
		if (!raw) return null;
		const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
		return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
	} catch (error) {
		console.warn('Failed to load voice embedding:', error.message);
		return null;
	}
}

router.get('/enrollment', async (req, res) => {
	const userId = getUserIdFromAuthHeader(req.headers.authorization);
	if (!userId) return res.status(401).json({ message: 'Unauthorized.' });
	try {
		const [rows] = await pool.execute(
			'SELECT voice_embedding IS NOT NULL AS enrolled, voice_enrolled_at FROM users WHERE id = ?',
			[userId]
		);
		const row = rows?.[0] || {};
		return res.json({
			enrolled: Boolean(row.enrolled),
			enrolledAt: row.voice_enrolled_at || null,
		});
	} catch (error) {
		return res.status(500).json({ message: 'Failed to read enrollment status.' });
	}
});

router.post('/enroll', async (req, res) => {
	const userId = getUserIdFromAuthHeader(req.headers.authorization);
	if (!userId) return res.status(401).json({ message: 'Unauthorized.' });

	const { audioBase64 } = req.body || {};
	if (!audioBase64) {
		return res.status(400).json({ message: 'audioBase64 is required.' });
	}

	try {
		const response = await fetch(`${WHISPER_URL}/enroll`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ audioBase64 }),
		});
		const data = await response.json().catch(() => ({}));
		if (!response.ok) {
			return res.status(response.status).json({
				message: data.error || 'Voice enrollment failed.',
			});
		}
		const embedding = data.embedding;
		if (!Array.isArray(embedding) || embedding.length === 0) {
			return res.status(500).json({ message: 'Empty embedding returned.' });
		}
		await pool.execute(
			'UPDATE users SET voice_embedding = ?, voice_enrolled_at = NOW() WHERE id = ?',
			[JSON.stringify(embedding), userId]
		);
		return res.json({ enrolled: true, dim: embedding.length });
	} catch (error) {
		console.error('Enroll proxy error:', error);
		return res.status(500).json({ message: 'Voice enrollment failed.' });
	}
});

router.delete('/enrollment', async (req, res) => {
	const userId = getUserIdFromAuthHeader(req.headers.authorization);
	if (!userId) return res.status(401).json({ message: 'Unauthorized.' });
	try {
		await pool.execute(
			'UPDATE users SET voice_embedding = NULL, voice_enrolled_at = NULL WHERE id = ?',
			[userId]
		);
		return res.json({ enrolled: false });
	} catch (error) {
		return res.status(500).json({ message: 'Failed to clear enrollment.' });
	}
});

router.post('/transcribe', async (req, res) => {
	try {
		const userId = getUserIdFromAuthHeader(req.headers.authorization);

		if (!userId) {
			return res.status(401).json({ message: 'Unauthorized.' });
		}

		const { audioBase64, sourceLanguage, skipTranslation } = req.body || {};

		if (!audioBase64) {
			return res.status(400).json({ message: 'audioBase64 is required.' });
		}

		// Get user's target language
		const targetLanguage = await getUserTargetLanguage(userId);
		const targetCode = resolveLanguageCode(targetLanguage);

		// Pin the source language for Whisper to avoid per-chunk auto-detection
		// (which is the #1 cause of garbled multilingual hallucinations).
		const sourceCode = sourceLanguage ? resolveLanguageCode(sourceLanguage) : undefined;

		// If the user enrolled their voice, route through the diarize endpoint
		// so we get a USER/OTHER speaker label per chunk.
		const userEmbedding = await getUserVoiceEmbedding(userId);
		const whisperEndpoint = userEmbedding ? '/diarize-transcribe' : '/transcribe';
		const whisperBody = {
			audioBase64,
			task: 'transcribe',
			...(sourceCode ? { language: sourceCode } : {}),
			...(userEmbedding ? { userEmbedding } : {}),
		};

		const whisperResponse = await fetch(`${WHISPER_URL}${whisperEndpoint}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(whisperBody),
		});

		if (!whisperResponse.ok) {
			const error = await whisperResponse.json().catch(() => ({}));
			return res.status(whisperResponse.status).json({
				message: error.error || 'Whisper transcription failed.',
			});
		}

		const whisperData = await whisperResponse.json();
		const originalText = (whisperData.text || '').trim();
		const detectedLang = whisperData.language || '';
		const speaker = whisperData.speaker || (userEmbedding ? 'UNKNOWN' : null);
		const rawSegments = Array.isArray(whisperData.segments) ? whisperData.segments : [];

		if (!originalText) {
			return res.json({
				text: '', originalText: '', language: detectedLang,
				speaker, segments: [],
			});
		}

		const buildLabeledSegments = (translated) => rawSegments.map((s) => ({
			start: s.start, end: s.end,
			text: s.text,
			speaker: s.speaker || speaker || 'UNKNOWN',
		}));

		// Frontend asked us to skip server-side translation (it will translate
		// locally e.g. via Chrome's on-device Translator API for speed).
		if (skipTranslation) {
			return res.json({
				text: originalText,
				originalText,
				language: detectedLang,
				speaker,
				segments: buildLabeledSegments(),
			});
		}

		// If detected language matches target, no translation needed
		if (detectedLang === targetCode) {
			return res.json({
				text: originalText,
				originalText,
				language: detectedLang,
				speaker,
				segments: buildLabeledSegments(),
			});
		}

		// If target is English, use Whisper's built-in translate task (more accurate)
		if (targetCode === 'en') {
			const translateResponse = await fetch(`${WHISPER_URL}/transcribe`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					audioBase64,
					task: 'translate',
					...(sourceCode ? { language: sourceCode } : {}),
				}),
			});

			if (translateResponse.ok) {
				const translateData = await translateResponse.json();
				const translatedText = (translateData.text || '').trim();
				return res.json({
					text: translatedText || originalText,
					originalText,
					language: detectedLang,
					speaker,
					segments: buildLabeledSegments(),
				});
			}
		}

		// Translate to target language
		const translatedText = await translate(originalText, targetLanguage);

		return res.json({
			text: translatedText,
			originalText,
			language: detectedLang,
			speaker,
			segments: buildLabeledSegments(),
		});
	} catch (error) {
		console.error('Whisper proxy error:', error);
		return res.status(500).json({ message: 'Failed to transcribe audio.' });
	}
});

// Text-only translation (for Web Speech API frontend)
router.post('/translate-text', async (req, res) => {
	try {
		const userId = getUserIdFromAuthHeader(req.headers.authorization);
		if (!userId) {
			return res.status(401).json({ message: 'Unauthorized.' });
		}

		const { text } = req.body || {};
		if (!text || !text.trim()) {
			return res.json({ text: '', originalText: '', language: '' });
		}

		const originalText = text.trim();
		const targetLanguage = await getUserTargetLanguage(userId);

		// Get source language for MyMemory fallback
		let sourceLanguage = 'English';
		try {
			const [rows] = await pool.execute(
				'SELECT source_language FROM user_configs WHERE user_id = ?',
				[userId]
			);
			if (rows.length > 0 && rows[0].source_language) {
				sourceLanguage = rows[0].source_language;
			}
		} catch (_) {}

		console.log('[translate-text] userId:', userId);
		console.log('[translate-text] originalText:', JSON.stringify(originalText));
		console.log('[translate-text] sourceLanguage:', sourceLanguage, '-> targetLanguage:', targetLanguage);

		// Skip translation if source and target are the same
		if (sourceLanguage.toLowerCase() === targetLanguage.toLowerCase()) {
			console.log('[translate-text] SKIP: source === target, no translation needed');
			return res.json({ text: originalText, originalText, language: '' });
		}

		// Translate: MyMemory (fast) → Gemini (fallback)
		const translatedText = await translate(originalText, targetLanguage, sourceLanguage);

		console.log('[translate-text] RESULT:', JSON.stringify(translatedText));

		return res.json({
			text: translatedText,
			originalText,
			language: '',
		});
	} catch (error) {
		console.error('Translate text error:', error);
		return res.status(500).json({ message: 'Translation failed.' });
	}
});

module.exports = router;
