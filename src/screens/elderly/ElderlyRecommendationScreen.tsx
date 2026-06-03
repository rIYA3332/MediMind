// screens/elderly/ElderlyRecommendationScreen.tsx
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, ActivityIndicator, RefreshControl, StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApiUrl } from '../../config/api';
import { colors } from '../../styles/colors';

interface Vitals { bp: string; sugar: string; hr: string; temp: string; }
interface Patient { age: number; gender: string; weight: string; conditions: string; vitals: Vitals; }
interface CarePlan { diet: string; exercise: string; caution: string; care_plan: string; patient: Patient; }

const VitalBadge = ({ label, value, icon }: { label: string; value: string; icon: string }) => (
  <View style={styles.vitalBadge}>
    <Text style={styles.vitalIcon}>{icon}</Text>
    <Text style={styles.vitalValue}>{value}</Text>
    <Text style={styles.vitalLabel}>{label}</Text>
  </View>
);

const PlanSection = ({ icon, title, content, accent }: {
  icon: string; title: string; content: string; accent: string;
}) => (
  <View style={[styles.planCard, { borderLeftColor: accent }]}>
    <View style={styles.planCardHeader}>
      <Text style={styles.planCardIcon}>{icon}</Text>
      <Text style={[styles.planCardTitle, { color: accent }]}>{title}</Text>
    </View>
    <Text style={styles.planCardContent}>{content}</Text>
  </View>
);

