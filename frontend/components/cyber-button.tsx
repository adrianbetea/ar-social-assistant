import { Pressable, StyleSheet, Text, View } from 'react-native';

type CyberButtonProps = {
  label: string;
  onPress: () => void;
};

export function CyberButton({ label, onPress }: CyberButtonProps) {
  return (
    <Pressable style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]} onPress={onPress}>
      <View pointerEvents="none" style={styles.buttonFrame} />
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 54,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(2, 15, 25, 0.85)',
    borderWidth: 1,
    borderColor: '#2ce4ff',
    borderRadius: 12,
    overflow: 'hidden',
  },
  buttonPressed: {
    transform: [{ scale: 0.98 }],
    opacity: 0.88,
  },
  buttonFrame: {
    position: 'absolute',
    inset: 4,
    borderWidth: 1,
    borderColor: 'rgba(44, 228, 255, 0.3)',
    borderRadius: 8,
  },
  label: {
    color: '#d8f8ff',
    letterSpacing: 1,
    fontSize: 14,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
});
