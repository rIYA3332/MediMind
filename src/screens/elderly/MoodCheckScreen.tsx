// screens/elder/MoodCheckScreen.tsx
// Elder mood check-in with instant AI sentiment feedback
import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Alert, ScrollView, ActivityIndicator, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApiUrl } from '../../config/api';
import Input from '../../components/Input';
import Card from '../../components/Card';
import { colors } from '../../styles/colors';

const MOODS = [
  { id: 'happy',   emoji: '😊', label: 'Happy',   color: '#00b894' },
  { id: 'neutral', emoji: '😐', label: 'Neutral',  color: '#74b9ff' },
  { id: 'sad',     emoji: '😢', label: 'Sad',      color: '#636e72' },
  { id: 'anxious', emoji: '😰', label: 'Anxious',  color: '#fdcb6e' },
  { id: 'tired',   emoji: '😴', label: 'Tired',    color: '#a29bfe' },
  { id: 'lonely',  emoji: '🪑', label: 'Lonely',   color: '#fd79a8' },
];

const SENTIMENT_TIPS: Record<string, string> = {
  happy:   "Sharing what made you happy today helps your caregiver understand what uplifts you.",
  neutral: "Even on ordinary days, a few words help your caregiver know you're doing okay.",
  sad:     "It's okay to feel sad. Writing a little about it helps your caregiver support you better.",
  anxious: "Describing what's worrying you helps your caregiver find ways to ease your concerns.",
  tired:   "Let your caregiver know if tiredness is affecting your day — they can help.",
  lonely:  "Your feelings matter. Sharing them may lead to a welcome visit or phone call.",
};

interface SentimentFeedback {
  label: string;
  emoji: string;
  score: number;
  should_alert: boolean;
}

interface MoodLog {
  id: number;
  mood: string;
  notes: string | null;
  sentiment_label: string | null;
  concern_score: number | null;
  sentiment_color: string | null;
  logged_at: string;
}

