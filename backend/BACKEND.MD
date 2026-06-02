# AR Social Assistant - Backend Architecture & API Routes

This document outlines the backend structure of the AR Social Assistant application, built with Node.js and Express.js. The backend acts as a secure bridge, managing user authentication, storing custom AI configurations, and processing real-time image analysis and translation. It uses the GitHub Models API for multimodal AI and a self-hosted or public LibreTranslate instance for language tasks.

## 🏗 Server Architecture & Tech Stack
*   **Vision & Logic AI:** **GitHub Models (`gpt-4o-mini`)** accessed via Azure. Used for image/scene analysis and contextual suggestions.
*   **Speech-to-Text:** **Whisper** (runs on a separate Python server, see `whisper-server/`).
*   **Translation:** **LibreTranslate** (self-hosted or public instance).
*   **Authentication:** `jsonwebtoken` (JWT) for secure API access.
*   **Database:** `MySQL` for storing user configs and interaction logs.

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

## 2. Profile & Configuration Routes (`/api/user-config`)
**Purpose:** Manages the user's "AI Core Configuration" that dictates how the Assistant HUD behaves and responds. Protected by JWT middleware.

**Endpoints:**
*   `GET /api/user-config`
    *   *Action:* Fetches the user's currently saved settings.
    *   *Returns:* `{ systemPrompt, targetLanguage }`
*   `PUT /api/user-config`
    *   *Payload:* `{ systemPrompt, targetLanguage }`
    *   *Action:* Updates the user's AI persona instructions and language preferences in the database.

---

## 3. AI Processing Routes (`/api/assistant`)
**Purpose:** The real-time bridge between the frontend AR HUD and the AI services for scene analysis, translation, and suggestions. Protected by JWT middleware.

**Endpoints:**
*   `POST /api/assistant/analyze-environment`
    *   *Purpose:* The main loop endpoint called repeatedly by the HUD for visual scene analysis.
    *   *Payload (JSON):* 
        *   `imageBase64`: Base64 string of the current camera frame.
        *   `imageMimeType`: MIME type (e.g., `image/jpeg`).
        *   `prompt` (Optional): Additional user context or question.
        *   `translationSnippet` (Optional): Text transcribed by the Whisper server, passed for contextual awareness and server-side translation.
        *   `contextHistory`: A short log of recent interactions to maintain conversational memory.
    *   *Action:* 
        1. Retrieves the user's `systemPrompt` from the database.
        2. If `translationSnippet` exists, translates it using LibreTranslate.
        3. Packages the system prompt, camera image, and translated text into the multimodal format required by the GitHub Models API.
        4. Calls the `gpt-4o-mini` model for image understanding and suggestion generation.
        5. Parses the model's response into a structured JSON format.
        6. Logs the interaction to the database.
    *   *Returns (Structured JSON for the HUD):*
        ```json
        {
          "analysis": "Subject appears happy and engaged.",
          "translation": "He said: 'I just got back from my trip.'",
          "wingmanSuggestions": [
            "Ask them about their recent trip.",
            "Compliment their jacket."
          ]
        }
        ```
*   `POST /api/assistant/analyze-environment/stream`
    *   *Purpose:* Streaming variant of the above endpoint for lower perceived latency.
    *   *Returns:* Server-Sent Events (SSE) with progressive response chunks.

*   `POST /api/assistant/translate`
    *   *Purpose:* Standalone server-side translation via LibreTranslate.
    *   *Payload:* `{ translationSnippet }`
    *   *Returns:* `{ translation }`

*   `GET /api/assistant/logs`
    *   *Purpose:* Fetch recent interaction logs for the dashboard.
    *   *Returns:* Array of past analyses and translations.

*   `GET /api/assistant/health`
    *   *Purpose:* Health check reporting GitHub Models & LibreTranslate configuration status.

---

## Core Services (Internal Backend Logic)
itHub Models Integration (`assistant.js`)
Responsible for constructing the prompt and handling the `gpt-4o-mini` model for vision and reasoning tasks.
*   **System Instructions Setup:** Uses the user's custom prompt (e.g., *"You are a funny wingman..."*) to guide the model's analysis and suggestion output.
*   **Image Payload Construction:** Converts the incoming camera frame into the required `image_url` structure (MIME type + base64 data).
*   **Context Injection:** Any speech transcribed by the Whisper server is passed as text context alongside the image, so the model can factor in what was said when generating suggestions.
*   **JSON Schema Enforcement:** Prompts the model to *always* return its response in a strictly formatted JSON object (`analysis`, `translation`, `wingmanSuggestions`).

### Whisper Server (`whisper-server/`)
*   A separate Python/Flask server that exposes an endpoint for speech-to-text transcription.
*   The frontend sends raw audio data to this server, which returns the transcribed text.
*   This text is then sent to the main Node.js backend for context and translation.

### LibreTranslate Integration
*   The Node.js backend communicates with a LibreTranslate instance to translate transcribed text into the user's target language.

### Auth Middleware
*   Intercepts incoming requests to `/api/user-config` and `/api/assistant`, verifies the JWT token in the Authorization header, and extracts the `userId` for database lookups.

---

## 🔒 Security & Performance Considerations
*   **API Key Protection:** The GitHub Models API key (`GITHUB_TOKEN`) is stored securely in the `.env` file of the Node.js server. The frontend *never* holds this key.
*   **Rate Limiting:** Implement `express-rate-limit` on the `/api/assistant/analyze-environment` endpoint to prevent the mobile app from spamming the server and exceeding API quotas
*   **Rate Limiting:** Implement `express-rate-limit` on the `/api/ai/analyze-environment` endpoint to prevent the mobile app from spamming the server and exceeding Google API quotas if a bug occurs on the frontend.