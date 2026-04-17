import { PropsWithChildren } from 'react';
import { StyleProp, StyleSheet, Text, TextStyle } from 'react-native';

type NeonTextProps = PropsWithChildren<{
  style?: StyleProp<TextStyle>;
}>;

export function NeonText({ children, style }: NeonTextProps) {
  return <Text style={[styles.text, style]}>{children}</Text>;
}

const styles = StyleSheet.create({
  text: {
    color: '#8df5ff',
    textShadowColor: 'rgba(55, 230, 255, 0.9)',
    textShadowRadius: 10,
    textShadowOffset: { width: 0, height: 0 },
  },
});
