-- Create the database
CREATE DATABASE IF NOT EXISTS ar_social_assistant;
USE ar_social_assistant;

-- =========================================
-- 1. Users Table (Authentication)
-- =========================================
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
);

-- =========================================
-- 2. User Configurations Table (AI Profile)
-- =========================================
-- Stores the custom instructions and language settings for the Assistant HUD
CREATE TABLE IF NOT EXISTS user_configs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL UNIQUE,
    system_prompt TEXT, 
    target_language VARCHAR(50) DEFAULT 'English',
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- =========================================
-- 3. Interaction Logs Table (For Dashboard)
-- =========================================
-- Powers the 'RecentLogsPreview' on the Home Page Dashboard
CREATE TABLE IF NOT EXISTS interaction_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    emotion_analyzed VARCHAR(100), -- e.g., "Subject appears happy"
    translation_snippet TEXT,      -- Brief snippet of what was translated
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
