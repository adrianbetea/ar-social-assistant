import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, SafeAreaView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';

import { NeonText } from '@/components/neon-text';
import { getApiBaseUrl, getAuthToken } from '@/constants/api';

const idleSuggestions = [
    'Ask about their latest project.',
    'Mirror their energy and smile.',
    'Offer a quick compliment on their style.',
];

const ANALYSIS_INTERVAL_MS = 10000;
const UI_REFRESH_INTERVAL_MS = 11000;
const ANALYSIS_LOCK_MS = 10000;
const CONTEXT_LIMIT = 5;
const SIMILARITY_THRESHOLD = 0.7;
const SUGGESTIONS_SIMILARITY_THRESHOLD = 0.55;

function normalizeText(value: string) {
    return value.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function similarityScore(a: string, b: string) {
    const left = normalizeText(a);
    const right = normalizeText(b);

    if (!left || !right) {
        return 0;
    }

    if (left === right) {
        return 1;
    }

    const leftTokens = new Set(left.split(' '));
    const rightTokens = new Set(right.split(' '));
    let intersection = 0;

    leftTokens.forEach((token) => {
        if (rightTokens.has(token)) {
            intersection += 1;
        }
    });

    const union = leftTokens.size + rightTokens.size - intersection;
    return union === 0 ? 0 : intersection / union;
}

export default function AssistantHudScreen() {
    const router = useRouter();
    const { width, height } = useWindowDimensions();
    const timestamp = useMemo(() => new Date().toLocaleTimeString(), []);
    const apiBaseUrl = useMemo(() => getApiBaseUrl(), []);
    const cameraRef = useRef<CameraView | null>(null);
    const [cameraPermission, requestCameraPermission] = useCameraPermissions();
    const [micPermission, requestMicPermission] = useMicrophonePermissions();
    const [isCameraReady, setIsCameraReady] = useState(false);
    const [analysis, setAnalysis] = useState('');
    const [translation, setTranslation] = useState('');
    const [speechText, setSpeechText] = useState('');
    const [suggestions, setSuggestions] = useState<string[]>(idleSuggestions);
    const [latestTip, setLatestTip] = useState('');
    const [aiStatus, setAiStatus] = useState<'IDLE' | 'SYNC' | 'LIVE' | 'ERROR'>('IDLE');
    const [netStatus, setNetStatus] = useState<'STEADY' | 'AUTH' | 'ERROR'>('STEADY');
    const [isRequestInFlight, setIsRequestInFlight] = useState(false);
    const [speechStatus, setSpeechStatus] = useState<'IDLE' | 'LIVE' | 'ERROR'>('IDLE');
    const lastUiRefreshAtRef = useRef(0);
    const lastAnalysisRefreshAtRef = useRef(0);
    const contextHistoryRef = useRef<string[]>([]);
    const lastTipRef = useRef('');
    const lastAnalysisRef = useRef('');
    const lastSuggestionsRef = useRef<string[]>([]);

    const hasPermissions = Boolean(cameraPermission?.granted && micPermission?.granted);
    const statusPills = useMemo(
        () => [
            { label: 'MIC', value: hasPermissions ? speechStatus : 'OFF' },
            { label: 'AI', value: aiStatus },
            { label: 'NET', value: netStatus },
        ],
        [aiStatus, hasPermissions, netStatus, speechStatus]
    );
    const hudOverlayStyle = useMemo(() => {
        const overlayWidth = height;
        const overlayHeight = width;
        const left = (width - overlayWidth) / 2;
        const top = (height - overlayHeight) / 2;

        return [
            styles.hudOverlay,
            {
                width: overlayWidth,
                height: overlayHeight,
                left,
                top,
                transform: [{ rotate: '90deg' }],
            },
        ];
    }, [height, width]);

    useEffect(() => {
        if (!cameraPermission?.granted) {
            requestCameraPermission();
        }

        if (!micPermission?.granted) {
            requestMicPermission();
        }
    }, [cameraPermission, micPermission, requestCameraPermission, requestMicPermission]);

    useEffect(() => {
        if (!hasPermissions) {
            return undefined;
        }

        let isActive = true;

        if (Platform.OS === 'web') {
            const SpeechRecognition =
                (window as unknown as { SpeechRecognition?: typeof window.SpeechRecognition }).SpeechRecognition ||
                (window as unknown as { webkitSpeechRecognition?: typeof window.SpeechRecognition }).webkitSpeechRecognition;

            if (!SpeechRecognition) {
                setSpeechStatus('ERROR');
                setSpeechText('Speech recognition unavailable in this browser.');
                return undefined;
            }

            const recognition = new SpeechRecognition();
            recognition.continuous = true;
            recognition.interimResults = true;
            recognition.lang = 'en-US';

            recognition.onresult = (event: SpeechRecognitionEvent) => {
                const result = event.results[event.results.length - 1];
                const transcript = result?.[0]?.transcript?.trim();
                if (transcript && isActive) {
                    setSpeechText(transcript);
                }
            };

            recognition.onerror = () => {
                if (isActive) {
                    setSpeechStatus('ERROR');
                    setSpeechText('Speech recognition stopped.');
                }
            };

            recognition.onend = () => {
                if (isActive) {
                    try {
                        recognition.start();
                    } catch (error) {
                        setSpeechStatus('ERROR');
                    }
                }
            };

            try {
                recognition.start();
                setSpeechStatus('LIVE');
            } catch (error) {
                setSpeechStatus('ERROR');
                setSpeechText('Speech recognition failed to start.');
            }

            return () => {
                isActive = false;
                recognition.stop();
            };
        }

        const { NativeModules } = require('react-native');
        if (!NativeModules?.Voice) {
            setSpeechStatus('ERROR');
            setSpeechText('Speech recognition requires a dev build.');
            return () => {
                isActive = false;
            };
        }

        const voiceModule = require('react-native-voice');
        const Voice = voiceModule.default || voiceModule;

        Voice.onSpeechResults = (event) => {
            const transcript = event.value?.[0]?.trim();
            if (transcript && isActive) {
                setSpeechText(transcript);
            }
        };

        Voice.onSpeechPartialResults = (event) => {
            const transcript = event.value?.[0]?.trim();
            if (transcript && isActive) {
                setSpeechText(transcript);
            }
        };

        Voice.onSpeechError = () => {
            if (isActive) {
                setSpeechStatus('ERROR');
                setSpeechText('Speech recognition error.');
            }
        };

        Voice.start('en-US')
            .then(() => {
                if (isActive) {
                    setSpeechStatus('LIVE');
                }
            })
            .catch(() => {
                if (isActive) {
                    setSpeechStatus('ERROR');
                    setSpeechText('Speech recognition failed to start.');
                }
            });

        return () => {
            isActive = false;
            Voice.destroy().then(Voice.removeAllListeners);
        };
    }, [hasPermissions]);

    const captureAndAnalyze = useCallback(async () => {
        const token = getAuthToken();

        if (!token) {
            setNetStatus('AUTH');
            return;
        }

        if (!cameraRef.current || isRequestInFlight) {
            return;
        }

        setIsRequestInFlight(true);

        setAiStatus('SYNC');
        setNetStatus('STEADY');

        try {
            const snapshot = await cameraRef.current.takePictureAsync({
                base64: true,
                quality: 0.4,
                skipProcessing: true,
                shutterSound: false,
            });

            if (!snapshot.base64) {
                throw new Error('Missing camera frame.');
            }

            const response = await fetch(`${apiBaseUrl}/api/ai/analyze-environment`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    imageBase64: snapshot.base64,
                    imageMimeType: snapshot.mimeType || 'image/jpeg',
                    prompt: 'Provide a quick social read and wingman tips. Return translation as an empty string.',
                    translationSnippet: speechText,
                    contextHistory: contextHistoryRef.current,
                }),
            });

            const data = await response.json().catch(() => ({}));

            if (!response.ok) {
                throw new Error(data.message || 'Failed to reach assistant.');
            }

            const now = Date.now();
            const nextAnalysis = data.analysis || 'Scanning social cues...';
            const nextSuggestions = Array.isArray(data.wingmanSuggestions) ? data.wingmanSuggestions : [];
            const nextTip = nextSuggestions[0] || '';

            const tipSimilarity = similarityScore(nextTip, lastTipRef.current);
            if (nextTip && tipSimilarity < SIMILARITY_THRESHOLD) {
                setLatestTip(nextTip);
                lastTipRef.current = nextTip;
            }

            const analysisSimilarity = similarityScore(nextAnalysis, lastAnalysisRef.current);
            if (now - lastAnalysisRefreshAtRef.current >= ANALYSIS_LOCK_MS && analysisSimilarity < SIMILARITY_THRESHOLD) {
                setAnalysis(nextAnalysis);
                lastAnalysisRefreshAtRef.current = now;
                lastAnalysisRef.current = nextAnalysis;
            }

            if (now - lastUiRefreshAtRef.current >= UI_REFRESH_INTERVAL_MS && nextSuggestions.length > 0) {
                const previousList = lastSuggestionsRef.current.join(' | ');
                const nextList = nextSuggestions.join(' | ');
                const listSimilarity = similarityScore(nextList, previousList);

                if (listSimilarity < SUGGESTIONS_SIMILARITY_THRESHOLD) {
                    setSuggestions(nextSuggestions);
                    lastSuggestionsRef.current = nextSuggestions;
                    lastUiRefreshAtRef.current = now;
                }
            }

            if (typeof data.translation === 'string') {
                setTranslation(data.translation);
            }

            if (speechText) {
                const historyEntry = [
                    nextAnalysis ? `Analysis: ${nextAnalysis}` : '',
                    nextTip ? `Tip: ${nextTip}` : '',
                    speechText ? `Heard: ${speechText}` : '',
                ]
                    .filter(Boolean)
                    .join(' | ')
                    .slice(0, 240);
                if (historyEntry) {
                    contextHistoryRef.current = [
                        historyEntry,
                        ...contextHistoryRef.current,
                    ].slice(0, CONTEXT_LIMIT);
                }
            }
            setAiStatus('LIVE');
        } catch (error) {
            setAiStatus('ERROR');
            setNetStatus('ERROR');
        } finally {
            setIsRequestInFlight(false);
        }
    }, [apiBaseUrl, isRequestInFlight, speechText]);

    useEffect(() => {
        if (!hasPermissions || !isCameraReady) {
            return undefined;
        }

        let isActive = true;
        let timer: ReturnType<typeof setTimeout> | null = null;

        const loop = async () => {
            if (!isActive) {
                return;
            }

            await captureAndAnalyze();

            if (!isActive) {
                return;
            }

            timer = setTimeout(loop, ANALYSIS_INTERVAL_MS);
        };

        timer = setTimeout(loop, 1500);

        return () => {
            isActive = false;
            if (timer) {
                clearTimeout(timer);
            }
        };
    }, [captureAndAnalyze, hasPermissions, isCameraReady]);

    return (
        <SafeAreaView style={styles.safeArea}>
            <View style={styles.cameraSurface}>
                {hasPermissions ? (
                    <CameraView
                        ref={cameraRef}
                        style={styles.camera}
                        facing="back"
                        flash="off"
                        enableTorch={false}
                        onCameraReady={() => setIsCameraReady(true)}
                    />
                ) : (
                    <View style={styles.permissionCard}>
                        <NeonText style={styles.permissionTitle}>Camera + Microphone Access</NeonText>
                        <NeonText style={styles.permissionCopy}>
                            Enable permissions to activate the live AR feed.
                        </NeonText>
                        <Pressable
                            style={styles.permissionButton}
                            onPress={() => {
                                requestCameraPermission();
                                requestMicPermission();
                            }}>
                            <NeonText style={styles.permissionButtonText}>Grant Access</NeonText>
                        </Pressable>
                    </View>
                )}
                <View style={styles.scanline} />
                <View style={styles.cornerGlow} />
            </View>

            <View style={styles.hudOverlayContainer} pointerEvents="box-none">
                <View style={hudOverlayStyle} pointerEvents="box-none">
                    <View style={styles.headerRow}>
                        <View style={styles.headerLeft}>
                            <NeonText style={styles.hudTitle}>Assistant HUD</NeonText>
                            <NeonText style={styles.hudSubtitle}>Tracking: Social context</NeonText>
                        </View>
                        <View style={styles.headerRight}>
                            <NeonText style={styles.timestamp}>{timestamp}</NeonText>
                            <View style={styles.statusRow}>
                                {statusPills.map((pill) => (
                                    <View key={pill.label} style={styles.statusPill}>
                                        <NeonText style={styles.statusLabel}>{pill.label}</NeonText>
                                        <NeonText style={styles.statusValue}>{pill.value}</NeonText>
                                    </View>
                                ))}
                            </View>
                        </View>
                    </View>

                    <View style={styles.reticleWrap} pointerEvents="none">
                        <View style={styles.reticleCore} />
                        <View style={styles.reticleRing} />
                    </View>

                    <View style={styles.panelLeft}>
                        <NeonText style={styles.panelTitle}>Subject Analysis</NeonText>
                        <NeonText style={styles.panelLine}>
                            {analysis || 'Scanning social cues...'}
                        </NeonText>
                    </View>

                    <View style={styles.panelRight}>
                        <NeonText style={styles.panelTitle}>Wingman Suggestions</NeonText>
                        <NeonText style={styles.panelLine}>Latest tip:</NeonText>
                        <NeonText style={styles.panelLine}>
                            {latestTip || suggestions[0] || 'Standby for a prompt...'}
                        </NeonText>
                        <NeonText style={styles.panelLine}>Stable cues:</NeonText>
                        {suggestions.map((suggestion) => (
                            <NeonText key={suggestion} style={styles.panelLine}>
                                - {suggestion}
                            </NeonText>
                        ))}
                    </View>

                    <View style={styles.subtitlePanel}>
                        <NeonText style={styles.subtitleLabel}>Live Translation</NeonText>
                        <NeonText style={styles.subtitleText}>
                            {translation || speechText || 'Listening for speech...'}
                        </NeonText>
                    </View>

                    <Pressable style={styles.exitButton} onPress={() => router.back()}>
                        <NeonText style={styles.exitText}>EXIT HUD</NeonText>
                    </Pressable>
                </View>
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: {
        flex: 1,
        backgroundColor: '#02070f',
    },
    cameraSurface: {
        flex: 1,
        backgroundColor: '#040c16',
        overflow: 'hidden',
    },
    camera: {
        ...StyleSheet.absoluteFillObject,
    },
    permissionCard: {
        marginHorizontal: 24,
        marginTop: 120,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: 'rgba(76, 231, 255, 0.35)',
        backgroundColor: 'rgba(4, 22, 34, 0.86)',
        padding: 18,
        gap: 10,
    },
    permissionTitle: {
        fontSize: 14,
        textTransform: 'uppercase',
        letterSpacing: 1.4,
        color: '#e4fbff',
    },
    permissionCopy: {
        fontSize: 12,
        color: '#9dd3df',
        textShadowColor: 'transparent',
    },
    permissionButton: {
        alignSelf: 'flex-start',
        borderRadius: 999,
        borderWidth: 1,
        borderColor: 'rgba(111, 246, 255, 0.6)',
        backgroundColor: 'rgba(7, 32, 48, 0.9)',
        paddingVertical: 6,
        paddingHorizontal: 14,
    },
    permissionButtonText: {
        fontSize: 11,
        letterSpacing: 1.1,
        color: '#d8fbff',
    },
    scanline: {
        position: 'absolute',
        top: 80,
        left: 0,
        right: 0,
        height: 2,
        backgroundColor: 'rgba(82, 231, 255, 0.25)',
    },
    cornerGlow: {
        position: 'absolute',
        top: -60,
        left: -40,
        width: 220,
        height: 220,
        borderRadius: 110,
        backgroundColor: 'rgba(15, 123, 156, 0.35)',
    },
    hudOverlay: {
        position: 'absolute',
        paddingHorizontal: 18,
        paddingTop: 12,
        paddingBottom: 18,
    },
    hudOverlayContainer: {
        ...StyleSheet.absoluteFillObject,
    },
    headerRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        gap: 12,
        marginTop: 8,
    },
    headerLeft: {
        gap: 4,
        paddingLeft: 30,
    },
    hudTitle: {
        fontSize: 18,
        letterSpacing: 2,
        textTransform: 'uppercase',
    },
    hudSubtitle: {
        fontSize: 12,
        color: '#8ad3e2',
    },
    headerRight: {
        alignItems: 'flex-end',
        gap: 8,
        marginTop: 8,
    },
    timestamp: {
        fontSize: 12,
        color: '#b4f5ff',
    },
    statusRow: {
        flexDirection: 'row',
        gap: 6,
    },
    statusPill: {
        borderRadius: 999,
        borderWidth: 1,
        borderColor: 'rgba(76, 231, 255, 0.4)',
        paddingVertical: 4,
        paddingHorizontal: 8,
        backgroundColor: 'rgba(5, 28, 43, 0.78)',
        alignItems: 'center',
        gap: 2,
    },
    statusLabel: {
        fontSize: 9,
        letterSpacing: 1,
        color: '#8fd9e7',
    },
    statusValue: {
        fontSize: 10,
        color: '#e1fbff',
    },
    reticleWrap: {
        position: 'absolute',
        top: '45%',
        left: '50%',
        width: 160,
        height: 160,
        marginLeft: -80,
        marginTop: -80,
        alignItems: 'center',
        justifyContent: 'center',
    },
    reticleCore: {
        width: 18,
        height: 18,
        borderRadius: 9,
        borderWidth: 2,
        borderColor: '#6ff6ff',
        backgroundColor: 'rgba(111, 246, 255, 0.12)',
    },
    reticleRing: {
        position: 'absolute',
        width: 120,
        height: 120,
        borderRadius: 60,
        borderWidth: 1,
        borderColor: 'rgba(111, 246, 255, 0.35)',
    },
    panelLeft: {
        position: 'absolute',
        bottom: 130,
        left: 60,
        width: 190,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: 'rgba(76, 231, 255, 0.35)',
        backgroundColor: 'rgba(4, 22, 34, 0.55)',
        padding: 12,
        gap: 6,
    },
    panelRight: {
        position: 'absolute',
        bottom: 170,
        right: 18,
        width: 210,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: 'rgba(255, 97, 97, 0.35)',
        backgroundColor: 'rgba(28, 8, 16, 0.55)',
        padding: 12,
        gap: 6,
    },
    panelTitle: {
        fontSize: 12,
        textTransform: 'uppercase',
        letterSpacing: 1.4,
        color: '#e4fbff',
    },
    panelLine: {
        fontSize: 11,
        color: '#a6d9e4',
        textShadowColor: 'transparent',
    },
    subtitlePanel: {
        position: 'absolute',
        left: 140,
        right: 18,
        bottom: 30,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: 'rgba(76, 231, 255, 0.35)',
        backgroundColor: 'rgba(6, 25, 38, 0.6)',
        paddingVertical: 10,
        paddingHorizontal: 14,
        gap: 6,
    },
    subtitleLabel: {
        fontSize: 11,
        textTransform: 'uppercase',
        letterSpacing: 1.2,
        color: '#90e7f1',
    },
    subtitleText: {
        fontSize: 13,
        color: '#e9fbff',
    },
    exitButton: {
        position: 'absolute',
        top: 28,
        right: 12,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: 'rgba(255, 114, 114, 0.6)',
        backgroundColor: 'rgba(36, 8, 12, 0.85)',
        paddingVertical: 6,
        paddingHorizontal: 12,
    },
    exitText: {
        fontSize: 11,
        letterSpacing: 1.2,
        color: '#ffd4d4',
    },
});
