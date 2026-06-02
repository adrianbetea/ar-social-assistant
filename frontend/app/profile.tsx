import { useEffect, useMemo, useRef, useState } from 'react';
import {
    Alert,
    Platform,
    Pressable,
    SafeAreaView,
    ScrollView,
    StyleSheet,
    TextInput,
    View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';

import { CyberButton } from '@/components/cyber-button';
import { NeonText } from '@/components/neon-text';
import { getApiBaseUrl, getAuthToken } from '@/constants/api';

const ENROLL_DURATION_MS = 12000;

const languages = ['English', 'Spanish', 'German', 'French', 'Romanian'];
const defaultConfig = {
    systemPrompt: 'You are a helpful AR social assistant.',
    targetLanguage: 'English',
    sourceLanguage: 'English',
};

export default function ProfileSettingsScreen() {
    const router = useRouter();
    const apiBaseUrl = useMemo(() => getApiBaseUrl(), []);
    const [systemPrompt, setSystemPrompt] = useState('');
    const [targetLanguage, setTargetLanguage] = useState(languages[0]);
    const [sourceLanguage, setSourceLanguage] = useState(languages[0]);
    const [status, setStatus] = useState<'idle' | 'loading' | 'saving'>('loading');

    const [voiceEnrolled, setVoiceEnrolled] = useState<boolean | null>(null);
    const [voiceEnrolledAt, setVoiceEnrolledAt] = useState<string | null>(null);
    const [voiceStatus, setVoiceStatus] = useState<'idle' | 'recording' | 'uploading' | 'clearing'>('idle');
    const [voiceCountdown, setVoiceCountdown] = useState<number>(0);
    const mediaRecorderRef = useRef<any>(null);
    const mediaStreamRef = useRef<any>(null);
    const nativeRecordingRef = useRef<Audio.Recording | null>(null);

    const helperText = useMemo(
        () => 'Define your assistant tone, behavior, and constraints for live support.',
        []
    );

    useEffect(() => {
        let isMounted = true;

        const loadConfig = async () => {
            setStatus('loading');
            try {
                const token = getAuthToken();
                const response = await fetch(`${apiBaseUrl}/api/user/config`, {
                    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
                });
                const data = await response.json().catch(() => ({}));

                if (!response.ok) {
                    throw new Error(data.message || 'Failed to load configuration.');
                }

                if (isMounted) {
                    setSystemPrompt(data.systemPrompt || defaultConfig.systemPrompt);
                    setTargetLanguage(data.targetLanguage || defaultConfig.targetLanguage);
                    setSourceLanguage(data.sourceLanguage || defaultConfig.sourceLanguage);
                    setStatus('idle');
                }
            } catch (error) {
                if (isMounted) {
                    setSystemPrompt(defaultConfig.systemPrompt);
                    setTargetLanguage(defaultConfig.targetLanguage);
                    setSourceLanguage(defaultConfig.sourceLanguage);
                    setStatus('idle');
                }
            }
        };

        loadConfig();

        return () => {
            isMounted = false;
        };
    }, [apiBaseUrl]);

    // Load voice enrollment status
    useEffect(() => {
        let isMounted = true;
        const loadEnrollment = async () => {
            const token = getAuthToken();
            if (!token) {
                if (isMounted) setVoiceEnrolled(false);
                return;
            }
            try {
                const res = await fetch(`${apiBaseUrl}/api/whisper/enrollment`, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                const data = await res.json().catch(() => ({}));
                if (isMounted && res.ok) {
                    setVoiceEnrolled(Boolean(data.enrolled));
                    setVoiceEnrolledAt(data.enrolledAt || null);
                }
            } catch {
                if (isMounted) setVoiceEnrolled(false);
            }
        };
        loadEnrollment();
        return () => { isMounted = false; };
    }, [apiBaseUrl]);

    async function blobToBase64(blob: Blob): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const result = reader.result as string;
                const comma = result.indexOf(',');
                resolve(comma >= 0 ? result.slice(comma + 1) : result);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    async function uploadEnrollment(audioBase64: string) {
        const token = getAuthToken();
        if (!token) {
            Alert.alert('Sign in required', 'Please log in before enrolling your voice.');
            return;
        }
        setVoiceStatus('uploading');
        try {
            const res = await fetch(`${apiBaseUrl}/api/whisper/enroll`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ audioBase64 }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data.message || 'Voice enrollment failed.');
            }
            setVoiceEnrolled(true);
            setVoiceEnrolledAt(new Date().toISOString());
            Alert.alert('Voice enrolled', 'Your voiceprint is saved. The AI will now know when you speak.');
        } catch (err: any) {
            Alert.alert('Enrollment failed', err?.message || 'Could not save voiceprint.');
        } finally {
            setVoiceStatus('idle');
            setVoiceCountdown(0);
        }
    }

    async function startEnrollmentWeb() {
        try {
            const stream = await (navigator.mediaDevices as any).getUserMedia({ audio: true });
            mediaStreamRef.current = stream;
            const recorder = new (window as any).MediaRecorder(stream, { mimeType: 'audio/webm' });
            mediaRecorderRef.current = recorder;
            const chunks: BlobPart[] = [];
            recorder.ondataavailable = (e: any) => {
                if (e.data && e.data.size > 0) chunks.push(e.data);
            };
            recorder.onstop = async () => {
                try {
                    stream.getTracks().forEach((t: any) => t.stop());
                } catch {}
                const blob = new Blob(chunks, { type: 'audio/webm' });
                if (blob.size < 2000) {
                    setVoiceStatus('idle');
                    setVoiceCountdown(0);
                    Alert.alert('Recording too short', 'Please record at least 5 seconds of speech.');
                    return;
                }
                const b64 = await blobToBase64(blob);
                await uploadEnrollment(b64);
            };
            recorder.start();
            setVoiceStatus('recording');

            const startedAt = Date.now();
            setVoiceCountdown(Math.ceil(ENROLL_DURATION_MS / 1000));
            const tick = setInterval(() => {
                const remaining = Math.max(0, Math.ceil((ENROLL_DURATION_MS - (Date.now() - startedAt)) / 1000));
                setVoiceCountdown(remaining);
                if (remaining <= 0) clearInterval(tick);
            }, 250);

            setTimeout(() => {
                try {
                    if (recorder.state !== 'inactive') recorder.stop();
                } catch {}
            }, ENROLL_DURATION_MS);
        } catch (err: any) {
            setVoiceStatus('idle');
            Alert.alert('Microphone error', err?.message || 'Could not access microphone.');
        }
    }

    async function startEnrollmentNative() {
        try {
            await Audio.requestPermissionsAsync();
            await Audio.setAudioModeAsync({
                allowsRecordingIOS: true,
                playsInSilentModeIOS: true,
            });
            const { recording } = await Audio.Recording.createAsync(
                Audio.RecordingOptionsPresets.HIGH_QUALITY
            );
            nativeRecordingRef.current = recording;
            setVoiceStatus('recording');

            const startedAt = Date.now();
            setVoiceCountdown(Math.ceil(ENROLL_DURATION_MS / 1000));
            const tick = setInterval(() => {
                const remaining = Math.max(0, Math.ceil((ENROLL_DURATION_MS - (Date.now() - startedAt)) / 1000));
                setVoiceCountdown(remaining);
                if (remaining <= 0) clearInterval(tick);
            }, 250);

            await new Promise((r) => setTimeout(r, ENROLL_DURATION_MS));
            await recording.stopAndUnloadAsync();
            const uri = recording.getURI();
            nativeRecordingRef.current = null;
            if (!uri) {
                setVoiceStatus('idle');
                Alert.alert('Recording failed', 'No audio captured.');
                return;
            }
            const b64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' as any });
            await FileSystem.deleteAsync(uri, { idempotent: true });
            await uploadEnrollment(b64);
        } catch (err: any) {
            setVoiceStatus('idle');
            Alert.alert('Microphone error', err?.message || 'Could not record audio.');
        }
    }

    const handleEnrollVoice = () => {
        if (voiceStatus !== 'idle') return;
        if (Platform.OS === 'web') startEnrollmentWeb();
        else startEnrollmentNative();
    };

    const handleClearVoice = async () => {
        const token = getAuthToken();
        if (!token) return;
        setVoiceStatus('clearing');
        try {
            const res = await fetch(`${apiBaseUrl}/api/whisper/enrollment`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) throw new Error('Failed to clear voiceprint.');
            setVoiceEnrolled(false);
            setVoiceEnrolledAt(null);
        } catch (err: any) {
            Alert.alert('Clear failed', err?.message || 'Could not clear voiceprint.');
        } finally {
            setVoiceStatus('idle');
        }
    };

    const handleSave = async () => {
        const token = getAuthToken();

        if (!token) {
            Alert.alert('Sign in required', 'Please log in to save your configuration.');
            return;
        }

        setStatus('saving');

        try {
            const response = await fetch(`${apiBaseUrl}/api/user/config`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    systemPrompt,
                    targetLanguage,
                    sourceLanguage,
                }),
            });

            const data = await response.json().catch(() => ({}));

            if (!response.ok) {
                throw new Error(data.message || 'Failed to update configuration.');
            }

            setSystemPrompt(data.systemPrompt || systemPrompt);
            setTargetLanguage(data.targetLanguage || targetLanguage);
            setSourceLanguage(data.sourceLanguage || sourceLanguage);
            Alert.alert('Configuration saved', 'Your AI core settings are ready.');
        } catch (error) {
            Alert.alert('Save failed', 'Unable to update settings right now.');
        } finally {
            setStatus('idle');
        }
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
                        editable={status !== 'saving'}
                        style={styles.promptInput}
                    />
                </View>

                <View style={styles.sectionCard}>
                    <NeonText style={styles.sectionTitle}>Translation Preferences</NeonText>
                    <NeonText style={styles.sectionCopy}>
                        Target language: what you want to read (translations appear in this language).
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
                                    onPress={() => setTargetLanguage(language)}
                                    disabled={status === 'saving'}>
                                    <NeonText style={[styles.languageLabel, isActive && styles.languageLabelActive]}>
                                        {language}
                                    </NeonText>
                                </Pressable>
                            );
                        })}
                    </View>
                </View>

                <View style={styles.sectionCard}>
                    <NeonText style={styles.sectionTitle}>Listening Language</NeonText>
                    <NeonText style={styles.sectionCopy}>
                        Source language: the language being spoken around you that you want transcribed.
                    </NeonText>
                    <View style={styles.languageGrid}>
                        {languages.map((language) => {
                            const isActive = language === sourceLanguage;
                            return (
                                <Pressable
                                    key={language}
                                    style={({ pressed }) => [
                                        styles.languageChip,
                                        isActive && styles.languageChipActive,
                                        pressed && styles.languageChipPressed,
                                    ]}
                                    onPress={() => setSourceLanguage(language)}
                                    disabled={status === 'saving'}>
                                    <NeonText style={[styles.languageLabel, isActive && styles.languageLabelActive]}>
                                        {language}
                                    </NeonText>
                                </Pressable>
                            );
                        })}
                    </View>
                </View>

                <View style={styles.sectionCard}>
                    <NeonText style={styles.sectionTitle}>Voice Enrollment</NeonText>
                    <NeonText style={styles.sectionCopy}>
                        Record ~12 seconds of your voice so the AI can tell when YOU are speaking vs the other person.
                        Read any text aloud naturally.
                    </NeonText>
                    {voiceEnrolled === null ? (
                        <NeonText style={styles.statusText}>Checking voiceprint status...</NeonText>
                    ) : voiceEnrolled ? (
                        <NeonText style={[styles.statusText, { color: '#8bff6f' }]}>
                            Voiceprint active{voiceEnrolledAt ? ` (saved ${new Date(voiceEnrolledAt).toLocaleString()})` : ''}.
                        </NeonText>
                    ) : (
                        <NeonText style={styles.statusText}>No voiceprint on file. AI cannot distinguish speakers yet.</NeonText>
                    )}
                    {voiceStatus === 'recording' ? (
                        <NeonText style={[styles.statusText, { color: '#ff8b6f' }]}>
                            Recording... {voiceCountdown}s remaining. Keep speaking.
                        </NeonText>
                    ) : null}
                    {voiceStatus === 'uploading' ? (
                        <NeonText style={styles.statusText}>Uploading and computing voiceprint...</NeonText>
                    ) : null}
                    <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
                        <CyberButton
                            label={voiceEnrolled ? 'Re-enroll Voice' : 'Enroll Voice'}
                            onPress={handleEnrollVoice}
                        />
                        {voiceEnrolled ? (
                            <CyberButton label="Clear Voiceprint" onPress={handleClearVoice} />
                        ) : null}
                    </View>
                </View>

                <View style={styles.sectionCard}>
                    <NeonText style={styles.sectionTitle}>Deployment</NeonText>
                    <NeonText style={styles.sectionCopy}>
                        Save your configuration to sync with the assistant runtime.
                    </NeonText>
                    {status === 'saving' ? (
                        <NeonText style={styles.statusText}>Saving configuration...</NeonText>
                    ) : null}
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
    statusText: {
        fontSize: 12,
        color: '#8dc7d4',
        textShadowColor: 'transparent',
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
