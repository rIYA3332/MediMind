import React from 'react';
import { TouchableOpacity, Text, StyleSheet, ViewStyle, TextStyle } from 'react-native';
import { colors } from '../styles/colors';

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
  style?: ViewStyle | TextStyle;
}

const Button: React.FC<ButtonProps> = ({ title, onPress, variant = 'primary', style }) => {
  return (
    <TouchableOpacity
      style={[styles.button, variant === 'secondary' && styles.buttonSecondary, style]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text style={[styles.buttonText, variant === 'secondary' && styles.buttonTextSecondary]}>
        {title}
      </Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    height: 45,
    backgroundColor: colors.primary,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: colors.primary,
  },
  buttonSecondary: {
    backgroundColor: colors.white,
    borderColor: colors.primary,
  },
  buttonText: {
    color: colors.white,
    fontSize: 13,
    fontWeight: 'bold',
  },
  buttonTextSecondary: {
    color: colors.primary,
  },
});

export default Button;
