import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, ActivityIndicator
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Input from '../../components/Input';
import Card from '../../components/Card';
import { colors } from '../../styles/colors';
import { getApiUrl } from '../../config/api';
import { useLang } from '../../context/LanguageContext';


interface HealthLog {
  id: number;
  log_type: string;
  value: string;
  unit: string;
  notes: string;
  logged_at: string;
}

// =============================================================================
// PHYSIOLOGICAL RANGE VALIDATION
// Returns null if valid, or an error message string if invalid
// =============================================================================
function validateHealthValue(type: string, rawValue: string): string | null {
  const v = rawValue.trim();
  if (!v) return 'Please enter a value.';

  switch (type) {

    case 'blood_pressure': {
      // Must be in format NNN/NNN or NN/NN
      const match = v.match(/^(\d{1,3})\/(\d{1,3})$/);
      if (!match) return 'Blood pressure must be in format 120/80 (systolic/diastolic).';
      const sys = parseInt(match[1]);
      const dia = parseInt(match[2]);
      if (sys < 50 || sys > 300)
        return `Systolic (${sys}) looks incorrect. Normal range is 50–300 mmHg. Please double-check.`;
      if (dia < 30 || dia > 200)
        return `Diastolic (${dia}) looks incorrect. Normal range is 30–200 mmHg. Please double-check.`;
      if (dia >= sys)
        return `Diastolic (${dia}) can't be higher than or equal to systolic (${sys}). Please re-check.`;
      return null;
    }

    case 'blood_sugar': {
      const n = parseFloat(v);
      if (isNaN(n)) return 'Blood sugar must be a number (e.g. 100).';
      if (n < 10)  return `${n} mg/dL is too low to be real. Did you miss a digit? Normal fasting is around 70–100.`;
      if (n > 800) return `${n} mg/dL seems too high. Please re-check your reading. Max expected is ~800.`;
      return null;
    }

    case 'heart_rate': {
      const n = parseFloat(v);
      if (isNaN(n) || !Number.isInteger(n)) return 'Heart rate must be a whole number (e.g. 72).';
      if (n < 20)  return `${n} bpm is too low to be a real heart rate. Please re-check.`;
      if (n > 300) return `${n} bpm is too high to be possible. Normal range is 40–200 bpm.`;
      return null;
    }

    case 'temperature': {
      const n = parseFloat(v);
      if (isNaN(n)) return 'Temperature must be a number (e.g. 98.6).';
      if (n < 90)  return `${n}°F seems too low. Normal human temperature is around 97–99°F. Did you mean ${n * 1.8 + 32 > 90 ? (n * 1.8 + 32).toFixed(1) + '°F' : 'something else'}?`;
      if (n > 115) return `${n}°F seems too high to be a human temperature. Please re-check your reading.`;
      return null;
    }

    case 'weight': {
      const n = parseFloat(v);
      if (isNaN(n)) return 'Weight must be a number (e.g. 70).';
      if (n < 10)  return `${n} kg seems too low. Please re-check — minimum expected is around 10 kg.`;
      if (n > 500) return `${n} kg seems too high. Please re-check your reading.`;
      return null;
    }

    default:
      return null;
  }
}

// What to show inside the hint box for each type
const RANGE_HINTS: Record<string, string> = {
  blood_pressure: 'Format: systolic/diastolic — e.g. 120/80. Normal resting: 90/60 to 120/80.',
  blood_sugar:    'Normal fasting: 70–100 mg/dL. After meals: up to 140 mg/dL.',
  heart_rate:     'Normal resting: 60–100 bpm. Athletes may be lower (40–60 bpm).',
  temperature:    'Normal: 97–99°F. Fever starts at 100.4°F.',
  weight:         'Enter your weight in kg. e.g. 68.5',
};

