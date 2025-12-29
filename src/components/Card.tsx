import React, { ReactNode } from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { colors } from '../styles/colors';

interface CardProps {
  title?: string;
  children: ReactNode;
  style?: ViewStyle | ViewStyle[];
  highlight?: boolean;
}

const Card: React.FC<CardProps> = ({ title, children, style, highlight = false }) => {
  return (
    <View style={[styles.card, highlight && styles.cardHighlight, style]}>
      {title && <Text style={styles.cardTitle}>{title}</Text>}
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: colors.border,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardHighlight: {
    backgroundColor: '#fff3e0',
    borderColor: '#ff9800',
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: 'bold',
    color: colors.textPrimary,
    marginBottom: 6,
  },
});

export default Card;
