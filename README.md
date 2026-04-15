# AR Social Assistant

**AR Social Assistant** is an augmented reality (AR) and artificial intelligence (AI) powered social interface. Designed conceptually for smart glasses—but implemented via a smartphone camera for accessibility—this application acts as a real-time social heads-up display (HUD). It leverages advanced multimodal AI to analyze the user's environment and social interactions, providing live insights, translations, and conversational support.

---

## Features & Functionalities

*   **AR Camera HUD:** A futuristic, "Iron Man"-style interface overlaid on a live camera feed, simulating the experience of wearing smart AR glasses.
*   **Real-time Emotion Recognition:** Captures visual data of the person in front of the user and uses AI to analyze micro-expressions, displaying social cues on the HUD (e.g., *"Subject appears happy/engaged"*).
*   **Live Translation Subtitles:** Listens to incoming speech in foreign languages and displays real-time translated subtitles directly on the user's screen.
*   **AI Conversation Follow-ups (Wingman Mode):** Analyzes the context of the ongoing conversation and suggests intelligent, context-aware responses or topic shifts when the conversation stalls.

---

## Technology Stack

### Frontend (Mobile App / AR Interface)
*   **Framework:** [React Native](https://reactnative.dev/)
*   **Build Tool:** [Expo](https://expo.dev/)
*   **AR/Camera:** `expo-camera` (Provides the live-feed background over which the HUD UI is rendered)
*   **Audio Processing:** `expo-av` (For capturing audio streams for translation and conversation context)

### Backend (Server & API Gateway)
*   **Environment:** [Node.js](https://nodejs.org/)
*   **Development Tool:**[Nodemon](https://nodemon.io/)
*   **Framework:** Express.js (Acts as a secure bridge between the mobile app and the AI APIs)

### Artificial Intelligence (Emerging Tech)
*   **LLM & Multimodal AI:** **Google Gemini 2.5 Flash API** 
    *   *Why Gemini 2.5 Flash?* It is optimized for low-latency, multimodal tasks. It can rapidly process both image frames (for emotion recognition) and text/audio streams (for conversation context) simultaneously, which is critical for real-time AR feedback.

---

## Architecture Workflow

1.  **Capture:** The React Native frontend (`expo-camera` & `expo-av`) captures a frame from the video feed and a snippet of the current audio.
2.  **Transmit:** This data is sent securely to the Node.js backend.
3.  **Process:** The backend formats the prompt and sends the multimodal data to the **Gemini 2.5 Flash API**.
4.  **Display:** Gemini returns the emotion analysis, translated text, and conversation suggestions. The backend sends this back to the frontend, which updates the AR HUD overlays in real-time.

---

## Installation & Setup

### Prerequisites
*[Node.js](https://nodejs.org/) installed on your machine.
*   [Expo CLI](https://docs.expo.dev/get-started/installation/) installed globally.
*   A free API key from[Google AI Studio](https://aistudio.google.com/) for Gemini 2.5 Flash.

### 1. Clone the Repository
```bash
git clone https://github.com/adrianbetea/ar-social-assistant.git
cd ar-social-assistant