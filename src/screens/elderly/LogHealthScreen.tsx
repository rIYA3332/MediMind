import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, ActivityIndicator
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Input from '../../components/Input';
import Button from '../../components/Button';
import Card from '../../components/Card';
import { colors } from '../../styles/colors';
import { getApiUrl } from '../../config/api';

interface HealthLog {
  id: number;
  log_type: string;
  value: string;
  unit: string;
  notes: string;
  logged_at: string;
}

const LogHealthScreen: React.FC = () => {
  const [activeTab, setActiveTab] = useState<string>('log');
  const [selectedType, setSelectedType] = useState<string>('blood_pressure');
  const [value, setValue] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [logs, setLogs] = useState<HealthLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [userId, setUserId] = useState<number | null>(null);

  const healthTypes = [
    { id: 'blood_pressure', label: 'Blood Pressure', unit: 'mmHg', icon: '💉', placeholder: '120/80' },
    { id: 'blood_sugar', label: 'Blood Sugar', unit: 'mg/dL', icon: '🩸', placeholder: '100' },
    { id: 'weight', label: 'Weight', unit: 'kg', icon: '⚖️', placeholder: '70' },
    { id: 'temperature', label: 'Temperature', unit: '°F', icon: '🌡️', placeholder: '98.6' },
    { id: 'heart_rate', label: 'Heart Rate', unit: 'bpm', icon: '❤️', placeholder: '72' },
  ];

  useEffect(() => {
    loadUser();
  }, []);

  useEffect(() => {
    if (userId && activeTab === 'history') {
      fetchLogs();
    }
  }, [activeTab, userId]);

  const loadUser = async () => {
    try {
      const user = await AsyncStorage.getItem('user');
      if (user) {
        const userData = JSON.parse(user);
        console.log('Loaded user ID:', userData.id);
        setUserId(userData.id);
      } else {
        Alert.alert('Error', 'User not found. Please log in again.');
      }
    } catch (e) {
      console.log('Error loading user:', e);
      Alert.alert('Error', 'Failed to load user data');
    }
  };

  const fetchLogs = async () => {
    if (!userId) return;
    
    setLoading(true);
    try {
      console.log('Fetching logs for user:', userId);
      const res = await fetch(getApiUrl(`/api/health-logs/${userId}`));
      const data = await res.json();
      console.log('Fetched logs:', data);
      setLogs(data);
    } catch (e) {
      console.log('Fetch error', e);
      Alert.alert('Error', 'Failed to fetch health logs');
    } finally {
      setLoading(false);
    }
  };

  const handleLogHealth = async () => {
    console.log('=== Starting health log submission ===');
    console.log('User ID:', userId);
    console.log('Selected Type:', selectedType);
    console.log('Value:', value);
    console.log('Notes:', notes);

    if (!userId) {
      Alert.alert('Error', 'User not logged in');
      return;
    }

    if (!value.trim()) {
      Alert.alert('Error', 'Please enter a value');
      return;
    }

    const selected = healthTypes.find(t => t.id === selectedType);
    if (!selected) {
      Alert.alert('Error', 'Invalid health type selected');
      return;
    }

    const payload = {
      userId,
      logType: selectedType,
      value: value.trim(),
      unit: selected.unit,
      notes: notes.trim() || null,
    };

    console.log('Payload to send:', JSON.stringify(payload, null, 2));

    setSubmitting(true);

    try {
      const url = getApiUrl('/api/health-logs');
      console.log('Sending POST to:', url);

      const res = await fetch(url, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      console.log('Response status:', res.status);
      const responseText = await res.text();
      console.log('Response text:', responseText);

      let data;
      try {
        data = JSON.parse(responseText);
      } catch (e) {
        console.log('Failed to parse response as JSON');
        throw new Error('Invalid server response');
      }

      if (res.ok) {
        console.log('✓ Success! Log ID:', data.logId);
        Alert.alert(
          '✓ Success', 
          'Health data logged successfully!',
          [
            {
              text: 'OK',
              onPress: () => {
                setValue('');
                setNotes('');
                // Refresh logs if on history tab
                if (activeTab === 'history') {
                  fetchLogs();
                }
              }
            }
          ]
        );
      } else {
        console.log('Server error:', data.message);
        Alert.alert('Error', data.message || 'Failed to log health data');
      }
    } catch (e) {
      console.log('Network error:', e);
      Alert.alert('Error', 'Network error. Please check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const getLogIcon = (type: string) => {
    return healthTypes.find(t => t.id === type)?.icon || '📊';
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* Tabs */}
      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'log' && styles.activeTab]}
          onPress={() => setActiveTab('log')}
        >
          <Text style={[styles.tabText, activeTab === 'log' && styles.activeTabText]}>
            Log Health
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'history' && styles.activeTab]}
          onPress={() => setActiveTab('history')}
        >
          <Text style={[styles.tabText, activeTab === 'history' && styles.activeTabText]}>
            History
          </Text>
        </TouchableOpacity>
      </View>

      {activeTab === 'log' ? (
        <ScrollView style={styles.content}>
          {!userId && (
            <Card style={{ marginBottom: 15, backgroundColor: '#fff3cd' }}>
              <Text style={{ color: '#856404', textAlign: 'center' }}>
                ⚠️ Please log in to record health data
              </Text>
            </Card>
          )}

          <Card>
            <Text style={styles.sectionTitle}>Select Health Metric</Text>
            <View style={styles.typeGrid}>
              {healthTypes.map((type) => (
                <TouchableOpacity
                  key={type.id}
                  style={[
                    styles.typeCard,
                    selectedType === type.id && styles.typeCardActive,
                  ]}
                  onPress={() => setSelectedType(type.id)}
                  disabled={submitting}
                >
                  <Text style={styles.typeIcon}>{type.icon}</Text>
                  <Text style={[
                    styles.typeLabel,
                    selectedType === type.id && { color: colors.white }
                  ]}>
                    {type.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </Card>

          <Card style={{ marginTop: 15 }}>
            <Text style={styles.sectionTitle}>
              Enter {healthTypes.find(t => t.id === selectedType)?.label}
            </Text>
            
            <Input
              label={`Value (${healthTypes.find(t => t.id === selectedType)?.unit})`}
              value={value}
              onChangeText={setValue}
              placeholder={healthTypes.find(t => t.id === selectedType)?.placeholder}
              keyboardType="default"
            />

            <Input
              label="Notes (optional)"
              value={notes}
              onChangeText={setNotes}
              placeholder="Any additional notes..."
              multiline
            />

            <Button 
              title={submitting ? "Saving..." : "Log Health Data"} 
              onPress={handleLogHealth}
            />

            {submitting && (
              <View style={{ marginTop: 10, alignItems: 'center' }}>
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            )}
          </Card>
        </ScrollView>
      ) : (
        <ScrollView style={styles.content}>
          {loading ? (
            <View style={{ paddingVertical: 40, alignItems: 'center' }}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={{ marginTop: 10, color: colors.textSecondary }}>
                Loading health logs...
              </Text>
            </View>
          ) : logs.length === 0 ? (
            <Card>
              <Text style={styles.emptyText}>No health logs yet</Text>
              <Text style={[styles.emptyText, { fontSize: 12, marginTop: 10 }]}>
                Start logging your health data to see your history here
              </Text>
            </Card>
          ) : (
            logs.map((log) => (
              <Card key={log.id} style={styles.logCard}>
                <View style={styles.logHeader}>
                  <Text style={styles.logIcon}>{getLogIcon(log.log_type)}</Text>
                  <View style={styles.logInfo}>
                    <Text style={styles.logType}>
                      {healthTypes.find(t => t.id === log.log_type)?.label}
                    </Text>
                    <Text style={styles.logDate}>{formatDate(log.logged_at)}</Text>
                  </View>
                  <Text style={styles.logValue}>
                    {log.value} {log.unit}
                  </Text>
                </View>
                {log.notes && (
                  <Text style={styles.logNotes}>💬 {log.notes}</Text>
                )}
              </Card>
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  tabContainer: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tab: {
    flex: 1,
    paddingVertical: 15,
    alignItems: 'center',
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
  },
  activeTab: { borderBottomColor: colors.primary },
  tabText: { fontSize: 14, color: colors.textSecondary, fontWeight: '600' },
  activeTabText: { color: colors.primary },
  content: { flex: 1, padding: 15 },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    color: colors.textPrimary,
    marginBottom: 15,
  },
  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  typeCard: {
    width: '30%',
    aspectRatio: 1,
    backgroundColor: colors.cardBg,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 10,
  },
  typeCardActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  typeIcon: { fontSize: 28, marginBottom: 5 },
  typeLabel: { 
    fontSize: 11, 
    textAlign: 'center', 
    color: colors.textPrimary,
    fontWeight: '600',
  },
  emptyText: { textAlign: 'center', color: colors.textSecondary, fontSize: 14 },
  logCard: { marginBottom: 12 },
  logHeader: { flexDirection: 'row', alignItems: 'center' },
  logIcon: { fontSize: 32, marginRight: 12 },
  logInfo: { flex: 1 },
  logType: { fontSize: 14, fontWeight: 'bold', color: colors.textPrimary },
  logDate: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  logValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.primary,
  },
  logNotes: {
    fontSize: 12,
    color: colors.textSecondary,
    fontStyle: 'italic',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
});

export default LogHealthScreen;