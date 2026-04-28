import { useMemo, useState } from 'react';
import {
    Alert,
    Pressable,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    TextInput,
    View,
} from 'react-native';
import { useRouter } from 'expo-router';

import { CyberButton } from '@/components/cyber-button';
import { NeonText } from '@/components/neon-text';

const languages = ['English', 'Spanish', 'German', 'French', 'Romanian'];

export default function ProfileSettingsScreen() {
    const router = useRouter();
    const [systemPrompt, setSystemPrompt] = useState('');
    const [targetLanguage, setTargetLanguage] = useState(languages[0]);

    const helperText = useMemo(
        () => 'Define your assistant tone, behavior, and constraints for live support.',
        []
    );

    const handleSave = () => {
        Alert.alert('Configuration saved', 'Your AI core settings are ready.');
    };

    return (
        <SafeAreaView style={styles.safeArea}>
            <View style={styles.glowTop} pointerEvents="none" />
            <View style={styles.glowBottom} pointerEvents="none" />

            <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
                <View style={styles.header}>
                    <Pressable style={styles.backButton} onPress={() => router.back()}>
                        <NeonText style={styles.backLabel}>Return to Dashboard</NeonText>
                    </Pressable>
                    <NeonText style={styles.title}>AI Core Instructions</NeonText>
                    <NeonText style={styles.subtitle}>{helperText}</NeonText>
                </View>

                <View style={styles.sectionCard}>
                    <NeonText style={styles.sectionTitle}>System Prompt</NeonText>
                    <TextInput
                        multiline
                        placeholder="You are my social assistant. Be funny, wingman me in conversations, and give short, punchy responses."
                        placeholderTextColor="#6d98a6"
                        value={systemPrompt}
                        onChangeText={setSystemPrompt}
                        style={styles.promptInput}
                    />
                </View>

                <View style={styles.sectionCard}>
                    <NeonText style={styles.sectionTitle}>Translation Preferences</NeonText>
                    <NeonText style={styles.sectionCopy}>
                        Choose the language used for live translations and conversation tips.
                    </NeonText>
                    <View style={styles.languageGrid}>
                        {languages.map((language) => {
                            const isActive = language === targetLanguage;
                            return (
                                <Pressable
                                    key={language}
                                    style={({ pressed }) => [
                                        styles.languageChip,
                                        isActive && styles.languageChipActive,
                                        pressed && styles.languageChipPressed,
                                    ]}
                                    onPress={() => setTargetLanguage(language)}>
                                    <NeonText style={[styles.languageLabel, isActive && styles.languageLabelActive]}>
                                        {language}
                                    </NeonText>
                                </Pressable>
                            );
                        })}
                    </View>
                </View>

                <View style={styles.sectionCard}>
                    <NeonText style={styles.sectionTitle}>Deployment</NeonText>
                    <NeonText style={styles.sectionCopy}>
                        Save your configuration to sync with the assistant runtime.
                    </NeonText>
                    <CyberButton label="Save Configuration" onPress={handleSave} />
                </View>
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: {
        flex: 1,
        backgroundColor: '#030b14',
    },
    content: {
        padding: 20,
        paddingBottom: 36,
        gap: 20,
    },
    glowTop: {
        position: 'absolute',
        top: -90,
        left: -50,
        width: 240,
        height: 240,
        borderRadius: 120,
        backgroundColor: 'rgba(18, 107, 130, 0.24)',
    },
    glowBottom: {
        position: 'absolute',
        bottom: -120,
        right: -80,
        width: 280,
        height: 280,
        borderRadius: 140,
        backgroundColor: 'rgba(0, 168, 204, 0.2)',
    },
    header: {
        gap: 10,
    },
    backButton: {
        alignSelf: 'flex-start',
    },
    backLabel: {
        fontSize: 12,
        letterSpacing: 1.4,
        textTransform: 'uppercase',
        color: '#9ad4df',
    },
    title: {
        fontSize: 24,
        fontWeight: '700',
        letterSpacing: 1.2,
    },
    subtitle: {
        fontSize: 13,
        color: '#9dd3df',
        textShadowColor: 'rgba(55, 230, 255, 0.3)',
        textShadowRadius: 6,
    },
    sectionCard: {
        borderRadius: 16,
        borderWidth: 1,
        borderColor: 'rgba(78, 232, 255, 0.35)',
        backgroundColor: 'rgba(3, 18, 33, 0.78)',
        padding: 16,
        gap: 12,
    },
    sectionTitle: {
        fontSize: 14,
        textTransform: 'uppercase',
        letterSpacing: 1.6,
        color: '#a8e9f7',
        textShadowColor: 'rgba(55, 230, 255, 0.35)',
        textShadowRadius: 8,
    },
    sectionCopy: {
        fontSize: 13,
        color: '#9ad4df',
        textShadowColor: 'rgba(55, 230, 255, 0.2)',
        textShadowRadius: 6,
    },
    promptInput: {
        minHeight: 140,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#2ce4ff',
        backgroundColor: 'rgba(6, 31, 52, 0.85)',
        color: '#dcfbff',
        paddingHorizontal: 12,
        paddingVertical: 10,
        fontSize: 14,
        textAlignVertical: 'top',
    },
    languageGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 10,
    },
    languageChip: {
        borderRadius: 999,
        borderWidth: 1,
        borderColor: 'rgba(44, 228, 255, 0.35)',
        backgroundColor: 'rgba(6, 26, 41, 0.85)',
        paddingVertical: 6,
        paddingHorizontal: 12,
    },
    languageChipActive: {
        borderColor: '#6ff6ff',
        backgroundColor: 'rgba(16, 52, 76, 0.9)',
    },
    languageChipPressed: {
        transform: [{ scale: 0.98 }],
        opacity: 0.85,
    },
    languageLabel: {
        fontSize: 12,
        color: '#c9f7ff',
        textShadowColor: 'transparent',
    },
    languageLabelActive: {
        color: '#f0fdff',
    },
});
