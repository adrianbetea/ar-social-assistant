# AR Social Assistant - Frontend Architecture & UI Components

This document outlines the frontend structure of the AR Social Assistant application, built with React Native and Expo. It breaks down the navigation flow, core pages, and the AR/UI components required for the "Iron Man" style heads-up display.

## 🧭 Navigation Structure (React Navigation)
*   **Auth Stack:** `AuthPage` (Login/Register).
*   **Main App Stack:** `HomePage` -> `AssistantHUD` OR `ProfileSettings`.

---

## 1. Auth Page (Login / Register)
**Purpose:** Entry point for the app. Secures the user's custom AI instructions and profile.

**Key Components:**
*   `AppLogo`: A sleek, futuristic logo or animation for the AR Social Assistant app.
*   `AuthForm`:
    *   `EmailInput`: Text field with a dark, glowing neon border.
    *   `PasswordInput`: Secure text field.
    *   `InitializeButton`: Triggers the login/register action (styled like a system boot-up button).
    *   `ModeToggle`: Text link to switch between "System Login" and "Create Operative Account".

---

## 2. Home Page (System Dashboard)
**Purpose:** The central control hub where the user lands after authenticating.

**Key Components:**
*   `SystemStatusHeader`: Displays "Welcome back, [Username]. Systems online."
*   `DashboardLayout`:
    *   `StartAssistantButton`: A massive, central button (maybe styled like an Arc Reactor or a glowing camera lens). Tapping this requests camera/microphone permissions and opens the `AssistantHUD` page.
    *   `ProfileSettingsButton`: A secondary button navigating to the configuration area.
*   `RecentLogsPreview` (Optional): A small widget showing the last person/emotion analyzed, just to make the dashboard feel alive.

---

## 3. Profile Settings (AI Core Configuration)
**Purpose:** This is where the user "programs" their assistant's personality and behavior by modifying the AI system prompt.

**Key Components:**
*   `SettingsHeader`: Title reading "AI Core Instructions".
*   `SystemPromptInput`: A large, multiline `<TextInput>` field. 
    *   *Placeholder example:* "You are my social assistant. Be funny, wingman me in conversations, and give me short, punchy responses."
    *   *Logic:* This text is saved to the database and gets injected as the `system_instruction` every time the app calls the Gemini 2.5 Flash API.
*   `TranslationPreferences`:
    *   `TargetLanguagePicker`: Dropdown to select which language incoming speech should be translated to (default: English).
*   `SaveConfigButton`: Saves the settings to the backend/local storage.

---

## 4. Assistant HUD (The AR Interface)
**Purpose:** The core feature of the app. A full-screen camera view with futuristic overlays that dynamically update based on Gemini AI responses.

**Key Components:**
*   `BackgroundCamera`: The `<CameraView>` from `expo-camera` set to `flex: 1` (taking up the entire screen).
*   `HUDOverlay` (Wrapper): An absolute-positioned `View` sitting on top of the camera. Contains a transparent background with cyan/red neon borders and gridlines.
*   `TargetingReticle`: A static or gently pulsing crosshair in the center of the screen to indicate where the user should point the camera.
*   **Dynamic Popups (Rendered conditionally when API returns data):**
    *   `SubjectAnalysisPanel`: A box hovering near the top left. Displays the target's visual status (e.g., *"Emotion: Happy"*, *"Vibe: Engaged"*).
    *   `LiveSubtitlePanel`: A wide, semi-transparent bar at the bottom of the screen displaying real-time speech translations.
    *   `WingmanSuggestionsList`: A panel on the right side of the screen displaying 3 bullet points of "What to say next" when the conversation stalls.
*   `StatusIndicators`:
    *   `MicActiveIcon`: Pulses when `expo-av` is recording audio.
    *   `AIProcessingSpinner`: A futuristic loading circle that spins while waiting for the Gemini API to respond.
*   `ExitHUDButton`: A discrete 'X' or 'Abort' button to return to the Home Page.

---

## Global / Shared Components
*   `NeonText`: A custom `<Text>` wrapper component that applies a glowing text shadow to simulate a glowing HUD interface.
*   `CyberButton`: A reusable button with an angled border, dark background, and glowing outline.
*   `PermissionsModal`: A fallback UI component that asks the user to enable Camera and Microphone access if they haven't already.