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
    const user = await AsyncStorage.getItem('user');
    if (user) {
      const userData = JSON.parse(user);
      setUserId(userData.id);
    }
  };

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const res = await fetch(getApiUrl(`/api/health-logs/${userId}`));
      const data = await res.json();
      setLogs(data);
    } catch (e) {
      console.log('Fetch error', e);
    } finally {
      setLoading(false);
    }
  };

  const handleLogHealth = async () => {
    if (!value.trim()) {
      Alert.alert('Error', 'Please enter a value');
      return;
    }

    const selected = healthTypes.find(t => t.id === selectedType);

    try {
      const res = await fetch(getApiUrl('/api/health-logs'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          logType: selectedType,
          value: value.trim(),
          unit: selected?.unit,
          notes: notes.trim(),
        }),
      });

      if (res.ok) {
        Alert.alert('✓ Success', 'Health data logged!');
        setValue('');
        setNotes('');
      }
    } catch (e) {
      Alert.alert('Error', 'Failed to log health data');
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
                >
                  <Text style={styles.typeIcon}>{type.icon}</Text>
                  <Text style={styles.typeLabel}>{type.label}</Text>
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

            <Button title="Log Health Data" onPress={handleLogHealth} />
          </Card>
        </ScrollView>
      ) : (
        <ScrollView style={styles.content}>
          {loading ? (
            <ActivityIndicator size="large" color={colors.primary} />
          ) : logs.length === 0 ? (
            <Card>
              <Text style={styles.emptyText}>No health logs yet</Text>
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
  typeLabel: { fontSize: 11, textAlign: 'center', color: colors.textPrimary },
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