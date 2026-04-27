# AR Social Assistant - Backend Architecture & API Routes

This document outlines the backend structure of the AR Social Assistant application, built with Node.js and Express.js. The backend acts as a secure bridge, managing user authentication, storing custom AI configurations, and processing real-time multimodal data feeds via the Google Gemini 2.5 Flash API.

## 🏗 Server Architecture & Tech Stack
*   **Core:** Node.js with Express.js.
*   **AI Integration:** `@google/genai` (Google Gemini SDK for calling the 2.5 Flash model).
*   **Authentication:** `jsonwebtoken` (JWT) for secure API access.
*   **Data Parsing:** `multer` (for handling audio/image file buffers) or built-in Express JSON parsers (if sending base64 payloads from the frontend).
*   **Database:** `MySQL`

---

## 1. Authentication Routes (`/api/auth`)
**Purpose:** Handles user registration, login, and secure session management so users can save their unique AI personas.

**Endpoints:**
*   `POST /api/auth/register`
    *   *Payload:* `{ email, password }`
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
    *   *Action:* Updates the user's AI persona instructions and translation preferences in the database.

---

## 3. AI Processing Routes (`/api/ai`)
**Purpose:** The critical real-time bridge between the frontend AR HUD and Google Gemini 2.5 Flash. Protected by JWT middleware.

**Endpoints:**
*   `POST /api/ai/analyze-environment`
    *   *Purpose:* The main loop endpoint called repeatedly by the HUD.
    *   *Payload (FormData or JSON):* 
        *   `imageFrame`: Base64 string or file buffer of the current camera view.
        *   `audioChunk` (Optional): Base64 string or file buffer of recent audio.
        *   `contextHistory`: A short log of the last few translations/suggestions to maintain conversational memory.
    *   *Action:* 
        1. Retrieves the user's `systemPrompt` from the database.
        2. Packages the system prompt, image frame, and audio chunk into the multimodal format required by Gemini 2.5 Flash.
        3. Calls the Gemini API.
        4. Parses Gemini's response into a structured JSON format.
    *   *Returns (Structured JSON for the HUD):*
        ```json
        {
          "analysis": "Subject appears happy and engaged.",
          "translation": "Hola, ¿cómo estás? -> Hello, how are you?",
          "wingmanSuggestions":[
            "Ask them about their recent trip.",
            "Compliment their jacket."
          ]
        }
        ```

---

## Core Services (Internal Backend Logic)

### `GeminiService.js`
This is the heart of the backend, responsible for constructing the prompt and handling the Gemini 2.5 Flash SDK.
*   **System Instructions Setup:** Uses the user's custom prompt (e.g., *"You are a funny wingman..."*) and sets it as the `systemInstruction` in the Gemini model configuration to strictly guide its output.
*   **Multimodal Payload Construction:** Converts the incoming camera frames and audio chunks into the `inlineData` structure (MIME type + base64 data) so Gemini can "see" and "hear" simultaneously.
*   **JSON Schema Enforcement:** Prompts Gemini to *always* return its response in a strictly formatted JSON object, ensuring the frontend app can easily parse it and update the HUD popups without breaking.

### `AuthMiddleware.js`
*   Intercepts incoming requests to `/api/user` and `/api/ai`, verifies the JWT token in the Authorization header, and attaches the `userId` to the request object.

---

## 🔒 Security & Performance Considerations
*   **Low Latency Optimization:** Because the app is an AR HUD, the backend must process requests quickly. Gemini 2.5 Flash is chosen for speed, but the Express app should ideally rely on Base64 strings over heavy multipart form uploads to save milliseconds.
*   **API Key Protection:** The Google AI Studio API key (`GEMINI_API_KEY`) is stored securely in the `.env` file of the Node.js server. The frontend *never* holds this key, preventing unauthorized abuse.
*   **Rate Limiting:** Implement `express-rate-limit` on the `/api/ai/analyze-environment` endpoint to prevent the mobile app from spamming the server and exceeding Google API quotas if a bug occurs on the frontend.