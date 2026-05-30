import { useEffect, useState } from 'react';
import { Platform, Pressable, SafeAreaView, StyleSheet, View } from 'react-native';
import * as THREE from 'three';
import { ARButton } from 'three/examples/jsm/webxr/ARButton';

import { NeonText } from '@/components/neon-text';

type FaceCenter = {
    x: number;
    y: number;
    width: number;
    height: number;
};

function createLabelSprite(text: string) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        return new THREE.Sprite();
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(8, 24, 36, 0.8)';
    ctx.strokeStyle = 'rgba(111, 246, 255, 0.6)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(12, 12, canvas.width - 24, canvas.height - 24, 20);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#e9fbff';
    ctx.font = '28px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(0.45, 0.22, 1);
    return sprite;
}

export default function WebXrArScreen() {
    const [status, setStatus] = useState<'IDLE' | 'STARTING' | 'RUNNING' | 'ERROR'>('IDLE');
    const [xrSupported, setXrSupported] = useState<boolean | null>(null);

    useEffect(() => {
        if (Platform.OS !== 'web') {
            return undefined;
        }

        let mounted = true;
        let renderer: THREE.WebGLRenderer | null = null;
        let scene: THREE.Scene | null = null;
        let camera: THREE.PerspectiveCamera | null = null;
        let label: THREE.Sprite | null = null;
        let latestFace: FaceCenter | null = null;
        let stream: MediaStream | null = null;
        let video: HTMLVideoElement | null = null;
        let videoTexture: THREE.VideoTexture | null = null;
        let backgroundMesh: THREE.Mesh | null = null;
        let detector: any | null = null;
        let detectTimer: number | null = null;
        let runningWebXr = false;

        const container = document.createElement('div');
        container.style.position = 'fixed';
        container.style.left = '0';
        container.style.top = '0';
        container.style.width = '100%';
        container.style.height = '100%';
        container.style.zIndex = '1';
        document.body.appendChild(container);

        const setupThree = () => {
            scene = new THREE.Scene();
            camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 30);
            renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
            renderer.setSize(window.innerWidth, window.innerHeight);
            renderer.xr.enabled = true;
            container.appendChild(renderer.domElement);

            label = createLabelSprite('Emotion: Neutral');
            label.visible = false;
            scene.add(label);

            const light = new THREE.HemisphereLight(0xffffff, 0x080820, 1.2);
            scene.add(light);

            const setupArButton = async () => {
                if (!navigator.xr || !renderer) {
                    setXrSupported(false);
                    return;
                }

                try {
                    const supported = await navigator.xr.isSessionSupported('immersive-ar');
                    setXrSupported(supported);
                    if (!supported) {
                        return;
                    }

                    const button = ARButton.createButton(renderer, { requiredFeatures: [] });
                    button.style.position = 'absolute';
                    button.style.right = '16px';
                    button.style.bottom = '16px';
                    button.style.zIndex = '2';
                    container.appendChild(button);

                    renderer.xr.addEventListener('sessionstart', () => {
                        runningWebXr = true;
                        if (backgroundMesh) {
                            scene?.remove(backgroundMesh);
                        }
                    });
                    renderer.xr.addEventListener('sessionend', () => {
                        runningWebXr = false;
                        if (backgroundMesh && scene) {
                            scene.add(backgroundMesh);
                        }
                    });
                } catch (error) {
                    setXrSupported(false);
                }
            };

            setupArButton();

            const onResize = () => {
                if (!renderer || !camera) return;
                camera.aspect = window.innerWidth / window.innerHeight;
                camera.updateProjectionMatrix();
                renderer.setSize(window.innerWidth, window.innerHeight);
            };
            window.addEventListener('resize', onResize);

            renderer.setAnimationLoop(() => {
                if (!renderer || !scene || !camera || !label) return;

                if (latestFace) {
                    const cx = (latestFace.x + latestFace.width / 2) / window.innerWidth;
                    const cy = (latestFace.y + latestFace.height / 2) / window.innerHeight;
                    const ndcX = cx * 2 - 1;
                    const ndcY = -(cy * 2 - 1);
                    const vector = new THREE.Vector3(ndcX, ndcY, -1).unproject(camera);
                    const direction = vector.sub(camera.position).normalize();
                    const distance = runningWebXr ? 1.2 : 1.0;
                    label.position.copy(camera.position).add(direction.multiplyScalar(distance));
                    label.visible = true;
                } else {
                    label.visible = false;
                }

                renderer.render(scene, camera);
            });

            return () => {
                window.removeEventListener('resize', onResize);
            };
        };

        const setupVideoAndDetector = async () => {
            try {
                setStatus('STARTING');
                stream = await navigator.mediaDevices.getUserMedia({
                    video: {
                        facingMode: 'user',
                        width: { ideal: 1280 },
                        height: { ideal: 720 },
                    },
                    audio: false,
                });

                video = document.createElement('video');
                video.autoplay = true;
                video.muted = true;
                video.playsInline = true;
                video.srcObject = stream;
                await video.play();

                if (scene && renderer) {
                    videoTexture = new THREE.VideoTexture(video);
                    videoTexture.minFilter = THREE.LinearFilter;
                    const geometry = new THREE.PlaneGeometry(2, 2);
                    const material = new THREE.MeshBasicMaterial({ map: videoTexture });
                    backgroundMesh = new THREE.Mesh(geometry, material);
                    backgroundMesh.position.z = -1.5;
                    scene.add(backgroundMesh);

                    if (camera) {
                        camera.position.set(0, 0, 0.1);
                    }
                }

                const tf = await import('@tensorflow/tfjs-core');
                await import('@tensorflow/tfjs-backend-webgl');
                const faceDetection = await import('@tensorflow-models/face-detection');

                await tf.setBackend('webgl');
                await tf.ready();

                detector = await faceDetection.createDetector(
                    faceDetection.SupportedModels.MediaPipeFaceDetector,
                    { runtime: 'tfjs', maxFaces: 3, modelType: 'full' }
                );

                const runDetection = async () => {
                    if (!mounted || !detector || !video) return;

                    try {
                        const faces = await detector.estimateFaces(video, { flipHorizontal: false });
                        if (Array.isArray(faces) && faces.length > 0) {
                            const det = faces[0];
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

                            const vidWidth = video.videoWidth || window.innerWidth;
                            const vidHeight = video.videoHeight || window.innerHeight;
                            const scaleX = window.innerWidth / vidWidth;
                            const scaleY = window.innerHeight / vidHeight;

                            latestFace = {
                                x: xMin * scaleX,
                                y: yMin * scaleY,
                                width: Math.max(60, (xMax - xMin) * scaleX),
                                height: Math.max(60, (yMax - yMin) * scaleY),
                            };
                        } else {
                            latestFace = null;
                        }
                    } catch (error) {
                        latestFace = null;
                    }

                    detectTimer = window.setTimeout(runDetection, 600);
                };

                runDetection();
                setStatus('RUNNING');
            } catch (error) {
                setStatus('ERROR');
            }
        };

        const teardownThree = setupThree();
        setupVideoAndDetector();

        return () => {
            mounted = false;
            if (detectTimer) {
                window.clearTimeout(detectTimer);
            }
            if (detector?.dispose) {
                detector.dispose();
            }
            if (video) {
                video.pause();
                video.srcObject = null;
            }
            if (videoTexture) {
                videoTexture.dispose();
            }
            if (backgroundMesh) {
                if (scene) {
                    scene.remove(backgroundMesh);
                }
                backgroundMesh.geometry.dispose();
                if (Array.isArray(backgroundMesh.material)) {
                    backgroundMesh.material.forEach((mat) => mat.dispose());
                } else {
                    backgroundMesh.material.dispose();
                }
            }
            if (stream) {
                stream.getTracks().forEach((track) => track.stop());
            }
            if (renderer) {
                renderer.setAnimationLoop(null);
                renderer.dispose();
            }
            if (container.parentNode) {
                container.parentNode.removeChild(container);
            }
            if (teardownThree) {
                teardownThree();
            }
        };
    }, []);

    if (Platform.OS !== 'web') {
        return (
            <SafeAreaView style={styles.safeArea}>
                <View style={styles.centerCard}>
                    <NeonText style={styles.title}>WebXR AR</NeonText>
                    <NeonText style={styles.copy}>
                        This demo only runs in a WebXR-capable browser.
                    </NeonText>
                </View>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={styles.safeArea}>
            <View style={styles.overlay}>
                <NeonText style={styles.title}>WebXR Face Label</NeonText>
                <NeonText style={styles.copy}>
                    Status: {status} | WebXR: {xrSupported === null ? 'Checking' : xrSupported ? 'Supported' : 'Unsupported'}
                </NeonText>
                <Pressable
                    style={styles.helpButton}
                    onPress={() => window.alert('Tap the AR button to enter camera AR mode. Face labels follow detected faces.')}
                >
                    <NeonText style={styles.helpText}>How to use</NeonText>
                </Pressable>
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    safeArea: {
        flex: 1,
        backgroundColor: '#02070f',
    },
    overlay: {
        position: 'absolute',
        top: 24,
        left: 18,
        right: 18,
        zIndex: 3,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: 'rgba(76, 231, 255, 0.35)',
        backgroundColor: 'rgba(4, 22, 34, 0.86)',
        padding: 12,
        gap: 8,
    },
    title: {
        fontSize: 14,
        textTransform: 'uppercase',
        letterSpacing: 1.4,
        color: '#e4fbff',
    },
    copy: {
        fontSize: 12,
        color: '#9dd3df',
        textShadowColor: 'transparent',
    },
    helpButton: {
        alignSelf: 'flex-start',
        borderRadius: 999,
        borderWidth: 1,
        borderColor: 'rgba(111, 246, 255, 0.6)',
        backgroundColor: 'rgba(7, 32, 48, 0.9)',
        paddingVertical: 6,
        paddingHorizontal: 14,
    },
    helpText: {
        fontSize: 11,
        letterSpacing: 1.1,
        color: '#d8fbff',
    },
    centerCard: {
        margin: 24,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: 'rgba(76, 231, 255, 0.35)',
        backgroundColor: 'rgba(4, 22, 34, 0.86)',
        padding: 18,
        gap: 10,
    },
});