export default function ElderlyRecommendationScreen() {
  const [user, setUser]             = useState<any>(null);
  const [plan, setPlan]             = useState<CarePlan | null>(null);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);

  // Load user from storage once
  useEffect(() => {
    AsyncStorage.getItem('user').then(stored => {
      if (stored) setUser(JSON.parse(stored));
      else setLoading(false);
    });
  }, []);

  const fetchPlan = useCallback(async (isRefresh = false) => {
    if (!user?.id) return;
    if (isRefresh) setRefreshing(true);
    else { setLoading(true); setError(null); }

    try {
      const res = await fetch(getApiUrl('/api/careplan/generate'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ elderId: user.id }),   // ← elder's own id
      });
      const data = await res.json();
      if (data.success) {
        setPlan(data);
        setGeneratedAt(new Date().toLocaleString());
      } else {
        setError(data.message || 'Failed to generate recommendations');
      }
    } catch {
      setError('Could not connect to server.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  // Fetch once user is loaded
  useEffect(() => { if (user) fetchPlan(); }, [user]);

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>My Recommendations</Text>
        </View>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Generating your care plan...</Text>
          <Text style={styles.loadingSubtext}>AI is analysing your vitals and conditions</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>My Recommendations</Text>
          <TouchableOpacity onPress={() => fetchPlan(true)} style={styles.refreshBtn}>
            <Text style={styles.refreshBtnText}>↻</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.centered}>
          <Text style={{ fontSize: 48, marginBottom: 12 }}>⚠️</Text>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => fetchPlan()}>
            <Text style={styles.retryBtnText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Main ───────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor={colors.primary} />

      <View style={styles.header}>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>My Recommendations</Text>
          <Text style={styles.headerSubtitle}>Personalised AI care plan</Text>
        </View>
        <TouchableOpacity onPress={() => fetchPlan(true)} style={styles.refreshBtn}>
          <Text style={styles.refreshBtnText}>↻</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => fetchPlan(true)} colors={[colors.primary]} />
        }
      >
        {plan && (
          <>
            {/* Patient profile card */}
            <View style={styles.profileCard}>
              <View style={styles.profileCardTop}>
                <View style={styles.avatarCircle}>
                  <Text style={styles.avatarText}>
                    {user?.name?.charAt(0).toUpperCase() ?? '?'}
                  </Text>
                </View>
                <View style={styles.profileInfo}>
                  <Text style={styles.profileName}>{user?.name}</Text>
                  <Text style={styles.profileMeta}>
                    {plan.patient.age} yrs • {plan.patient.gender} • {plan.patient.weight}
                  </Text>
                  {plan.patient.conditions ? (
                    <Text style={styles.profileConditions} numberOfLines={2}>
                      🏥 {plan.patient.conditions}
                    </Text>
                  ) : null}
                </View>
              </View>

              <Text style={styles.vitalsHeading}>Your Latest Vitals</Text>
              <View style={styles.vitalsRow}>
                <VitalBadge label="BP"    value={plan.patient.vitals.bp}               icon="🩺" />
                <VitalBadge label="Sugar" value={`${plan.patient.vitals.sugar} mg/dL`} icon="🩸" />
                <VitalBadge label="HR"    value={`${plan.patient.vitals.hr} bpm`}       icon="❤️" />
                <VitalBadge label="Temp"  value={`${plan.patient.vitals.temp}°F`}       icon="🌡️" />
              </View>

              {generatedAt && (
                <Text style={styles.generatedAt}>Generated: {generatedAt}</Text>
              )}
            </View>

            {/* Plan sections — identical accent colours to caregiver screen */}
            {plan.diet ? (
              <PlanSection icon="🥗" title="Diet Recommendations" content={plan.diet}     accent="#27ae60" />
            ) : null}
            {plan.exercise ? (
              <PlanSection icon="🏃" title="Exercise Plan"         content={plan.exercise} accent="#2980b9" />
            ) : null}
            {plan.caution ? (
              <PlanSection icon="⚠️" title="Health Cautions"       content={plan.caution}  accent="#e67e22" />
            ) : null}

            <TouchableOpacity style={styles.regenerateBtn} onPress={() => fetchPlan()}>
              <Text style={styles.regenerateBtnText}>↻  Regenerate Plan</Text>
            </TouchableOpacity>

            <View style={styles.disclaimer}>
              <Text style={styles.disclaimerText}>
                ⓘ This AI-generated care plan is based on your health data.
                Always verify recommendations with a qualified medical professional.
              </Text>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea:   { flex: 1, backgroundColor: colors.primary },
  scroll:     { flex: 1, backgroundColor: '#f0f4f8' },
  centered:   { flex: 1, backgroundColor: '#f0f4f8', justifyContent: 'center', alignItems: 'center', padding: 24 },

  header:       { backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, paddingTop: 18 },
  headerCenter: { flex: 1 },
  headerTitle:  { fontSize: 17, fontWeight: '700', color: '#fff' },
  headerSubtitle:{ fontSize: 12, color: 'rgba(255,255,255,0.8)', marginTop: 2 },
  refreshBtn:   { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center' },
  refreshBtnText:{ fontSize: 20, color: '#fff', fontWeight: '700' },

  loadingText:    { marginTop: 16, fontSize: 16, color: '#2c3e50', fontWeight: '600', textAlign: 'center' },
  loadingSubtext: { marginTop: 6,  fontSize: 13, color: '#888', textAlign: 'center' },
  errorText:      { fontSize: 14, color: '#e74c3c', textAlign: 'center', marginBottom: 20 },
  retryBtn:       { backgroundColor: colors.primary, paddingHorizontal: 28, paddingVertical: 12, borderRadius: 8 },
  retryBtnText:   { color: '#fff', fontWeight: '700', fontSize: 15 },

  profileCard:    { backgroundColor: '#fff', margin: 16, borderRadius: 14, padding: 16, shadowColor: '#000', shadowOpacity: 0.07, shadowRadius: 8, elevation: 3 },
  profileCardTop: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 14 },
  avatarCircle:   { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  avatarText:     { fontSize: 22, fontWeight: '700', color: '#fff' },
  profileInfo:    { flex: 1 },
  profileName:    { fontSize: 17, fontWeight: '700', color: '#2c3e50' },
  profileMeta:    { fontSize: 13, color: '#666', marginTop: 2, textTransform: 'capitalize' },
  profileConditions:{ fontSize: 12, color: colors.primary, marginTop: 4, fontStyle: 'italic' },

  vitalsHeading:  { fontSize: 11, color: '#888', fontWeight: '600', textTransform: 'uppercase', marginBottom: 8, letterSpacing: 0.5 },
  vitalsRow:      { flexDirection: 'row', justifyContent: 'space-between' },
  vitalBadge:     { flex: 1, backgroundColor: '#f8f9fa', borderRadius: 10, padding: 8, marginHorizontal: 2, alignItems: 'center' },
  vitalIcon:      { fontSize: 16, marginBottom: 2 },
  vitalValue:     { fontSize: 11, fontWeight: '700', color: '#2c3e50' },
  vitalLabel:     { fontSize: 9,  color: '#888', marginTop: 1 },
  generatedAt:    { fontSize: 10, color: '#aaa', textAlign: 'right', marginTop: 10 },

  planCard:       { backgroundColor: '#fff', marginHorizontal: 16, marginBottom: 12, borderRadius: 12, padding: 16, borderLeftWidth: 4, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  planCardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  planCardIcon:   { fontSize: 20, marginRight: 8 },
  planCardTitle:  { fontSize: 15, fontWeight: '700' },
  planCardContent:{ fontSize: 14, color: '#444', lineHeight: 22 },

  regenerateBtn:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', borderWidth: 1.5, borderColor: colors.primary, marginHorizontal: 16, marginBottom: 12, borderRadius: 10, padding: 13 },
  regenerateBtnText: { color: colors.primary, fontWeight: '700', fontSize: 14 },

  disclaimer:     { marginHorizontal: 16, marginBottom: 32, padding: 12, backgroundColor: '#fff9e6', borderRadius: 8 },
  disclaimerText: { fontSize: 11, color: '#856404', lineHeight: 17, textAlign: 'center' },
});