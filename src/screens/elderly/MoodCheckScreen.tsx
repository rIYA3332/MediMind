import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApiUrl } from '../../config/api';
import Input from '../../components/Input';
import Button from '../../components/Button';
import Card from '../../components/Card';
import { colors } from '../../styles/colors';

const moods = [
  { id: 'happy', emoji: '😊', label: 'Happy' },
  { id: 'neutral', emoji: '😐', label: 'Neutral' },
  { id: 'sad', emoji: '😢', label: 'Sad' },
  { id: 'anxious', emoji: '😰', label: 'Anxious' },
  { id: 'tired', emoji: '😴', label: 'Tired' },
  { id: 'lonely', emoji: '🪑', label: 'Lonely' },
];

const MoodCheckScreen = () => {
  const [selectedMood, setSelectedMood] = useState('');
  const [notes, setNotes] = useState('');
  const [userId, setUserId] = useState<number | null>(null);
  const [weekMood, setWeekMood] = useState<any[]>([]);

  useEffect(() => {
    loadUser();
  }, []);

  const loadUser = async () => {
    const user = await AsyncStorage.getItem('user');
    if (user) {
      const userData = JSON.parse(user);
      setUserId(userData.id);
      fetchWeekMood(userData.id);
    }
  };

  const fetchWeekMood = async (id: number) => {
    try {
      const res = await fetch(getApiUrl(`/api/mood/${id}`));
      const data = await res.json();
      setWeekMood(data.slice(0, 7));
    } catch (e) {
      console.log('Error fetching mood:', e);
    }
  };

  const handleSubmit = async () => {
    if (!selectedMood) {
      Alert.alert('Error', 'Please select your mood');
      return;
    }

    try {
      const res = await fetch(getApiUrl('/api/mood'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          mood: selectedMood,
          notes: notes.trim(),
        }),
      });

      if (res.ok) {
        Alert.alert('✓ Success', 'Mood recorded!');
        setSelectedMood('');
        setNotes('');
        fetchWeekMood(userId!);
      }
    } catch (e) {
      Alert.alert('Error', 'Failed to record mood');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>How are you feeling?</Text>
        <Text style={styles.subtitle}>Select your mood today</Text>
      </View>

      <ScrollView style={styles.content}>
        <Card>
          <View style={styles.moodGrid}>
            {moods.map((mood) => (
              <TouchableOpacity
                key={mood.id}
                style={[
                  styles.moodCard,
                  selectedMood === mood.id && styles.moodCardActive,
                ]}
                onPress={() => setSelectedMood(mood.id)}
              >
                <Text style={styles.moodEmoji}>{mood.emoji}</Text>
                <Text style={[
                  styles.moodLabel,
                  selectedMood === mood.id && styles.moodLabelActive
                ]}>
                  {mood.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Input
            label="Tell us more (Optional)"
            value={notes}
            onChangeText={setNotes}
            placeholder="Missing my children..."
            multiline
          />

          <Button title="SUBMIT" onPress={handleSubmit} />
        </Card>

        <Text style={styles.sectionTitle}>This Week's Mood</Text>
        <Card>
          {weekMood.length === 0 ? (
            <Text style={styles.emptyText}>No mood data this week</Text>
          ) : (
            weekMood.map((log, index) => (
              <View key={index} style={styles.moodLogRow}>
                <Text style={styles.moodLogEmoji}>
                  {moods.find(m => m.id === log.mood)?.emoji}
                </Text>
                <View style={styles.moodLogInfo}>
                  <Text style={styles.moodLogLabel}>
                    {moods.find(m => m.id === log.mood)?.label}
                  </Text>
                  <Text style={styles.moodLogDate}>
                    {new Date(log.logged_at).toLocaleDateString()}
                  </Text>
                </View>
              </View>
            ))
          )}
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    padding: 20,
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: colors.textPrimary,
    marginBottom: 5,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  content: {
    flex: 1,
    padding: 15,
  },
  moodGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 20,
    gap: 10,
  },
  moodCard: {
    width: '30%',
    aspectRatio: 1,
    backgroundColor: colors.white,
    borderRadius: 15,
    borderWidth: 2,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 10,
  },
  moodCardActive: {
    borderColor: colors.primary,
    backgroundColor: '#e3f2fd',
  },
  moodEmoji: {
    fontSize: 40,
    marginBottom: 8,
  },
  moodLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textPrimary,
    textAlign: 'center',
  },
  moodLabelActive: {
    color: colors.primary,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.textPrimary,
    marginTop: 20,
    marginBottom: 12,
  },
  emptyText: {
    textAlign: 'center',
    color: colors.textSecondary,
    fontSize: 14,
    paddingVertical: 20,
  },
  moodLogRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  moodLogEmoji: {
    fontSize: 32,
    marginRight: 15,
  },
  moodLogInfo: {
    flex: 1,
  },
  moodLogLabel: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.textPrimary,
  },
  moodLogDate: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 4,
  },
});

export default MoodCheckScreen;