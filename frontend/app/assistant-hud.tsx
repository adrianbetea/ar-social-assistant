import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, SafeAreaView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';

import { NeonText } from '@/components/neon-text';
import { getApiBaseUrl, getAuthToken } from '@/constants/api';

type TimerHandle = ReturnType<typeof setTimeout>;

type DetectedFace = {
    faceID?: number;
    bounds: {
        origin: { x: number; y: number };
        size: { width: number; height: number };
    };
    expression?: {
        label: string;
        score: number;
        raw?: Record<string, number>;
    };
    smilingProbability?: number;
    leftEyeOpenProbability?: number;
    rightEyeOpenProbability?: number;
    keypoints?: Array<{ x: number; y: number; name?: string }>;
};

const idleSuggestions = [
    'Ask about their latest project.',
    'Mirror their energy and smile.',
    'Offer a quick compliment on their style.',
];

const ANALYSIS_INTERVAL_MS = 10000;
const UI_REFRESH_INTERVAL_MS = 11000;
const ANALYSIS_LOCK_MS = 10000;
const CONTEXT_LIMIT = 10;
const SIMILARITY_THRESHOLD = 0.7;
const SUGGESTIONS_SIMILARITY_THRESHOLD = 0.55;
const WHISPER_RECORD_DURATION_MS = 5000;

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

function getEmotionLabel(face: DetectedFace) {
    if (face.expression?.label) {
        return face.expression.label;
    }

    const hasProbabilities =
        face.smilingProbability !== undefined ||
        face.leftEyeOpenProbability !== undefined ||
        face.rightEyeOpenProbability !== undefined;
    if (!hasProbabilities) {
        const keypoints = face.keypoints || [];
        const leftEye = keypoints.find((point) => point.name === 'leftEye');
        const rightEye = keypoints.find((point) => point.name === 'rightEye');
        const mouth = keypoints.find((point) => point.name === 'mouthCenter');
        if (leftEye && rightEye && mouth) {
            const eyesY = (leftEye.y + rightEye.y) / 2;
            const faceHeight = face.bounds.size.height || 1;
            const mouthOffset = (mouth.y - eyesY) / faceHeight;

            if (mouthOffset < 0.45) return 'Happy';
            if (mouthOffset > 0.65) return 'Sad';
            return 'Neutral';
        }
        return 'Neutral';
    }

    const smile = face.smilingProbability ?? 0;
    const leftEye = face.leftEyeOpenProbability ?? 1;
    const rightEye = face.rightEyeOpenProbability ?? 1;
    const eyeOpen = (leftEye + rightEye) / 2;

    if (smile > 0.6) return 'Happy';
    if (smile < 0.2 && eyeOpen < 0.4) return 'Sad';
    if (eyeOpen < 0.35) return 'Sleepy';
    if (smile < 0.15 && eyeOpen > 0.7) return 'Serious';
    return 'Neutral';
}

function getExpressionLabel(expressions?: Record<string, number>) {
    if (!expressions) return { label: 'Neutral', score: 0 };

    const entries = Object.entries(expressions);
    if (!entries.length) return { label: 'Neutral', score: 0 };

    const [rawLabel, score] = entries.reduce(
        (best, current) => (current[1] > best[1] ? current : best),
        entries[0]
    );

    const labelMap: Record<string, string> = {
        happy: 'Happy',
        sad: 'Sad',
        angry: 'Angry',
        fearful: 'Fear',
        disgusted: 'Disgust',
        surprised: 'Surprised',
        neutral: 'Neutral',
    };

    if (score < 0.45) {
        return { label: 'Neutral', score };
    }

    return {
        label: labelMap[rawLabel] || 'Neutral',
        score,
    };
}

function getVibeColor(label: string) {
    if (label === 'Happy') return '#8bff6f';
    if (label === 'Sad' || label === 'Fear') return '#ff8b6f';
    if (label === 'Angry' || label === 'Disgust') return '#ff5f5f';
    if (label === 'Surprised') return '#ffe36f';
    return '#6ff6ff';
}

function sanitizeFaceBounds(x: number, y: number, w: number, h: number, maxWidth: number, maxHeight: number) {
    const safeX = Number.isFinite(x) ? x : 0;
    const safeY = Number.isFinite(y) ? y : 0;
    const safeW = Number.isFinite(w) ? w : 0;
    const safeH = Number.isFinite(h) ? h : 0;

    const width = Math.max(60, Math.min(safeW, maxWidth));
    const height = Math.max(60, Math.min(safeH, maxHeight));
    const left = Math.max(0, Math.min(safeX, maxWidth - width));
    const top = Math.max(0, Math.min(safeY, maxHeight - height));

    return { left, top, width, height };
}