const LogHealthScreen: React.FC = () => {
  const { t } = useLang();
  const [activeTab,     setActiveTab]     = useState<string>('log');
  const [selectedType,  setSelectedType]  = useState<string>('blood_pressure');
  const [value,         setValue]         = useState<string>('');
  const [notes,         setNotes]         = useState<string>('');
  const [valueError,    setValueError]    = useState<string>('');
  const [logs,          setLogs]          = useState<HealthLog[]>([]);
  const [loading,       setLoading]       = useState(false);
  const [submitting,    setSubmitting]    = useState(false);
  const [userId,        setUserId]        = useState<number | null>(null);

 const healthTypes = [
    { id: 'blood_pressure', label: t('bloodPressure'), unit: 'mmHg', icon: '💉', placeholder: '120/80' },
    { id: 'blood_sugar',    label: t('bloodSugar'),    unit: 'mg/dL', icon: '🩸', placeholder: '100'   },
    { id: 'weight',         label: t('weight'),         unit: 'kg',    icon: '⚖️', placeholder: '70'    },
    { id: 'temperature',    label: t('temperature'),    unit: '°F',    icon: '🌡️', placeholder: '98.6'  },
    { id: 'heart_rate',     label: t('heartRate'),      unit: 'bpm',   icon: '❤️', placeholder: '72'    },
  ];

  useEffect(() => { loadUser(); }, []);

  useEffect(() => {
    if (userId && activeTab === 'history') fetchLogs();
  }, [activeTab, userId]);

  // Clear error and value when type changes
  useEffect(() => {
    setValue('');
    setValueError('');
  }, [selectedType]);

  const loadUser = async () => {
    try {
      const user = await AsyncStorage.getItem('user');
      if (user) setUserId(JSON.parse(user).id);
      else Alert.alert('Error', 'User not found. Please log in again.');
    } catch (e) { Alert.alert('Error', 'Failed to load user data'); }
  };

  const fetchLogs = async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const res  = await fetch(getApiUrl(`/api/health-logs/${userId}`));
      const data = await res.json();
      setLogs(Array.isArray(data) ? data : []);
    } catch (e) { Alert.alert('Error', 'Failed to fetch health logs'); }
    finally { setLoading(false); }
  };

  // Live validation as user types
  const handleValueChange = (text: string) => {
    setValue(text);
    if (text.trim()) {
      const err = validateHealthValue(selectedType, text);
      setValueError(err || '');
    } else {
      setValueError('');
    }
  };

  const handleLogHealth = async () => {
    if (!userId) { Alert.alert('Error', 'User not logged in'); return; }

    // Final validation on submit
    const error = validateHealthValue(selectedType, value);
    if (error) {
      setValueError(error);
      return;
    }

    const selected = healthTypes.find(t => t.id === selectedType)!;
    setSubmitting(true);
    try {
      const res = await fetch(getApiUrl('/api/health-logs'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          logType: selectedType,
          value:   value.trim(),
          unit:    selected.unit,
          notes:   notes.trim() || null,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        Alert.alert('✅ Saved', 'Health data logged successfully!', [{
          text: 'OK', onPress: () => {
            setValue('');
            setNotes('');
            setValueError('');
            if (activeTab === 'history') fetchLogs();
          }
        }]);
      } else {
        Alert.alert('Error', data.message || 'Failed to log health data');
      }
    } catch {
      Alert.alert('Error', 'Network error. Please check your connection.');
    } finally { setSubmitting(false); }
  };

  const formatDate = (dateString: string) => {
    const d = new Date(dateString);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const getLogIcon  = (type: string) => healthTypes.find(t => t.id === type)?.icon || '📊';
  const getLogLabel = (type: string) => healthTypes.find(t => t.id === type)?.label || type;
  const selected    = healthTypes.find(t => t.id === selectedType)!;
  const hasError    = !!valueError;

  return (
    <SafeAreaView style={styles.container}>

      {/* Tabs */}
      <View style={styles.tabContainer}>
        {['log', 'history'].map(tab => (
          <TouchableOpacity key={tab}
            style={[styles.tab, activeTab === tab && styles.activeTab]}
            onPress={() => setActiveTab(tab)}>
            <Text style={[styles.tabText, activeTab === tab && styles.activeTabText]}>
              {tab === 'log' ? 'Log Health' : 'History'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {activeTab === 'log' ? (
        <ScrollView style={styles.content} keyboardShouldPersistTaps="handled">

          {!userId && (
            <View style={styles.warnBanner}>
              <Text style={styles.warnBannerTxt}>⚠️ Please log in to record health data</Text>
            </View>
          )}

          {/* Type selector */}
          <Card>
            <Text style={styles.sectionTitle}>Select Health Metric</Text>
            <View style={styles.typeGrid}>
              {healthTypes.map(type => (
                <TouchableOpacity key={type.id}
                  style={[styles.typeCard, selectedType === type.id && styles.typeCardActive]}
                  onPress={() => setSelectedType(type.id)}
                  disabled={submitting}>
                  <Text style={styles.typeIcon}>{type.icon}</Text>
                  <Text style={[styles.typeLabel, selectedType === type.id && { color: colors.white }]}>
                    {type.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </Card>

          {/* Input */}
          <Card style={{ marginTop: 15 }}>
            <Text style={styles.sectionTitle}>
              Enter {selected.label}
            </Text>

            {/* Range hint */}
            <View style={styles.hintBox}>
              <Text style={styles.hintTxt}>💡 {RANGE_HINTS[selectedType]}</Text>
            </View>

            {/* Value input */}
            <Text style={styles.inputLabel}>
              Value ({selected.unit}) *
            </Text>
            <View style={[styles.inputWrap, hasError && styles.inputWrapError]}>
              <Input
                value={value}
                onChangeText={handleValueChange}
                placeholder={selected.placeholder}
              />
            </View>

            {/* Inline error message */}
            {hasError && (
              <View style={styles.errorBox}>
                <Text style={styles.errorIcon}>⚠️</Text>
                <Text style={styles.errorTxt}>{valueError}</Text>
              </View>
            )}

            {/* Valid confirmation */}
            {value.trim() && !hasError && (
              <View style={styles.validBox}>
                <Text style={styles.validTxt}>✅ Value looks good</Text>
              </View>
            )}

            <Text style={[styles.inputLabel, { marginTop: 14 }]}>Notes (optional)</Text>
            <Input
              value={notes}
              onChangeText={setNotes}
              placeholder="Any additional notes, e.g. 'taken after breakfast'..."
              multiline
            />

            <TouchableOpacity
              style={[styles.submitBtn, (submitting || hasError || !value.trim()) && styles.submitBtnDisabled]}
              onPress={handleLogHealth}
              disabled={submitting || hasError || !value.trim()}>
              <Text style={styles.submitBtnTxt}>
                {submitting ? 'Saving…' : 'Log Health Data'}
              </Text>
            </TouchableOpacity>

            {submitting && (
              <View style={{ marginTop: 10, alignItems: 'center' }}>
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            )}
          </Card>

          {/* Quick reference card */}
          <Card style={styles.refCard}>
            <Text style={styles.refTitle}>📋 Quick Reference</Text>
            {[
              { icon: '💉', label: 'Blood Pressure', normal: 'Normal: 90/60 – 120/80 mmHg' },
              { icon: '🩸', label: 'Blood Sugar',    normal: 'Fasting: 70–100 mg/dL' },
              { icon: '❤️', label: 'Heart Rate',     normal: 'Resting: 60–100 bpm' },
              { icon: '🌡️', label: 'Temperature',    normal: 'Normal: 97–99°F' },
              { icon: '⚖️', label: 'Weight',         normal: 'Track changes over time' },
            ].map(r => (
              <View key={r.label} style={styles.refRow}>
                <Text style={styles.refIcon}>{r.icon}</Text>
                <View>
                  <Text style={styles.refLabel}>{r.label}</Text>
                  <Text style={styles.refNormal}>{r.normal}</Text>
                </View>
              </View>
            ))}
          </Card>

          <View style={{ height: 30 }} />
        </ScrollView>
      ) : (
        <ScrollView style={styles.content}>
          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={styles.loadTxt}>Loading health logs…</Text>
            </View>
          ) : logs.length === 0 ? (
            <Card style={styles.emptyCard}>
              <Text style={styles.emptyIcon}>📊</Text>
              <Text style={styles.emptyTitle}>No health logs yet</Text>
              <Text style={styles.emptyTxt}>
                Switch to the Log tab to record your first health reading.
              </Text>
            </Card>
          ) : (
            logs.map(log => (
              <Card key={log.id} style={styles.logCard}>
                <View style={styles.logHeader}>
                  <Text style={styles.logIcon}>{getLogIcon(log.log_type)}</Text>
                  <View style={styles.logInfo}>
                    <Text style={styles.logType}>{getLogLabel(log.log_type)}</Text>
                    <Text style={styles.logDate}>{formatDate(log.logged_at)}</Text>
                  </View>
                  <Text style={styles.logValue}>{log.value} {log.unit}</Text>
                </View>
                {log.notes && (
                  <Text style={styles.logNotes}>💬 {log.notes}</Text>
                )}
              </Card>
            ))
          )}
          <View style={{ height: 30 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: colors.background },
  tabContainer: { flexDirection: 'row', backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.border },
  tab:          { flex: 1, paddingVertical: 15, alignItems: 'center', borderBottomWidth: 3, borderBottomColor: 'transparent' },
  activeTab:    { borderBottomColor: colors.primary },
  tabText:      { fontSize: 14, color: colors.textSecondary, fontWeight: '600' },
  activeTabText:{ color: colors.primary },
  content:      { flex: 1, padding: 15 },

  warnBanner:   { backgroundColor: '#fff3cd', borderRadius: 10, padding: 12, marginBottom: 14, borderWidth: 1, borderColor: '#ffc107' },
  warnBannerTxt:{ color: '#856404', textAlign: 'center', fontWeight: '600', fontSize: 13 },

  sectionTitle: { fontSize: 14, fontWeight: 'bold', color: colors.textPrimary, marginBottom: 15 },

  typeGrid:     { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  typeCard:     { width: '30%', aspectRatio: 1, backgroundColor: colors.cardBg, borderRadius: 12, borderWidth: 2, borderColor: colors.border, justifyContent: 'center', alignItems: 'center', padding: 10 },
  typeCardActive:{ backgroundColor: colors.primary, borderColor: colors.primary },
  typeIcon:     { fontSize: 28, marginBottom: 5 },
  typeLabel:    { fontSize: 11, textAlign: 'center', color: colors.textPrimary, fontWeight: '600' },

  // Hint box
  hintBox:      { backgroundColor: '#e8f4ff', borderRadius: 10, padding: 10, marginBottom: 14, borderWidth: 1, borderColor: '#b3d9ff' },
  hintTxt:      { fontSize: 12, color: '#0984e3', lineHeight: 18 },

  inputLabel:   { fontSize: 12, fontWeight: '700', color: colors.textSecondary, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4 },
  inputWrap:    { borderRadius: 12, overflow: 'hidden', borderWidth: 1.5, borderColor: '#d0d0d0', backgroundColor: '#f2f2f2' },
  inputWrapError:{ borderWidth: 2, borderColor: '#e17055', borderRadius: 12, backgroundColor: '#f2f2f2' },

  // Error box
  errorBox:     { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: '#fff5f0', borderRadius: 10, padding: 12, marginTop: 6, borderWidth: 1, borderColor: '#ffb3a7' },
  errorIcon:    { fontSize: 16, marginTop: 1 },
  errorTxt:     { flex: 1, fontSize: 13, color: '#d63031', lineHeight: 19, fontWeight: '500' },

  // Valid box
  validBox:     { backgroundColor: '#d4faf0', borderRadius: 10, padding: 10, marginTop: 6, borderWidth: 1, borderColor: '#b2dfdb' },
  validTxt:     { fontSize: 12, color: '#00b894', fontWeight: '600' },

  submitBtn:         { backgroundColor: colors.primary, paddingVertical: 15, borderRadius: 12, alignItems: 'center', marginTop: 10 },
  submitBtnDisabled: { backgroundColor: '#b2bec3', opacity: 0.7 },
  submitBtnTxt:      { color: '#fff', fontSize: 15, fontWeight: '700' },

  // Reference card
  refCard:      { marginTop: 15, backgroundColor: '#f8fffe' },
  refTitle:     { fontSize: 13, fontWeight: '700', color: colors.textPrimary, marginBottom: 12 },
  refRow:       { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  refIcon:      { fontSize: 22, width: 30 },
  refLabel:     { fontSize: 13, fontWeight: '600', color: colors.textPrimary },
  refNormal:    { fontSize: 11, color: colors.textSecondary, marginTop: 1 },

  // History
  center:       { paddingVertical: 60, alignItems: 'center' },
  loadTxt:      { marginTop: 10, color: colors.textSecondary },
  emptyCard:    { alignItems: 'center', paddingVertical: 50 },
  emptyIcon:    { fontSize: 60, marginBottom: 16 },
  emptyTitle:   { fontSize: 18, fontWeight: 'bold', color: colors.textPrimary, marginBottom: 8 },
  emptyTxt:     { fontSize: 13, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  logCard:      { marginBottom: 12 },
  logHeader:    { flexDirection: 'row', alignItems: 'center' },
  logIcon:      { fontSize: 32, marginRight: 12 },
  logInfo:      { flex: 1 },
  logType:      { fontSize: 14, fontWeight: 'bold', color: colors.textPrimary },
  logDate:      { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  logValue:     { fontSize: 16, fontWeight: 'bold', color: colors.primary },
  logNotes:     { fontSize: 12, color: colors.textSecondary, fontStyle: 'italic', marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border },
});

export default LogHealthScreen;