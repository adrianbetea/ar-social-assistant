# AR Social Assistant - Backend Architecture & API Routes

This document outlines the backend structure of the AR Social Assistant application, built with Node.js and Express.js. The backend acts as a secure bridge, managing user authentication, storing custom AI configurations, and processing real-time image analysis via the Google Gemini 2.5 Flash API. Speech-to-text and translation are handled on-device by OpenAI's Whisper model.

## 🏗 Server Architecture & Tech Stack
*   **Core:** Node.js with Express.js.
*   **Vision AI:** `@google/genai` (Google Gemini SDK for calling the 2.5 Flash model) — used exclusively for image/scene analysis and contextual suggestions.
*   **Speech-to-Text & Translation:** OpenAI Whisper (runs on the frontend/device side, not on the backend).
*   **Authentication:** `jsonwebtoken` (JWT) for secure API access.
*   **Data Parsing:** Built-in Express JSON parsers (base64 payloads from the frontend).
*   **Database:** `MySQL`

---

## 1. Authentication Routes (`/api/auth`)
**Purpose:** Handles user registration, login, and secure session management so users can save their unique AI personas.

**Endpoints:**
*   `POST /api/auth/register`
    *   *Payload:* `{ email, password, username }`
    *   *Action:* Hashes the password, creates a new user in the database, and returns a JWT token. Also initializes a default "AI Core Instruction" profile.
*   `POST /api/auth/login`
    *   *Payload:* `{ email, password }`
    *   *Action:* Verifies credentials and returns a JWT token for subsequent requests.

---

## 2. Profile & Configuration Routes (`/api/user`)
**Purpose:** Manages the user's "AI Core Configuration" that dictates how the Assistant HUD behaves and responds. Protected by JWT middleware.

**Endpoints:**
*   `GET /api/user/config`
    *   *Action:* Fetches the user's currently saved settings.
    *   *Returns:* `{ systemPrompt, targetLanguage }`
*   `PUT /api/user/config`
    *   *Payload:* `{ systemPrompt, targetLanguage }`
    *   *Action:* Updates the user's AI persona instructions and language preferences in the database.

---

## 3. AI Processing Routes (`/api/ai`)
**Purpose:** The real-time bridge between the frontend AR HUD and Google Gemini 2.5 Flash for **image/scene analysis only**. Speech recognition and translation are performed locally on the device using Whisper. Protected by JWT middleware.

**Endpoints:**
*   `POST /api/ai/analyze-environment`
    *   *Purpose:* The main loop endpoint called repeatedly by the HUD for visual scene analysis.
    *   *Payload (JSON):* 
        *   `imageBase64`: Base64 string of the current camera frame.
        *   `imageMimeType`: MIME type (e.g., `image/jpeg`).
        *   `prompt` (Optional): Additional user context or question.
        *   `translationSnippet` (Optional): Text transcribed by Whisper on-device, passed for contextual awareness.
        *   `contextHistory`: A short log of recent interactions to maintain conversational memory.
    *   *Action:* 
        1. Retrieves the user's `systemPrompt` from the database.
        2. Packages the system prompt and camera image into the multimodal format required by Gemini 2.5 Flash.
        3. Includes any Whisper-transcribed speech as additional context for Gemini.
        4. Calls the Gemini API for image understanding.
        5. Parses Gemini's response into a structured JSON format.
    *   *Returns (Structured JSON for the HUD):*
        ```json
        {
          "analysis": "Subject appears happy and engaged.",
          "translation": "",
          "wingmanSuggestions": [
            "Ask them about their recent trip.",
            "Compliment their jacket."
          ]
        }
        ```
*   `POST /api/ai/analyze-environment/stream`
    *   *Purpose:* Streaming variant of the above endpoint for lower perceived latency.
    *   *Returns:* Server-Sent Events (SSE) with progressive Gemini response chunks.

*   `POST /api/ai/translate`
    *   *Purpose:* Fallback server-side translation via LibreTranslate (if Whisper translation is unavailable).
    *   *Payload:* `{ translationSnippet }`
    *   *Returns:* `{ translation }`

*   `GET /api/ai/logs`
    *   *Purpose:* Fetch recent interaction logs for the dashboard.
    *   *Returns:* Array of past analyses and translations.

*   `GET /api/ai/health`
    *   *Purpose:* Health check reporting Gemini configuration status.

---

## Core Services (Internal Backend Logic)

### Gemini Integration (`assistant.js`)
Responsible for constructing the prompt and handling the Gemini 2.5 Flash SDK for **vision tasks only**.
*   **System Instructions Setup:** Uses the user's custom prompt (e.g., *"You are a funny wingman..."*) to guide Gemini's image analysis and suggestion output.
*   **Image Payload Construction:** Converts the incoming camera frame into the `inlineData` structure (MIME type + base64 data) so Gemini can "see" the scene.
*   **Whisper Context Injection:** Any speech transcribed by Whisper on-device is passed as text context alongside the image, so Gemini can factor in what was said when generating suggestions.
*   **JSON Schema Enforcement:** Prompts Gemini to *always* return its response in a strictly formatted JSON object (`analysis`, `translation`, `wingmanSuggestions`).

### Whisper (Frontend/Device-Side)
*   OpenAI's Whisper model handles all **speech-to-text** and **speech translation** directly on the device.
*   Transcribed text is sent to the backend only as context for Gemini's image analysis.
*   Supports multilingual transcription and translation to the user's configured target language.

### Auth Middleware
*   Intercepts incoming requests to `/api/user` and `/api/ai`, verifies the JWT token in the Authorization header, and extracts the `userId` for database lookups.

---

## 🔒 Security & Performance Considerations
*   **Low Latency Optimization:** Whisper runs on-device for instant speech-to-text without network round-trips. Gemini 2.5 Flash is used for vision tasks due to its speed. Base64 payloads are preferred over multipart form uploads.
*   **API Key Protection:** The Google AI Studio API key (`GEMINI_API_KEY`) is stored securely in the `.env` file of the Node.js server. The frontend *never* holds this key, preventing unauthorized abuse.
*   **Rate Limiting:** Implement `express-rate-limit` on the `/api/ai/analyze-environment` endpoint to prevent the mobile app from spamming the server and exceeding Google API quotas if a bug occurs on the frontend.