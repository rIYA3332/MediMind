import React from 'react';
import { View, Text, TextInput, StyleSheet, TextStyle, ViewStyle } from 'react-native';
import { colors } from '../styles/colors';

interface InputProps {
  label?: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  style?: ViewStyle | TextStyle;
  multiline?: boolean;
  keyboardType?: 'default' | 'numeric' | 'email-address' | 'phone-pad';
  secureTextEntry?: boolean;
}

const Input: React.FC<InputProps> = ({
  label,
  value,
  onChangeText,
  placeholder,
  style,
  multiline = false,
  keyboardType = 'default',
  secureTextEntry = false,
}) => {
  return (
    <View style={styles.container}>
      {label && <Text style={styles.label}>{label}</Text>}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        style={[styles.input, multiline && styles.multiline, style]}
        multiline={multiline}
        keyboardType={keyboardType}
        secureTextEntry={secureTextEntry}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: 15,
  },
  label: {
    fontSize: 11,
    color: colors.textSecondary,
    marginBottom: 5,
    fontWeight: '600',
  },
  input: {
    height: 40,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: 6,
    paddingHorizontal: 10,
    fontSize: 12,
    backgroundColor: colors.cardBg,
  },
  multiline: {
    height: 80,
    textAlignVertical: 'top',
    paddingTop: 10,
  },
});

export default Input;