function createWebLabelSprite(three: any, text: string) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        return new three.Sprite();
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(8, 24, 36, 0.8)';
    ctx.strokeStyle = 'rgba(111, 246, 255, 0.6)';
    ctx.lineWidth = 3;
    if (typeof (ctx as any).roundRect === 'function') {
        (ctx as any).roundRect(12, 12, canvas.width - 24, canvas.height - 24, 20);
        ctx.fill();
        ctx.stroke();
    } else {
        ctx.fillRect(12, 12, canvas.width - 24, canvas.height - 24);
        ctx.strokeRect(12, 12, canvas.width - 24, canvas.height - 24);
    }

    ctx.fillStyle = '#e9fbff';
    ctx.font = '28px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);

    const texture = new three.CanvasTexture(canvas);
    texture.minFilter = three.LinearFilter;
    const material = new three.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new three.Sprite(material);
    sprite.scale.set(0.22, 0.11, 1);
    return sprite;
}

export default function AssistantHudScreen() {
    const router = useRouter();
    const { width, height } = useWindowDimensions();
    const timestamp = useMemo(() => new Date().toLocaleTimeString(), []);
    const apiBaseUrl = useMemo(() => getApiBaseUrl(), []);
    const cameraFacing = Platform.OS === 'web' ? 'front' : 'back';
    const cameraRef = useRef<CameraView | null>(null);
    const webVideoRef = useRef<HTMLVideoElement | null>(null);
    const webStreamRef = useRef<MediaStream | null>(null);
    const [cameraPermission, requestCameraPermission] = useCameraPermissions();
    const [micPermission, requestMicPermission] = useMicrophonePermissions();
    const [isCameraReady, setIsCameraReady] = useState(false);
    const [analysis, setAnalysis] = useState('');
    const [translation, setTranslation] = useState('');
    const [speechText, setSpeechText] = useState('');
    const [suggestions, setSuggestions] = useState<string[]>(idleSuggestions);
    const [faces, setFaces] = useState<DetectedFace[]>([]);
    const [faceModule, setFaceModule] = useState<any | null>(null);
    const [webFaceDetector, setWebFaceDetector] = useState<any | null>(null);
    const [faceApi, setFaceApi] = useState<any | null>(null);
    const [webFaceApiReady, setWebFaceApiReady] = useState(false);
    const [localEmotion, setLocalEmotion] = useState('Neutral');
    const [vibeColor, setVibeColor] = useState('#6ff6ff');
    const latestFaceRef = useRef<DetectedFace | null>(null);
    const lastStableFaceRef = useRef<DetectedFace | null>(null);
    const webThreeContainerRef = useRef<HTMLDivElement | null>(null);
    const webThreeRendererRef = useRef<any | null>(null);
    const webThreeSceneRef = useRef<any | null>(null);
    const webThreeCameraRef = useRef<any | null>(null);
    const webThreeLabelRef = useRef<any | null>(null);
    const webThreeGroupRef = useRef<any | null>(null);
    const webThreeIconRef = useRef<any | null>(null);
    const showWebEmotionOverlay = false;
    const [aiStatus, setAiStatus] = useState<'IDLE' | 'SYNC' | 'LIVE' | 'ERROR'>('IDLE');
    const [netStatus, setNetStatus] = useState<'STEADY' | 'AUTH' | 'ERROR'>('STEADY');
    const [isRequestInFlight, setIsRequestInFlight] = useState(false);
    const [speechStatus, setSpeechStatus] = useState<'IDLE' | 'LIVE' | 'ERROR'>('IDLE');
    const lastUiRefreshAtRef = useRef(0);
    const lastAnalysisRefreshAtRef = useRef(0);
    const contextHistoryRef = useRef<string[]>([]);
    const lastAnalysisRef = useRef('');
    const lastSuggestionsRef = useRef<string[]>([]);
    const detectionLogRef = useRef(0);

    useEffect(() => {
        if (Platform.OS !== 'web') {
            return;
        }

        let isActive = true;

        const loadModels = async () => {
            try {
                const module = await import('@vladmandic/face-api/dist/face-api.esm.js');
                if (!isActive) return;

                setFaceApi(module);

                const MODEL_URL = '/face-api-models/';
                await module.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
                await module.nets.faceExpressionNet.loadFromUri(MODEL_URL);

                if (!isActive) return;
                setWebFaceApiReady(true);
                console.log('[HUD] face-api models ready');
                console.log('✅ Web Face AI Models Loaded!');
            } catch (e) {
                if (!isActive) return;
                setWebFaceApiReady(false);
                console.error('Failed to load Web AI models:', e);
            }
        };

        loadModels();

        return () => {
            isActive = false;
        };
    }, []);

    const hasPermissions = Boolean(cameraPermission?.granted && micPermission?.granted);
    const statusPills = useMemo(
        () => [
            { label: 'MIC', value: hasPermissions ? speechStatus : 'OFF' },
            { label: 'AI', value: aiStatus },
            { label: 'NET', value: netStatus },
        ],
        [aiStatus, hasPermissions, netStatus, speechStatus]
    );
    const faceDetectionEnabled = Platform.OS !== 'web' && Boolean(faceModule);
    const webFaceDetectionEnabled = Platform.OS === 'web';
    const faceDetectorSettings = useMemo(() => {
        if (!faceModule) return null;
        return {
            mode: faceModule.FaceDetectorMode.fast,
            detectLandmarks: faceModule.FaceDetectorLandmarks.none,
            runClassifications: faceModule.FaceDetectorClassifications.all,
            minDetectionInterval: 150,
            tracking: true,
        };
    }, [faceModule]);
    const handleFacesDetected = useCallback(
        ({ faces: detectedFaces }: { faces: DetectedFace[] }) => {
            setFaces(detectedFaces);
        },
        []
    );
    const hudOverlayStyle = useMemo(() => {
        return [
            styles.hudOverlay,
            {
                width,
                height,
                left: 0,
                top: 0,
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
        latestFaceRef.current = faces.length > 0 ? faces[0] : null;
        const candidate = faces[0];
        if (candidate && candidate.bounds.size.width > 30 && candidate.bounds.size.height > 30) {
            lastStableFaceRef.current = candidate;
        }
    }, [faces]);

    useEffect(() => {
        if (Platform.OS !== 'web') {
            return;
        }

        if (!showWebEmotionOverlay) {
            return;
        }

        let isActive = true;
        let animationId: number | null = null;
        let three: any = null;

        const setupThree = async () => {
            try {
                three = await import('three');
                if (!isActive) return;

                const container = document.createElement('div');
                container.style.position = 'fixed';
                container.style.left = '0';
                container.style.top = '0';
                container.style.width = '100%';
                container.style.height = '100%';
                container.style.pointerEvents = 'none';
                container.style.zIndex = '3';
                document.body.appendChild(container);
                webThreeContainerRef.current = container;

                const renderer = new three.WebGLRenderer({ antialias: true, alpha: true });
                renderer.setSize(window.innerWidth, window.innerHeight);
                container.appendChild(renderer.domElement);
                webThreeRendererRef.current = renderer;

                const scene = new three.Scene();
                const camera = new three.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 30);
                camera.position.set(0, 0, 0.1);
                webThreeSceneRef.current = scene;
                webThreeCameraRef.current = camera;

                let lastLabel = 'Emotion: Neutral';
                const label = createWebLabelSprite(three, lastLabel);
                const group = new three.Group();
                label.visible = false;
                group.add(label);
                webThreeLabelRef.current = label;
                webThreeGroupRef.current = group;

                const iconGeometry = new three.SphereGeometry(0.04, 20, 20);
                const iconMaterial = new three.MeshBasicMaterial({ color: 0x6ff6ff });
                const iconMesh = new three.Mesh(iconGeometry, iconMaterial);
                iconMesh.position.set(0.4, 0.0, 0);
                webThreeIconRef.current = iconMesh;
                group.add(iconMesh);
                scene.add(group);

                const onResize = () => {
                    if (!renderer || !camera) return;
                    renderer.setSize(window.innerWidth, window.innerHeight);
                    camera.aspect = window.innerWidth / window.innerHeight;
                    camera.updateProjectionMatrix();
                };
                window.addEventListener('resize', onResize);

                const renderLoop = () => {
                    if (!isActive || !renderer || !scene || !camera || !label) return;

                    const MARGIN = 40;
                    const face = latestFaceRef.current ?? lastStableFaceRef.current;
                    const activeLabel = webThreeLabelRef.current ?? label;
                    const viewWidth = renderer.domElement.clientWidth || window.innerWidth;
                    const viewHeight = renderer.domElement.clientHeight || window.innerHeight;

                    const hasFace = Boolean(face && face.bounds.size.width > 30 && face.bounds.size.height > 30);
                    const rawCenterX = hasFace
                        ? face!.bounds.origin.x + face!.bounds.size.width / 2
                        : viewWidth / 2;
                    const rawCenterY = hasFace
                        ? face!.bounds.origin.y - face!.bounds.size.height * 0.35
                        : viewHeight / 2;
                    const isValidFace = hasFace
                        && rawCenterX >= MARGIN
                        && rawCenterX <= viewWidth - MARGIN
                        && rawCenterY >= MARGIN
                        && rawCenterY <= viewHeight - MARGIN;
                    const centerX = isValidFace ? rawCenterX : viewWidth / 2;
                    const centerY = isValidFace ? rawCenterY : viewHeight / 2;
                    const cx = centerX / viewWidth;
                    const cy = centerY / viewHeight;
                    const ndcX = cx * 2 - 1;
                    const ndcY = -(cy * 2 - 1);
                    const vector = new three.Vector3(ndcX, ndcY, -1).unproject(camera);
                    const direction = vector.sub(camera.position).normalize();
                    const distance = 1.0;
                    group.position.copy(camera.position).add(direction.multiplyScalar(distance));

                    const nextLabel = `Emotion: ${hasFace ? getEmotionLabel(face!) : 'Neutral'}`;
                    if (nextLabel !== lastLabel) {
                        group.remove(activeLabel);
                        if (activeLabel.material?.map) {
                            activeLabel.material.map.dispose();
                        }
                        activeLabel.material?.dispose?.();
                        const newLabel = createWebLabelSprite(three, nextLabel);
                        newLabel.visible = true;
                        group.add(newLabel);
                        webThreeLabelRef.current = newLabel;
                        lastLabel = nextLabel;
                    } else {
                        activeLabel.visible = true;
                    }

                    if (webThreeIconRef.current) {
                        const iconColor = nextLabel.includes('Happy')
                            ? 0x8bff6f
                            : nextLabel.includes('Sad')
                                ? 0xff8b6f
                                : 0x6ff6ff;
                        webThreeIconRef.current.material.color.setHex(iconColor);
                    }

                    renderer.render(scene, camera);
                    animationId = window.requestAnimationFrame(renderLoop);
                };

                renderLoop();

                return () => {
                    window.removeEventListener('resize', onResize);
                };
            } catch (error) {
                console.warn('[HUD] Web three.js overlay failed:', error);
            }
        };

        let teardown: (() => void) | undefined;
        setupThree().then((cleanup) => {
            teardown = cleanup;
        });

        return () => {
            isActive = false;
            if (animationId) {
                window.cancelAnimationFrame(animationId);
            }
            if (webThreeRendererRef.current) {
                webThreeRendererRef.current.dispose();
                webThreeRendererRef.current = null;
            }
            if (webThreeLabelRef.current) {
                if (webThreeSceneRef.current) {
                    webThreeSceneRef.current.remove(webThreeLabelRef.current);
                }
                if (webThreeLabelRef.current.material?.map) {
                    webThreeLabelRef.current.material.map.dispose();
                }
                webThreeLabelRef.current.material?.dispose?.();
                webThreeLabelRef.current = null;
            }
            if (webThreeIconRef.current) {
                webThreeIconRef.current.geometry?.dispose?.();
                webThreeIconRef.current.material?.dispose?.();
                webThreeIconRef.current = null;
            }
            if (webThreeGroupRef.current && webThreeSceneRef.current) {
                webThreeSceneRef.current.remove(webThreeGroupRef.current);
                webThreeGroupRef.current = null;
            }
            if (webThreeContainerRef.current) {
                webThreeContainerRef.current.remove();
                webThreeContainerRef.current = null;
            }
            webThreeSceneRef.current = null;
            webThreeCameraRef.current = null;
            if (teardown) {
                teardown();
            }
        };
    }, [height, width]);

    useEffect(() => {
        if (Platform.OS === 'web') {
            return;
        }

        try {
            const module = require('expo-face-detector');
            setFaceModule(module);
        } catch (error) {
            setFaceModule(null);
        }
    }, []);

    useEffect(() => {
        if (Platform.OS !== 'web') {
            return;
        }

        let isActive = true;
        let detector: any = null;

        const loadDetector = async () => {
            try {
                const tf = await import('@tensorflow/tfjs-core');
                await import('@tensorflow/tfjs-backend-webgl');
                const faceDetection = await import('@tensorflow-models/face-detection');

                await tf.setBackend('webgl');
                await tf.ready();

                detector = await faceDetection.createDetector(
                    faceDetection.SupportedModels.MediaPipeFaceDetector,
                    { runtime: 'tfjs', maxFaces: 3, modelType: 'full' }
                );

                if (isActive) {
                    setWebFaceDetector(detector);
                    console.log('[HUD] tfjs face detector ready');
                }
            } catch (error) {
                if (isActive) {
                    setWebFaceDetector(null);
                }
                console.warn('[HUD] Web face detector failed to load:', error);
            }
        };

        loadDetector();

        return () => {
            isActive = false;
            if (detector?.dispose) {
                detector.dispose();
            }
        };
    }, []);

    useEffect(() => {
        if (Platform.OS !== 'web') {
            return;
        }

        let isActive = true;
        const setupVideo = async () => {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: {
                        facingMode: 'user',
                        width: { ideal: 1280 },
                        height: { ideal: 720 },
                        frameRate: { ideal: 30 },
                    },
                    audio: false,
                });

                if (!isActive) {
                    stream.getTracks().forEach((track) => track.stop());
                    return;
                }

                const video = document.createElement('video');
                video.autoplay = true;
                video.muted = true;
                video.playsInline = true;
                video.style.position = 'fixed';
                video.style.left = '-9999px';
                video.style.top = '-9999px';
                video.style.width = '1px';
                video.style.height = '1px';
                video.srcObject = stream;
                document.body.appendChild(video);

                webStreamRef.current = stream;
                webVideoRef.current = video;

                await video.play();
                if (isActive) {
                    setIsCameraReady(true);
                }
            } catch (error) {
                console.warn('[HUD] Web camera setup failed:', error);
            }
        };

        setupVideo();

        return () => {
            isActive = false;
            if (webStreamRef.current) {
                webStreamRef.current.getTracks().forEach((track) => track.stop());
                webStreamRef.current = null;
            }
            if (webVideoRef.current) {
                webVideoRef.current.remove();
                webVideoRef.current = null;
            }
        };
    }, []);

    useEffect(() => {
        if (!webFaceDetectionEnabled || !hasPermissions) {
            return undefined;
        }

        let isActive = true;
        let inFlight = false;
        let timer: ReturnType<typeof setTimeout> | null = null;

        const runDetection = async () => {
            const requiresDetector = webFaceDetector || (webFaceApiReady && faceApi);
            if (!isActive || (Platform.OS !== 'web' && !cameraRef.current) || !requiresDetector) {
                return;
            }

            if (inFlight) {
                timer = setTimeout(runDetection, 800);
                return;
            }

            inFlight = true;
            try {
                const video = webVideoRef.current;
                if (!video || video.readyState < 2) {
                    if (Date.now() - detectionLogRef.current > 5000) {
                        console.log('[HUD] Web detect: waiting for video stream');
                        detectionLogRef.current = Date.now();
                    }
                    setFaces([]);
                } else {
                    const vidWidth = video.videoWidth || width;
                    const vidHeight = video.videoHeight || height;
                    const viewAspect = width / height;
                    const videoAspect = vidWidth / vidHeight;

                    let scale = 1;
                    let offsetX = 0;
                    let offsetY = 0;

                    if (videoAspect > viewAspect) {
                        scale = height / vidHeight;
                        const scaledWidth = vidWidth * scale;
                        offsetX = (width - scaledWidth) / 2;
                    } else {
                        scale = width / vidWidth;
                        const scaledHeight = vidHeight * scale;
                        offsetY = (height - scaledHeight) / 2;
                    }

                    let mapped: DetectedFace[] = [];
                    let expressionDetections: Array<any> | null = null;

                    if (webFaceApiReady && faceApi) {
                        try {
                            const options = new faceApi.TinyFaceDetectorOptions({
                                inputSize: 224,
                                scoreThreshold: 0.5,
                            });
                            expressionDetections = await faceApi
                                .detectAllFaces(video, options)
                                .withFaceExpressions();
                        } catch (error) {
                            console.warn('[HUD] face-api detect error:', error);
                            expressionDetections = null;
                        }

                        if (expressionDetections?.length) {
                            mapped = expressionDetections.map((det: any, index: number) => {
                                const box = det?.detection?.box || {};
                                const scaledX = (box.x ?? 0) * scale;
                                const scaledY = (box.y ?? 0) * scale;
                                const scaledWidth = (box.width ?? 0) * scale;
                                const scaledHeight = (box.height ?? 0) * scale;
                                const mirroredX = cameraFacing === 'front'
                                    ? width - (scaledX + scaledWidth) + offsetX
                                    : scaledX + offsetX;
                                const safe = sanitizeFaceBounds(
                                    mirroredX,
                                    scaledY + offsetY,
                                    scaledWidth,
                                    scaledHeight,
                                    width,
                                    height
                                );
                                const { label, score } = getExpressionLabel(det?.expressions);
                                return {
                                    faceID: det?.detection?.score ? `${index}-${det.detection.score}` : index,
                                    bounds: {
                                        origin: { x: safe.left, y: safe.top },
                                        size: { width: safe.width, height: safe.height },
                                    },
                                    expression: {
                                        label,
                                        score,
                                        raw: det?.expressions,
                                    },
                                } as DetectedFace;
                            });
                        }
                    }

                    if (!mapped.length) {
                        const detections = await webFaceDetector.estimateFaces(video, {
                            flipHorizontal: cameraFacing === 'front',
                        });

                        if (Array.isArray(detections)) {
                            mapped = detections.map((det: any, index: number) => {
                            const box = det?.box || det?.boundingBox || {};
                            let xMin = box.xMin ?? box.left ?? box.x ?? 0;
                            let yMin = box.yMin ?? box.top ?? box.y ?? 0;
                            let xMax = box.xMax ?? (xMin + (box.width ?? 0));
                            let yMax = box.yMax ?? (yMin + (box.height ?? 0));

                            if (!(xMax > xMin && yMax > yMin) && Array.isArray(det?.keypoints)) {
                                const xs = det.keypoints.map((pt: any) => pt?.x).filter((v: any) => Number.isFinite(v));
                                const ys = det.keypoints.map((pt: any) => pt?.y).filter((v: any) => Number.isFinite(v));
                                if (xs.length && ys.length) {
                                    xMin = Math.min(...xs);
                                    xMax = Math.max(...xs);
                                    yMin = Math.min(...ys);
                                    yMax = Math.max(...ys);
                                }
                            }
                            const faceWidth = Math.max(0, xMax - xMin);
                            const faceHeight = Math.max(0, yMax - yMin);
                            const scaledX = xMin * scale;
                            const scaledY = yMin * scale;
                            const scaledWidth = faceWidth * scale;
                            const scaledHeight = faceHeight * scale;
                            const mirroredX = cameraFacing === 'front'
                                ? width - (scaledX + scaledWidth) + offsetX
                                : scaledX + offsetX;
                            const safe = sanitizeFaceBounds(
                                mirroredX,
                                scaledY + offsetY,
                                scaledWidth,
                                scaledHeight,
                                width,
                                height
                            );

                            const keypoints = Array.isArray(det?.keypoints)
                                ? det.keypoints
                                    .filter((point: any) => Number.isFinite(point?.x) && Number.isFinite(point?.y))
                                    .map((point: any) => ({
                                        x: point.x * scale + offsetX,
                                        y: point.y * scale + offsetY,
                                        name: point.name,
                                    }))
                                : undefined;

                            return {
                                faceID: det?.faceID ?? det?.id ?? index,
                                bounds: {
                                    origin: {
                                        x: safe.left,
                                        y: safe.top,
                                    },
                                    size: {
                                        width: safe.width,
                                        height: safe.height,
                                    },
                                },
                                keypoints,
                            } as DetectedFace;
                            });
                        }
                    }

                    if (mapped.length) {
                        const primary = mapped.find((face) => face.expression?.label) ?? mapped[0];
                        if (primary?.expression?.label) {
                            setLocalEmotion(primary.expression.label);
                            setVibeColor(getVibeColor(primary.expression.label));
                        }
                        setFaces(mapped);
                    } else {
                        setFaces([]);
                    }

                    if (Date.now() - detectionLogRef.current > 5000) {
                        console.log(
                            `[HUD] Web detect: faces=${mapped.length} faceApi=${Boolean(faceApi)} `
                            + `webDetector=${Boolean(webFaceDetector)} faceApiReady=${webFaceApiReady}`
                        );
                        detectionLogRef.current = Date.now();
                    }
                }
            } catch (error) {
                console.warn('[HUD] Web detect loop error:', error);
                setFaces([]);
            } finally {
                inFlight = false;
                if (isActive) {
                    timer = setTimeout(runDetection, 800);
                }
            }
        };

        runDetection();

        return () => {
            isActive = false;
            if (timer) {
                clearTimeout(timer);
            }
        };
    // Remove isCameraReady from the dep array of the web detection useEffect
    }, [cameraFacing, faceApi, hasPermissions, height, webFaceApiReady, webFaceDetectionEnabled, webFaceDetector, width]);
    useEffect(() => {
        if (!hasPermissions) {
            return undefined;
        }

        let isActive = true;
        let recordingRef: Audio.Recording | null = null;
        let timer: any = null;
        let recognition: any = null;
        let interimDebounce: any = null;
        let lastTranslatedText = '';

        async function translateText(text: string) {
            const token = getAuthToken();
            if (!token || !text.trim()) return;
            try {
                const response = await fetch(`${apiBaseUrl}/api/whisper/translate-text`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({ text: text.trim() }),
                });
                if (response.ok && isActive) {
                    const data = await response.json();
                    const translated = data.text?.trim();
                    const original = data.originalText?.trim();
                    if (translated && original && translated !== original) {
                        setTranslation(translated);
                        setSpeechText(original);
                        lastTranslatedText = original;
                    } else if (original) {
                        setSpeechText(original);
                        setTranslation('');
                    }
                }
            } catch (err: any) {
                console.error('[HUD] translate error:', err?.message);
            }
        }

        // --- Web: Use Web Speech API (Google-powered, real-time, no hallucinations) ---
        async function startWebSpeechRecognition() {
            const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
            if (!SpeechRecognition) {
                setSpeechStatus('ERROR');
                setSpeechText('Web Speech API not supported in this browser');
                return;
            }

            // Fetch user config to get source language (what to listen for)
            let recognitionLang = 'en-US';
            try {
                const token = getAuthToken();
                if (token) {
                    const configRes = await fetch(`${apiBaseUrl}/api/user/config`, {
                        headers: { Authorization: `Bearer ${token}` },
                    });
                    if (configRes.ok) {
                        const config = await configRes.json();
                        const langMap: Record<string, string> = {
                            english: 'en-US',
                            romanian: 'ro-RO',
                            french: 'fr-FR',
                            spanish: 'es-ES',
                            german: 'de-DE',
                        };
                        const source = (config.sourceLanguage || 'english').toLowerCase();
                        recognitionLang = langMap[source] || 'en-US';
                    }
                }
            } catch (err) {
                // Fallback to English
            }

            recognition = new SpeechRecognition();
            recognition.continuous = true;
            recognition.interimResults = true;
            recognition.maxAlternatives = 1;
            recognition.lang = recognitionLang;

            recognition.onstart = () => {
                setSpeechStatus('LIVE');
            };

            recognition.onresult = (event: any) => {
                if (!isActive) return;

                let finalTranscript = '';
                let interimTranscript = '';

                for (let i = event.resultIndex; i < event.results.length; i++) {
                    const result = event.results[i];
                    if (result.isFinal) {
                        finalTranscript += result[0].transcript;
                    } else {
                        interimTranscript += result[0].transcript;
                    }
                }

                // Show interim results immediately and debounce-translate
                if (interimTranscript) {
                    setSpeechText(interimTranscript);
                    // Debounce: translate interim after 700ms of no new input
                    if (interimDebounce) clearTimeout(interimDebounce);
                    interimDebounce = setTimeout(() => {
                        if (isActive && interimTranscript !== lastTranslatedText) {
                            translateText(interimTranscript);
                        }
                    }, 700);
                }

                // For final results, translate immediately (cancel debounce)
                if (finalTranscript.trim()) {
                    if (interimDebounce) clearTimeout(interimDebounce);
                    setSpeechText(finalTranscript.trim());
                    translateText(finalTranscript.trim());
                }
            };

            recognition.onerror = (event: any) => {
                if (!isActive) return;
                if (event.error === 'no-speech' || event.error === 'aborted') {
                    return;
                }
                console.warn('Speech recognition error:', event.error);
                setSpeechStatus('ERROR');
            };

            recognition.onend = () => {
                if (isActive) {
                    try {
                        recognition.start();
                    } catch (e) {
                        // Already started, ignore
                    }
                }
            };

            recognition.start();
        }

        // --- Native: Keep Whisper for mobile (no Web Speech API available) ---
        async function recordAndTranscribeNative() {
            if (!isActive) return;

            try {
                await Audio.setAudioModeAsync({
                    allowsRecordingIOS: true,
                    playsInSilentModeIOS: true,
                });

                const { recording } = await Audio.Recording.createAsync(
                    Audio.RecordingOptionsPresets.HIGH_QUALITY
                );
                recordingRef = recording;
                setSpeechStatus('LIVE');

                await new Promise((resolve) => {
                    timer = setTimeout(resolve, WHISPER_RECORD_DURATION_MS);
                });

                if (!isActive) return;

                await recording.stopAndUnloadAsync();
                recordingRef = null;

                const uri = recording.getURI();
                if (!uri) {
                    scheduleNextNative();
                    return;
                }

                const base64Audio = await FileSystem.readAsStringAsync(uri, {
                    encoding: 'base64' as any,
                });

                await FileSystem.deleteAsync(uri, { idempotent: true });

                if (!base64Audio || !isActive) {
                    scheduleNextNative();
                    return;
                }

                const token = getAuthToken();
                if (!token) {
                    scheduleNextNative();
                    return;
                }

                const response = await fetch(`${apiBaseUrl}/api/whisper/transcribe`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({ audioBase64: base64Audio }),
                });

                if (response.ok && isActive) {
                    const data = await response.json();
                    const text = data.text?.trim();
                    const original = data.originalText?.trim();
                    if (text) {
                        setSpeechText(text);
                        if (original && original !== text) {
                            setTranslation(text);
                            setSpeechText(original);
                        }
                    }
                }
            } catch (error) {
                console.warn('Native speech recording error:', error);
                if (isActive) {
                    setSpeechStatus('ERROR');
                }
            }

            scheduleNextNative();
        }

        function scheduleNextNative() {
            if (isActive) {
                timer = setTimeout(recordAndTranscribeNative, 1000);
            }
        }

        if (Platform.OS === 'web') {
            startWebSpeechRecognition();
        } else {
            recordAndTranscribeNative();
        }

        return () => {
            isActive = false;
            if (timer) clearTimeout(timer);
            if (interimDebounce) clearTimeout(interimDebounce);
            if (recognition) {
                try { recognition.stop(); } catch (e) {}
            }
            if (recordingRef) {
                recordingRef.stopAndUnloadAsync().catch(() => {});
            }
        };
    }, [hasPermissions, apiBaseUrl]);

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
                    imageMimeType: (snapshot as any).mimeType || 'image/jpeg',
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

            if (typeof data.translation === 'string' && data.translation.trim()) {
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
                        facing={cameraFacing}
                        flash="off"
                        enableTorch={false}
                        onCameraReady={() => setIsCameraReady(true)}
                        {...(faceDetectionEnabled && faceDetectorSettings
                            ? {
                                onFacesDetected: handleFacesDetected,
                                faceDetectorSettings,
                            }
                            : {})}
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
                {(faceDetectionEnabled || webFaceDetectionEnabled || faces.length > 0) ? (
                    <View style={styles.faceOverlay} pointerEvents="none">
                        {faces.map((face) => {
                            const { origin, size } = face.bounds;
                            const emotion = getEmotionLabel(face);
                            return (
                                <View
                                    key={face.faceID ?? `${origin.x}-${origin.y}`}
                                    style={[
                                        styles.faceFrame,
                                        {
                                            left: origin.x,
                                            top: origin.y,
                                            width: size.width,
                                            height: size.height,
                                        },
                                    ]}
                                >
                                    <View style={[styles.faceLabel, { borderColor: vibeColor }]}>
                                        <NeonText style={[styles.faceLabelText, { color: vibeColor }]}>
                                            {emotion}
                                        </NeonText>
                                    </View>
                                    <View style={styles.faceRing} />
                                    <View style={styles.faceRingInner} />
                                </View>
                            );
                        })}
                    </View>
                ) : null}
                <View style={hudOverlayStyle} pointerEvents="box-none">
                    <View style={styles.headerRow}>
                        <View style={styles.headerLeft}>
                            <NeonText style={styles.hudTitle}>Assistant HUD</NeonText>
                            <NeonText style={styles.hudSubtitle}>Tracking: Social context</NeonText>
                        </View>
                        <View style={styles.headerRight}>
                            <NeonText style={styles.timestamp}>{timestamp}</NeonText>
                            <View style={[styles.emotionBadge, { borderColor: vibeColor }]}> 
                                <NeonText style={[styles.emotionBadgeText, { color: vibeColor }]}>
                                    {localEmotion}
                                </NeonText>
                            </View>
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
                        <NeonText style={styles.panelLine}>Suggestions:</NeonText>
                        {suggestions.map((suggestion) => (
                            <NeonText key={suggestion} style={styles.panelLine}>
                                - {suggestion}
                            </NeonText>
                        ))}
                    </View>

                    <View style={styles.subtitlePanel}>
                        <NeonText style={styles.subtitleLabel}>Live Translation</NeonText>
                        {translation ? (
                            <>
                                <NeonText style={styles.subtitleText}>{`translation: ${translation}`}</NeonText>
                                {speechText && speechText !== translation ? (
                                    <NeonText style={styles.subtitleOriginal}>{`(original: ${speechText})`}</NeonText>
                                ) : null}
                            </>
                        ) : (
                            <NeonText style={styles.subtitleText}>
                                {`speech: ${speechText}` || 'Listening for speech...'}
                            </NeonText>
                        )}
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
    faceOverlay: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 1,
    },
    faceFrame: {
        position: 'absolute',
        borderRadius: 999,
        borderWidth: 2,
        borderColor: 'rgba(111, 246, 255, 0.6)',
        alignItems: 'center',
        justifyContent: 'center',
    },
    faceRing: {
        position: 'absolute',
        width: '92%',
        height: '92%',
        borderRadius: 999,
        borderWidth: 1,
        borderColor: 'rgba(111, 246, 255, 0.5)',
    },
    faceRingInner: {
        position: 'absolute',
        width: '72%',
        height: '72%',
        borderRadius: 999,
        borderWidth: 1,
        borderColor: 'rgba(111, 246, 255, 0.22)',
    },
    faceLabel: {
        position: 'absolute',
        top: -24,
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: 'rgba(111, 246, 255, 0.4)',
        backgroundColor: 'rgba(5, 28, 43, 0.78)',
    },
    faceLabelText: {
        fontSize: 10,
        letterSpacing: 1.1,
        color: '#d8fbff',
    },
    hudOverlay: {
        position: 'absolute',
        paddingHorizontal: 18,
        paddingTop: 12,
        paddingBottom: 18,
        zIndex: 2,
    },
    hudOverlayContainer: {
        ...StyleSheet.absoluteFillObject,
        zIndex: 2,
        elevation: 2,
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
    emotionBadge: {
        borderRadius: 999,
        borderWidth: 1,
        backgroundColor: 'rgba(5, 28, 43, 0.78)',
        paddingVertical: 4,
        paddingHorizontal: 10,
    },
    emotionBadgeText: {
        fontSize: 10,
        letterSpacing: 1,
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
    subtitleOriginal: {
        fontSize: 11,
        color: '#7ab8c7',
        fontStyle: 'italic',
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
