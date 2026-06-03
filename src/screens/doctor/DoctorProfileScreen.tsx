// screens/doctor/DoctorProfileScreen.tsx
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl, TextInput, Alert,
  KeyboardAvoidingView, Platform
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApiUrl } from '../../config/api';

interface DoctorProfile {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  specialty: string | null;
  license_number: string | null;
  hospital: string | null;
  address: string | null;
  created_at: string;
}

const DoctorProfileScreen = ({ navigation, route }: any) => {
  const { doctorId, doctorName, user } = route.params || {};
  const resolvedId = doctorId || user?.id;
  const [profile, setProfile] = useState<DoctorProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  
  // Form fields
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    specialty: '',
    license_number: '',
    hospital: '',
    address: '',
  });

  // Stats fields - editable by doctor
  const [stats, setStats] = useState({
    total_patients: '',
    active_cases: '',
    years_exp: '',
  });

  const loadProfile = useCallback(async () => {
    if (!resolvedId) return;
    try {
      const res = await fetch(getApiUrl(`/api/doctor/profile/${resolvedId}`));
      if (res.ok) {
        const data = await res.json();
        setProfile(data);
        setFormData({
          name: data.name || '',
          email: data.email || '',
          phone: data.phone || '',
          specialty: data.specialty || '',
          license_number: data.license_number || '',
          hospital: data.hospital || '',
          address: data.address || '',
        });
      }
      
      // Load saved stats from AsyncStorage (frontend-only for now)
      const savedStats = await AsyncStorage.getItem(`doctor_stats_${resolvedId}`);
      if (savedStats) {
        const parsedStats = JSON.parse(savedStats);
        setStats({
          total_patients: parsedStats.total_patients || '',
          active_cases: parsedStats.active_cases || '',
          years_exp: parsedStats.years_exp || '',
        });
      }
    } catch (e) {
      console.log('Load profile error:', e);
    } finally {
      setLoading(false);
    }
  }, [resolvedId]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const onRefresh = () => {
    setRefreshing(true);
    loadProfile().finally(() => setRefreshing(false));
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      Alert.alert('Error', 'Name is required');
      return;
    }
    if (!formData.email.trim()) {
      Alert.alert('Error', 'Email is required');
      return;
    }

    setSaving(true);
    try {
      // Save profile to backend
      const res = await fetch(getApiUrl(`/api/doctor/profile/${resolvedId}`), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      
      if (res.ok) {
        await loadProfile();
        
        // Save stats locally (frontend-only for now)
        await AsyncStorage.setItem(`doctor_stats_${resolvedId}`, JSON.stringify(stats));
        
        setEditing(false);
        Alert.alert('Success', 'Profile and statistics updated successfully');
      } else {
        const error = await res.json();
        Alert.alert('Error', error.message || 'Failed to update profile');
      }
    } catch (e) {
      Alert.alert('Error', 'Network error. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleLogout = () => {
    Alert.alert('Logout', 'Are you sure you want to logout?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Logout', style: 'destructive',
        onPress: async () => {
          try { await AsyncStorage.multiRemove(['user', 'caregiverId']); } catch {}
          navigation.reset({ index: 0, routes: [{ name: 'Login' }] });
        },
      },
    ]);
  };

  const formatDate = (dateString: string) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.loadBox}>
          <ActivityIndicator size="large" color="#2c7da0" />
          <Text style={styles.loadingText}>Loading profile...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backBtnText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My Profile</Text>
        <TouchableOpacity onPress={handleLogout} style={styles.logoutBtn}>
          <Text style={styles.logoutBtnText}>Logout</Text>
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#2c7da0" />
          }
          contentContainerStyle={styles.scrollContent}
        >
          {/* Profile Header Card */}
          <View style={styles.profileHeader}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {profile?.name?.charAt(0).toUpperCase() || 'D'}
              </Text>
            </View>
            {!editing && profile && (
              <TouchableOpacity style={styles.editBtn} onPress={() => setEditing(true)}>
                <Text style={styles.editBtnText}>✏️ Edit</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Member Since */}
          {profile?.created_at && !editing && (
            <View style={styles.memberSince}>
              <Text style={styles.memberSinceIcon}>📅</Text>
              <Text style={styles.memberSinceText}>
                Member since {formatDate(profile.created_at)}
              </Text>
            </View>
          )}

          {/* Profile Form */}
          <View style={styles.formCard}>
            <Text style={styles.sectionTitle}>Professional Information</Text>
            
            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Full Name *</Text>
              {editing ? (
                <TextInput
                  style={styles.fieldInput}
                  value={formData.name}
                  onChangeText={(text) => setFormData({ ...formData, name: text })}
                  placeholder="Dr. John Doe"
                  placeholderTextColor="#adb5bd"
                />
              ) : (
                <Text style={styles.fieldValue}>{profile?.name || '—'}</Text>
              )}
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Email Address *</Text>
              {editing ? (
                <TextInput
                  style={styles.fieldInput}
                  value={formData.email}
                  onChangeText={(text) => setFormData({ ...formData, email: text })}
                  placeholder="doctor@hospital.com"
                  placeholderTextColor="#adb5bd"
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
              ) : (
                <Text style={styles.fieldValue}>{profile?.email || '—'}</Text>
              )}
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Phone Number</Text>
              {editing ? (
                <TextInput
                  style={styles.fieldInput}
                  value={formData.phone}
                  onChangeText={(text) => setFormData({ ...formData, phone: text })}
                  placeholder="+1 234 567 8900"
                  placeholderTextColor="#adb5bd"
                  keyboardType="phone-pad"
                />
              ) : (
                <Text style={styles.fieldValue}>{profile?.phone || '—'}</Text>
              )}
            </View>

            <View style={styles.divider} />

            <Text style={styles.sectionTitle}>Medical Credentials</Text>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Specialty</Text>
              {editing ? (
                <TextInput
                  style={styles.fieldInput}
                  value={formData.specialty}
                  onChangeText={(text) => setFormData({ ...formData, specialty: text })}
                  placeholder="Cardiology, Neurology, etc."
                  placeholderTextColor="#adb5bd"
                />
              ) : (
                <Text style={styles.fieldValue}>{profile?.specialty || 'Not specified'}</Text>
              )}
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>License Number</Text>
              {editing ? (
                <TextInput
                  style={styles.fieldInput}
                  value={formData.license_number}
                  onChangeText={(text) => setFormData({ ...formData, license_number: text })}
                  placeholder="Medical license number"
                  placeholderTextColor="#adb5bd"
                />
              ) : (
                <Text style={styles.fieldValue}>{profile?.license_number || 'Not specified'}</Text>
              )}
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Hospital / Clinic</Text>
              {editing ? (
                <TextInput
                  style={styles.fieldInput}
                  value={formData.hospital}
                  onChangeText={(text) => setFormData({ ...formData, hospital: text })}
                  placeholder="Affiliated hospital"
                  placeholderTextColor="#adb5bd"
                />
              ) : (
                <Text style={styles.fieldValue}>{profile?.hospital || 'Not specified'}</Text>
              )}
            </View>

            <View style={styles.fieldGroup}>
              <Text style={styles.fieldLabel}>Clinic Address</Text>
              {editing ? (
                <TextInput
                  style={[styles.fieldInput, styles.textArea]}
                  value={formData.address}
                  onChangeText={(text) => setFormData({ ...formData, address: text })}
                  placeholder="Full clinic address"
                  placeholderTextColor="#adb5bd"
                  multiline
                  numberOfLines={3}
                />
              ) : (
                <Text style={styles.fieldValue}>{profile?.address || 'Not specified'}</Text>
              )}
            </View>
          </View>

          {/* Stats Card - NOW EDITABLE */}
          <View style={styles.statsCard}>
            <Text style={styles.statsTitle}>Practice Statistics</Text>
            <View style={styles.statsRow}>
              <View style={styles.statItem}>
                {editing ? (
                  <TextInput
                    style={styles.statInput}
                    value={stats.total_patients}
                    onChangeText={(text) => setStats({ ...stats, total_patients: text })}
                    placeholder="0"
                    placeholderTextColor="#adb5bd"
                    keyboardType="numeric"
                    textAlign="center"
                  />
                ) : (
                  <Text style={styles.statNumber}>{stats.total_patients || '—'}</Text>
                )}
                <Text style={styles.statLabel}>Total Patients</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                {editing ? (
                  <TextInput
                    style={styles.statInput}
                    value={stats.active_cases}
                    onChangeText={(text) => setStats({ ...stats, active_cases: text })}
                    placeholder="0"
                    placeholderTextColor="#adb5bd"
                    keyboardType="numeric"
                    textAlign="center"
                  />
                ) : (
                  <Text style={styles.statNumber}>{stats.active_cases || '—'}</Text>
                )}
                <Text style={styles.statLabel}>Active Cases</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                {editing ? (
                  <TextInput
                    style={styles.statInput}
                    value={stats.years_exp}
                    onChangeText={(text) => setStats({ ...stats, years_exp: text })}
                    placeholder="0"
                    placeholderTextColor="#adb5bd"
                    keyboardType="numeric"
                    textAlign="center"
                  />
                ) : (
                  <Text style={styles.statNumber}>{stats.years_exp || '—'}</Text>
                )}
                <Text style={styles.statLabel}>Years Exp.</Text>
              </View>
            </View>
          </View>

          {/* Action Buttons */}
          {editing ? (
            <View style={styles.actionButtonsContainer}>
              <TouchableOpacity
                style={[styles.actionBtn, styles.cancelBtn]}
                onPress={() => {
                  setEditing(false);
                  if (profile) {
                    setFormData({
                      name: profile.name || '',
                      email: profile.email || '',
                      phone: profile.phone || '',
                      specialty: profile.specialty || '',
                      license_number: profile.license_number || '',
                      hospital: profile.hospital || '',
                      address: profile.address || '',
                    });
                  }
                  // Reload saved stats
                  AsyncStorage.getItem(`doctor_stats_${resolvedId}`).then((savedStats) => {
                    if (savedStats) {
                      const parsedStats = JSON.parse(savedStats);
                      setStats({
                        total_patients: parsedStats.total_patients || '',
                        active_cases: parsedStats.active_cases || '',
                        years_exp: parsedStats.years_exp || '',
                      });
                    }
                  });
                }}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.actionBtn, styles.saveBtn]}
                onPress={handleSave}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.saveBtnText}>Save Changes</Text>
                )}
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={styles.updateBtn} onPress={() => setEditing(true)}>
              <Text style={styles.updateBtnText}>Update Profile</Text>
            </TouchableOpacity>
          )}

          <View style={styles.footer} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f8f9fa' },
  loadBox: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#95a5a6', marginTop: 12 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e9ecef',
  },
  backBtn: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backBtnText: {
    fontSize: 24,
    color: '#2c7da0',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#2c3e50',
  },
  logoutBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#dee2e6',
    backgroundColor: '#f8f9fa',
  },
  logoutBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#495057',
  },

  scrollContent: {
    paddingBottom: 30,
  },

  profileHeader: {
    alignItems: 'center',
    paddingVertical: 24,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e9ecef',
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#2c7da0',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
    shadowColor: '#2c7da0',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  avatarText: {
    fontSize: 42,
    fontWeight: '700',
    color: '#fff',
  },
  editBtn: {
    position: 'absolute',
    right: 20,
    top: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: '#e9ecef',
  },
  editBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#495057',
  },

  memberSince: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e9ecef',
    gap: 8,
  },
  memberSinceIcon: {
    fontSize: 14,
  },
  memberSinceText: {
    fontSize: 12,
    color: '#6c757d',
  },

  formCard: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 14,
    padding: 18,
    borderWidth: 1,
    borderColor: '#e9ecef',
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 4,
    elevation: 1,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#2c3e50',
    marginBottom: 16,
  },
  fieldGroup: {
    marginBottom: 16,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6c757d',
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  fieldValue: {
    fontSize: 15,
    color: '#212529',
    paddingVertical: 8,
  },
  fieldInput: {
    backgroundColor: '#f8f9fa',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#dee2e6',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#212529',
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  divider: {
    height: 1,
    backgroundColor: '#e9ecef',
    marginVertical: 16,
  },

  actionButtonsContainer: {
    flexDirection: 'row',
    gap: 12,
    marginHorizontal: 16,
    marginTop: 16,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  cancelBtn: {
    backgroundColor: '#f8f9fa',
    borderWidth: 1,
    borderColor: '#dee2e6',
  },
  cancelBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#495057',
  },
  saveBtn: {
    backgroundColor: '#2c7da0',
  },
  saveBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  updateBtn: {
    backgroundColor: '#2c7da0',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 16,
  },
  updateBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },

  statsCard: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginTop: 16,
    borderRadius: 14,
    padding: 18,
    borderWidth: 1,
    borderColor: '#e9ecef',
  },
  statsTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#2c3e50',
    marginBottom: 16,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statNumber: {
    fontSize: 22,
    fontWeight: '800',
    color: '#2c7da0',
    marginBottom: 4,
  },
  statInput: {
    fontSize: 22,
    fontWeight: '800',
    color: '#2c7da0',
    marginBottom: 4,
    textAlign: 'center',
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#dee2e6',
    minWidth: 60,
  },
  statLabel: {
    fontSize: 11,
    color: '#6c757d',
  },
  statDivider: {
    width: 1,
    height: 30,
    backgroundColor: '#e9ecef',
  },

  footer: {
    height: 20,
  },
});

export default DoctorProfileScreen;