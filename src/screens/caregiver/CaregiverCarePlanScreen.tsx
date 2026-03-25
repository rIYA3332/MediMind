import React, { useState, useEffect, useCallback } from 'react';
// NEW
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, ActivityIndicator, RefreshControl,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons as Icon } from '@expo/vector-icons';
import { getApiUrl } from '../../config/api';
import { colors } from '../../styles/colors';

interface Vitals {
  bp:    string;
  sugar: string;
  hr:    string;
  temp:  string;
}

interface Patient {
  age:        number;
  gender:     string;
  weight:     string;
  conditions: string;
  vitals:     Vitals;
}

interface CarePlan {
  diet:      string;
  exercise:  string;
  caution:   string;
  care_plan: string;
  patient:   Patient;
}

interface Props {
  route: {
    params: {
      elderId:   number;
      elderName: string;
    };
  };
  navigation: any;
}

export default function CaregiverCarePlanScreen({ route, navigation }: Props) {
  const { elderId, elderName } = route.params;

  const [plan,       setPlan]       = useState<CarePlan | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [generatedAt,setGeneratedAt]= useState<string | null>(null);

  const fetchPlan = useCallback(async (isRefresh = false) => {
  if (isRefresh) setRefreshing(true);
  else { setLoading(true); setError(null); }

  try {
    console.log('Calling careplan for elder:', elderId);
    const res = await fetch(getApiUrl('/api/careplan/generate'), {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ elderId }),
    });
    const data = await res.json();
    console.log('Careplan response:', JSON.stringify(data));

    if (data.success) {
      setPlan(data);
      setGeneratedAt(new Date().toLocaleString());
    } else {
      setError(data.message || 'Failed to generate care plan');
    }
  } catch (e) {
    setError('Could not connect to server. Make sure the care plan service is running.');
  } finally {
    setLoading(false);
    setRefreshing(false);
  }
}, [elderId]);
  // ↑↑↑ end of new fetchPlan ↑↑↑

  useEffect(() => { fetchPlan(); }, [fetchPlan]);

  // ── Sub-components ──────────────────────────────────────────────────────────
  const VitalBadge = ({ label, value, icon }: {
    label: string; value: string; icon: string;
  }) => (
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

  // ── Loading ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Icon name="arrow-back" size={22} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Care Plan</Text>
          <View style={{ width: 38 }} />
        </View>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>
            Generating care plan for {elderName}...
          </Text>
          <Text style={styles.loadingSubtext}>
            AI is analysing vitals and conditions
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── Error ───────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
            <Icon name="arrow-back" size={22} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Care Plan</Text>
          <View style={{ width: 38 }} />
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

  // ── Main view ───────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor={colors.primary} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Icon name="arrow-back" size={22} color="#fff" />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Care Plan</Text>
          <Text style={styles.headerSubtitle}>{elderName}</Text>
        </View>
        <TouchableOpacity onPress={() => fetchPlan(true)} style={styles.backBtn}>
          <Icon name="refresh" size={22} color="#fff" />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => fetchPlan(true)}
            colors={[colors.primary]}
          />
        }
      >
        {plan && (
          <>
            {/* Patient Profile Card */}
            <View style={styles.profileCard}>
              <View style={styles.profileCardTop}>
                <View style={styles.avatarCircle}>
                  <Text style={styles.avatarText}>
                    {elderName.charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View style={styles.profileInfo}>
                  <Text style={styles.profileName}>{elderName}</Text>
                  <Text style={styles.profileMeta}>
                    {plan.patient.age} yrs • {plan.patient.gender} • {plan.patient.weight}
                  </Text>
                  {plan.patient.conditions && (
                    <Text style={styles.profileConditions} numberOfLines={2}>
                      🏥 {plan.patient.conditions}
                    </Text>
                  )}
                </View>
              </View>

              {/* Vitals row */}
              <Text style={styles.vitalsHeading}>Current Vitals</Text>
              <View style={styles.vitalsRow}>
                <VitalBadge label="BP"    value={plan.patient.vitals.bp}              icon="🩺" />
                <VitalBadge label="Sugar" value={`${plan.patient.vitals.sugar} mg/dL`} icon="🩸" />
                <VitalBadge label="HR"    value={`${plan.patient.vitals.hr} bpm`}      icon="❤️" />
                <VitalBadge label="Temp"  value={`${plan.patient.vitals.temp}°F`}      icon="🌡️" />
              </View>

              {generatedAt && (
                <Text style={styles.generatedAt}>
                  Generated: {generatedAt}
                </Text>
              )}
            </View>

            {/* Plan sections */}
            {plan.diet ? (
              <PlanSection
                icon="🥗"
                title="Diet Recommendations"
                content={plan.diet}
                accent="#27ae60"
              />
            ) : null}

            {plan.exercise ? (
              <PlanSection
                icon="🏃"
                title="Exercise Plan"
                content={plan.exercise}
                accent="#2980b9"
              />
            ) : null}

            {plan.caution ? (
              <PlanSection
                icon="⚠️"
                title="Health Cautions"
                content={plan.caution}
                accent="#e67e22"
              />
            ) : null}

            {/* Regenerate button */}
            <TouchableOpacity
              style={styles.regenerateBtn}
              onPress={() => fetchPlan()}
            >
              <Icon name="refresh-circle" size={20} color={colors.primary} />
              <Text style={styles.regenerateBtnText}>Regenerate Plan</Text>
            </TouchableOpacity>

            {/* Disclaimer */}
            <View style={styles.disclaimer}>
              <Text style={styles.disclaimerText}>
                ⓘ This AI-generated care plan is based on {elderName}'s health data.
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
  safeArea:         { flex: 1, backgroundColor: colors.primary },
  scroll:           { flex: 1, backgroundColor: '#f0f4f8' },
  centered:         { flex: 1, backgroundColor: '#f0f4f8', justifyContent: 'center', alignItems: 'center', padding: 24 },

  // Header
  header:           { backgroundColor: colors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, paddingTop: 18 },
  backBtn:          { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center' },
  headerCenter:     { flex: 1, alignItems: 'center' },
  headerTitle:      { fontSize: 17, fontWeight: '700', color: '#fff' },
  headerSubtitle:   { fontSize: 12, color: 'rgba(255,255,255,0.8)', marginTop: 1 },

  // Loading / error
  loadingText:      { marginTop: 16, fontSize: 16, color: '#2c3e50', fontWeight: '600', textAlign: 'center' },
  loadingSubtext:   { marginTop: 6, fontSize: 13, color: '#888', textAlign: 'center' },
  errorText:        { fontSize: 14, color: '#e74c3c', textAlign: 'center', marginBottom: 20 },
  retryBtn:         { backgroundColor: colors.primary, paddingHorizontal: 28, paddingVertical: 12, borderRadius: 8 },
  retryBtnText:     { color: '#fff', fontWeight: '700', fontSize: 15 },

  // Profile card
  profileCard:      { backgroundColor: '#fff', margin: 16, borderRadius: 14, padding: 16, shadowColor: '#000', shadowOpacity: 0.07, shadowRadius: 8, elevation: 3 },
  profileCardTop:   { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 14 },
  avatarCircle:     { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.primary, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  avatarText:       { fontSize: 22, fontWeight: '700', color: '#fff' },
  profileInfo:      { flex: 1 },
  profileName:      { fontSize: 17, fontWeight: '700', color: '#2c3e50' },
  profileMeta:      { fontSize: 13, color: '#666', marginTop: 2, textTransform: 'capitalize' },
  profileConditions:{ fontSize: 12, color: colors.primary, marginTop: 4, fontStyle: 'italic' },

  vitalsHeading:    { fontSize: 11, color: '#888', fontWeight: '600', textTransform: 'uppercase', marginBottom: 8, letterSpacing: 0.5 },
  vitalsRow:        { flexDirection: 'row', justifyContent: 'space-between' },
  vitalBadge:       { flex: 1, backgroundColor: '#f8f9fa', borderRadius: 10, padding: 8, marginHorizontal: 2, alignItems: 'center' },
  vitalIcon:        { fontSize: 16, marginBottom: 2 },
  vitalValue:       { fontSize: 11, fontWeight: '700', color: '#2c3e50' },
  vitalLabel:       { fontSize: 9, color: '#888', marginTop: 1 },

  generatedAt:      { fontSize: 10, color: '#aaa', textAlign: 'right', marginTop: 10 },

  // Plan cards
  planCard:         { backgroundColor: '#fff', marginHorizontal: 16, marginBottom: 12, borderRadius: 12, padding: 16, borderLeftWidth: 4, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  planCardHeader:   { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  planCardIcon:     { fontSize: 20, marginRight: 8 },
  planCardTitle:    { fontSize: 15, fontWeight: '700' },
  planCardContent:  { fontSize: 14, color: '#444', lineHeight: 22 },

  // Regenerate
  regenerateBtn:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', borderWidth: 1.5, borderColor: colors.primary, marginHorizontal: 16, marginBottom: 12, borderRadius: 10, padding: 13, gap: 8 },
  regenerateBtnText:{ color: colors.primary, fontWeight: '700', fontSize: 14 },

  // Disclaimer
  disclaimer:       { marginHorizontal: 16, marginBottom: 32, padding: 12, backgroundColor: '#fff9e6', borderRadius: 8 },
  disclaimerText:   { fontSize: 11, color: '#856404', lineHeight: 17, textAlign: 'center' },
});