const MoodCheckScreen = () => {
  const [selectedMood, setSelectedMood]     = useState('');
  const [notes, setNotes]                   = useState('');
  const [userId, setUserId]                 = useState<number | null>(null);
  const [weekMood, setWeekMood]             = useState<MoodLog[]>([]);
  const [submitting, setSubmitting]         = useState(false);
  const [feedback, setFeedback]             = useState<SentimentFeedback | null>(null);
  const [feedbackAnim]                      = useState(new Animated.Value(0));

  useEffect(() => { loadUser(); }, []);

  const loadUser = async () => {
    try {
      const raw = await AsyncStorage.getItem('user');
      if (raw) {
        const u = JSON.parse(raw);
        setUserId(u.id);
        fetchWeekMood(u.id);
      }
    } catch (e) { console.log('loadUser error:', e); }
  };

  const fetchWeekMood = async (id: number) => {
    try {
      const res  = await fetch(getApiUrl(`/api/mood/history/${id}?limit=7`));
      const data = await res.json();
      setWeekMood(Array.isArray(data) ? data : []);
    } catch (e) { console.log('fetchWeekMood error:', e); }
  };

  const showFeedbackCard = (s: SentimentFeedback) => {
    setFeedback(s);
    Animated.spring(feedbackAnim, {
      toValue: 1, useNativeDriver: true,
      tension: 60, friction: 8,
    }).start();
  };

  const handleSubmit = async () => {
    if (!selectedMood) {
      Alert.alert('Please select your mood first.');
      return;
    }
    setSubmitting(true);
    setFeedback(null);
    feedbackAnim.setValue(0);

    try {
      const res = await fetch(getApiUrl('/api/mood'), {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          mood:  selectedMood,
          notes: notes.trim(),
        }),
      });
      const data = await res.json();

      if (res.ok) {
        if (data.sentiment) {
          showFeedbackCard(data.sentiment);
        }
        setSelectedMood('');
        setNotes('');
        fetchWeekMood(userId!);
      } else {
        Alert.alert('Error', data.message || 'Failed to record mood');
      }
    } catch (e) {
      Alert.alert('Error', 'Failed to submit. Please check your connection.');
    } finally {
      setSubmitting(false);
    }
  };

  const getSentimentColor = (label: string | null) => {
    switch (label) {
      case 'POSITIVE':   return '#00b894';
      case 'NEUTRAL':    return '#74b9ff';
      case 'CONCERNING': return '#fdcb6e';
      case 'CRITICAL':   return '#ff4757';
      default:           return colors.textSecondary;
    }
  };

  const getSentimentEmoji = (label: string | null) => {
    switch (label) {
      case 'POSITIVE':   return '😊';
      case 'NEUTRAL':    return '😐';
      case 'CONCERNING': return '⚠️';
      case 'CRITICAL':   return '🚨';
      default:           return '•';
    }
  };

  const formatTimeAgo = (iso: string) => {
    const diff  = Date.now() - new Date(iso).getTime();
    const mins  = Math.floor(diff / 60000);
    const hours = Math.floor(mins / 60);
    const days  = Math.floor(hours / 24);
    if (mins < 1)   return 'Just now';
    if (mins < 60)  return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
  };

  const isSubmitDisabled = submitting || !selectedMood;
  const moodObj = MOODS.find(m => m.id === selectedMood);

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>How are you feeling?</Text>
        <Text style={styles.headerSub}>Your check-in helps your caregiver look after you</Text>
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>

        {/* Mood Grid */}
        <Card style={styles.moodCard}>
          <View style={styles.moodGrid}>
            {MOODS.map(m => (
              <TouchableOpacity
                key={m.id}
                style={[
                  styles.moodBtn,
                  selectedMood === m.id && { borderColor: m.color, backgroundColor: m.color + '18' },
                ]}
                onPress={() => setSelectedMood(m.id)}
                activeOpacity={0.7}
              >
                <Text style={styles.moodEmoji}>{m.emoji}</Text>
                <Text style={[
                  styles.moodLabel,
                  selectedMood === m.id && { color: m.color, fontWeight: '700' },
                ]}>
                  {m.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Writing prompt */}
          {selectedMood && (
            <View style={[styles.promptBox, { borderLeftColor: moodObj?.color }]}>
              <Text style={styles.promptText}>
                💬 {SENTIMENT_TIPS[selectedMood]}
              </Text>
            </View>
          )}

          <Input
            label="Tell us more (Optional)"
            value={notes}
            onChangeText={setNotes}
            placeholder={selectedMood === 'sad'
              ? "e.g. Missing my children today..."
              : selectedMood === 'anxious'
              ? "e.g. Worried about my appointment..."
              : "Share what's on your mind..."}
            multiline
          />

          {/* ── Submit button — uses TouchableOpacity directly to avoid
              Button component's missing `disabled` prop type ── */}
          <TouchableOpacity
            style={[styles.submitBtn, isSubmitDisabled && styles.submitBtnDisabled]}
            onPress={handleSubmit}
            activeOpacity={0.8}
            disabled={isSubmitDisabled}
          >
            {submitting ? (
              <View style={styles.submittingRow}>
                <ActivityIndicator size="small" color="#fff" />
                <Text style={styles.submitBtnTxt}>Saving...</Text>
              </View>
            ) : (
              <Text style={styles.submitBtnTxt}>SUBMIT CHECK-IN</Text>
            )}
          </TouchableOpacity>
        </Card>

        {/* AI Feedback Card (appears after submission) */}
        {feedback && (
          <Animated.View style={[
            styles.feedbackCard,
            {
              borderColor: getSentimentColor(feedback.label),
              transform: [{ scale: feedbackAnim }],
              opacity: feedbackAnim,
            },
          ]}>
            <Text style={styles.feedbackTitle}>✓ Mood Recorded</Text>
            <View style={styles.feedbackRow}>
              <Text style={styles.feedbackEmoji}>{feedback.emoji}</Text>
              <View style={styles.feedbackInfo}>
                <Text style={[styles.feedbackLabel, { color: getSentimentColor(feedback.label) }]}>
                  {feedback.label}
                </Text>
                <Text style={styles.feedbackScore}>
                  Concern score: {feedback.score}/100
                </Text>
              </View>
            </View>
            {feedback.should_alert ? (
              <Text style={styles.feedbackAlertNote}>
                📱 Your caregiver has been notified.
              </Text>
            ) : (
              <Text style={styles.feedbackOkNote}>
                Your caregiver can see this check-in anytime.
              </Text>
            )}
          </Animated.View>
        )}

        {/* Recent Check-ins */}
        <Text style={styles.sectionTitle}>Recent Check-ins</Text>
        <Card>
          {weekMood.length === 0 ? (
            <Text style={styles.emptyText}>No mood data yet. Submit your first check-in!</Text>
          ) : (
            weekMood.map((log, i) => {
              const m       = MOODS.find(x => x.id === log.mood);
              const sentClr = log.sentiment_color || getSentimentColor(log.sentiment_label);
              return (
                <View key={log.id} style={[
                  styles.logRow,
                  i < weekMood.length - 1 && styles.logRowBorder,
                ]}>
                  <Text style={styles.logEmoji}>{m?.emoji || '😐'}</Text>
                  <View style={styles.logInfo}>
                    <Text style={styles.logMood}>{m?.label || log.mood}</Text>
                    {log.notes ? (
                      <Text style={styles.logNotes} numberOfLines={1}>
                        "{log.notes}"
                      </Text>
                    ) : null}
                    <Text style={styles.logTime}>{formatTimeAgo(log.logged_at)}</Text>
                  </View>
                  {log.sentiment_label && (
                    <View style={[styles.sentBadge, { borderColor: sentClr, backgroundColor: sentClr + '18' }]}>
                      <Text style={[styles.sentBadgeTxt, { color: sentClr }]}>
                        {getSentimentEmoji(log.sentiment_label)} {log.sentiment_label}
                      </Text>
                    </View>
                  )}
                </View>
              );
            })
          )}
        </Card>

        <View style={{ height: 30 }} />
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container:      { flex: 1, backgroundColor: colors.background },
  header: {
    padding: 20, backgroundColor: colors.white,
    borderBottomWidth: 1, borderBottomColor: colors.border,
    alignItems: 'center',
  },
  headerTitle:    { fontSize: 22, fontWeight: 'bold', color: colors.textPrimary, marginBottom: 4 },
  headerSub:      { fontSize: 13, color: colors.textSecondary, textAlign: 'center' },
  content:        { flex: 1, padding: 15 },
  moodCard:       { marginBottom: 12 },
  moodGrid: {
    flexDirection: 'row', flexWrap: 'wrap',
    justifyContent: 'space-between', marginBottom: 16, gap: 10,
  },
  moodBtn: {
    width: '30%', aspectRatio: 1,
    backgroundColor: colors.white, borderRadius: 15,
    borderWidth: 2, borderColor: colors.border,
    justifyContent: 'center', alignItems: 'center', padding: 8,
  },
  moodEmoji:      { fontSize: 36, marginBottom: 6 },
  moodLabel:      { fontSize: 12, fontWeight: '600', color: colors.textPrimary, textAlign: 'center' },
  promptBox: {
    borderLeftWidth: 4, borderRadius: 8,
    backgroundColor: '#f8f9ff', padding: 12, marginBottom: 14,
  },
  promptText:     { fontSize: 13, color: colors.textSecondary, lineHeight: 19, fontStyle: 'italic' },

  // ── Submit button (replaces Button component) ──────────────────────────────
  submitBtn: {
    backgroundColor: colors.primary, borderRadius: 12,
    paddingVertical: 14, alignItems: 'center', marginTop: 6,
  },
  submitBtnDisabled: { backgroundColor: colors.border, opacity: 0.6 },
  submitBtnTxt:  { color: '#fff', fontWeight: '700', fontSize: 14, letterSpacing: 0.5 },
  submittingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },

  feedbackCard: {
    borderWidth: 2, borderRadius: 16, padding: 16,
    backgroundColor: colors.white, marginBottom: 14,
    shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 8, elevation: 3,
  },
  feedbackTitle:     { fontSize: 12, fontWeight: '700', color: '#00b894', marginBottom: 10, textTransform: 'uppercase' },
  feedbackRow:       { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  feedbackEmoji:     { fontSize: 40, marginRight: 14 },
  feedbackInfo:      { flex: 1 },
  feedbackLabel:     { fontSize: 16, fontWeight: '800' },
  feedbackScore:     { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  feedbackAlertNote: { fontSize: 12, color: '#e17055', fontWeight: '600', marginTop: 4 },
  feedbackOkNote:    { fontSize: 12, color: colors.textSecondary, marginTop: 4 },

  sectionTitle:   { fontSize: 16, fontWeight: 'bold', color: colors.textPrimary, marginTop: 8, marginBottom: 10 },
  emptyText:      { textAlign: 'center', color: colors.textSecondary, fontSize: 14, paddingVertical: 20 },

  logRow:       { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  logRowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  logEmoji:     { fontSize: 28, marginRight: 12 },
  logInfo:      { flex: 1 },
  logMood:      { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  logNotes:     { fontSize: 12, color: colors.textSecondary, marginTop: 2, fontStyle: 'italic' },
  logTime:      { fontSize: 11, color: colors.textSecondary, marginTop: 3 },
  sentBadge: {
    borderWidth: 1.5, borderRadius: 20,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  sentBadgeTxt: { fontSize: 10, fontWeight: '700' },
});

export default MoodCheckScreen;