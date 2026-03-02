// screens/caregiver/CaregiverOverdueScreen.tsx
// Shows all overdue tasks across all connected elders today.
// Caregiver can see what's overdue and tap to view details.

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { colors } from '../../styles/colors';
import { getApiUrl } from '../../config/api';

// ── push token registration for caregiver ────────────────────────────────────
async function registerCaregiverPush(userId: number) {
  if (!Device.isDevice) return;
  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;
  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') return;
  const tokenData = await Notifications.getExpoPushTokenAsync();
  try {
    await fetch(getApiUrl('/api/push-token'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, token: tokenData.data }),
    });
  } catch (e) { console.log('Caregiver push token save failed', e); }
}

// ─────────────────────────── types ───────────────────────────────────────────
type ScheduleType = 'medicine' | 'appointment' | 'routine' | 'reminder';

interface OverdueItem {
  id: number;
  medication_id: number;
  elder_id: number;
  elder_name: string;
  title: string;
  type: ScheduleType;
  scheduled_time: string;
  dosage?: string;
  taken_at: string;
}

// ─────────────────────────── constants ───────────────────────────────────────
const TYPE_CONFIG: Record<ScheduleType, { icon: string; color: string; label: string }> = {
  medicine:    { icon: '💊', color: '#a29bfe', label: 'Medicine'    },
  appointment: { icon: '🏥', color: '#74b9ff', label: 'Appointment' },
  routine:     { icon: '🌿', color: '#00b894', label: 'Routine'     },
  reminder:    { icon: '🔔', color: '#fdcb6e', label: 'Reminder'    },
};

const fmtTime = (t: string) => {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return t;
  return `${h % 12 || 12}:${String(m).padStart(2,'0')} ${h >= 12 ? 'PM' : 'AM'}`;
};

const fmtDateTime = (dt: string) => {
  if (!dt) return '';
  const d = new Date(dt);
  return d.toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' });
};

const todayLabel = () =>
  new Date().toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' });

// ─────────────────────────── component ───────────────────────────────────────
const CaregiverOverdueScreen = ({ navigation }: any) => {
  const [caregiver,  setCaregiver]  = useState<any>(null);
  const [items,      setItems]      = useState<OverdueItem[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem('user');
        if (stored) {
          const user = JSON.parse(stored);
          setCaregiver(user);
          await load(user.id);
          await registerCaregiverPush(user.id);
        }
      } catch (e) { console.log('Init error', e); }
      finally { setLoading(false); }
    })();
  }, []);

  // Listen for push tap → refresh
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(() => {
      if (caregiver?.id) load(caregiver.id);
    });
    return () => sub.remove();
  }, [caregiver?.id]);

  const load = useCallback(async (cgId: number) => {
    try {
      const res  = await fetch(getApiUrl(`/api/overdue/caregiver/${cgId}`));
      const data = await res.json();
      setItems(Array.isArray(data) ? data : []);
    } catch (e) { console.log('Load error', e); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  const onRefresh = () => { setRefreshing(true); if (caregiver?.id) load(caregiver.id); };

  // Group by elder
  const grouped: Record<string, OverdueItem[]> = {};
  items.forEach(item => {
    const k = `${item.elder_id}:${item.elder_name}`;
    grouped[k] = grouped[k] ? [...grouped[k], item] : [item];
  });

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={S.screen}>

      {/* Header */}
      <View style={S.header}>
        <View>
          <Text style={S.headerSup}>{todayLabel()}</Text>
          <Text style={S.headerTitle}>Overdue Tasks</Text>
        </View>
        <View style={[S.badge, items.length > 0 && S.badgeAlert]}>
          <Text style={[S.badgeNum, items.length > 0 && S.badgeNumAlert]}>{items.length}</Text>
          <Text style={[S.badgeLbl, items.length > 0 && S.badgeLblAlert]}>overdue</Text>
        </View>
      </View>

      {/* Info banner */}
      {items.length > 0 && (
        <View style={S.warningBanner}>
          <Text style={S.warningBannerTxt}>
            🚨 {items.length} task{items.length !== 1 ? 's' : ''} overdue today — elders did not respond after maximum reminders.
          </Text>
        </View>
      )}

      {loading ? (
        <View style={S.center}>
          <ActivityIndicator size="large" color="#d63031" />
          <Text style={S.loadTxt}>Loading overdue tasks…</Text>
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#d63031" />}>

          {items.length === 0 ? (
            <View style={S.empty}>
              <Text style={S.emptyIco}>✅</Text>
              <Text style={S.emptyTitle}>All clear!</Text>
              <Text style={S.emptyTxt}>No overdue tasks today. All elders are on track.</Text>
            </View>
          ) : (
            Object.entries(grouped).map(([key, elderItems]) => {
              const elderName = key.split(':')[1];
              return (
                <View key={key}>
                  {/* Elder header */}
                  <View style={S.elderHdr}>
                    <View style={S.elderHdrLeft}>
                      <Text style={S.elderHdrIco}>👤</Text>
                      <Text style={S.elderHdrName}>{elderName}</Text>
                    </View>
                    <View style={S.elderHdrBadge}>
                      <Text style={S.elderHdrBadgeTxt}>{elderItems.length} overdue</Text>
                    </View>
                  </View>

                  {elderItems.map(item => {
                    const c = TYPE_CONFIG[item.type as ScheduleType] || TYPE_CONFIG.reminder;
                    return (
                      <View key={item.id} style={S.card}>
                        {/* Red overdue strip */}
                        <View style={S.overdueStrip}>
                          <Text style={S.overdueStripTxt}>🚨 OVERDUE</Text>
                          <Text style={S.overdueStripTime}>Marked at {fmtDateTime(item.taken_at)}</Text>
                        </View>

                        <View style={S.cardBody}>
                          <View style={S.cardTop}>
                            <View style={[S.typePill, { backgroundColor: c.color + '18' }]}>
                              <Text style={[S.typePillTxt, { color: c.color }]}>{c.icon} {c.label}</Text>
                            </View>
                            <View style={S.scheduledTimePill}>
                              <Text style={S.scheduledTimeTxt}>🕐 Scheduled {fmtTime(item.scheduled_time)}</Text>
                            </View>
                          </View>

                          <Text style={S.cardTitle}>{item.title}</Text>
                          {item.dosage && <Text style={S.cardDosage}>💊 {item.dosage}</Text>}

                          <View style={S.cardFooter}>
                            <Text style={S.cardFooterTxt}>
                              Elder has been notified. Caregiver alert sent.
                            </Text>
                          </View>
                        </View>
                      </View>
                    );
                  })}
                </View>
              );
            })
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
};

// ─────────────────────────── styles ──────────────────────────────────────────
const S = StyleSheet.create({
  screen: { flex:1, backgroundColor:colors.background },

  header:      { flexDirection:'row', justifyContent:'space-between', alignItems:'center', padding:20, paddingBottom:14, backgroundColor:colors.white, borderBottomWidth:1, borderBottomColor:colors.border },
  headerSup:   { fontSize:11, color:colors.textSecondary, textTransform:'uppercase', letterSpacing:0.6 },
  headerTitle: { fontSize:22, fontWeight:'800', color:colors.textPrimary, marginTop:2 },

  badge:         { alignItems:'center', backgroundColor:'#f0f0f0', padding:10, borderRadius:12 },
  badgeAlert:    { backgroundColor:'#ffe0e0' },
  badgeNum:      { fontSize:22, fontWeight:'800', color:colors.textSecondary },
  badgeNumAlert: { color:'#d63031' },
  badgeLbl:      { fontSize:10, color:colors.textSecondary },
  badgeLblAlert: { color:'#d63031' },

  warningBanner:    { backgroundColor:'#ffe0e0', padding:14, borderBottomWidth:1, borderBottomColor:'#ffcccc' },
  warningBannerTxt: { fontSize:13, color:'#d63031', fontWeight:'600', lineHeight:18 },

  center:  { flex:1, justifyContent:'center', alignItems:'center' },
  loadTxt: { marginTop:12, color:colors.textSecondary },

  empty:      { alignItems:'center', paddingVertical:80, paddingHorizontal:40 },
  emptyIco:   { fontSize:72, marginBottom:16 },
  emptyTitle: { fontSize:20, fontWeight:'700', color:colors.textPrimary, marginBottom:8 },
  emptyTxt:   { fontSize:13, color:colors.textSecondary, textAlign:'center', lineHeight:20 },

  elderHdr:       { flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingHorizontal:16, paddingVertical:10, backgroundColor:'#fff0f0' },
  elderHdrLeft:   { flexDirection:'row', alignItems:'center', gap:8 },
  elderHdrIco:    { fontSize:16 },
  elderHdrName:   { fontSize:14, fontWeight:'700', color:colors.textPrimary },
  elderHdrBadge:  { backgroundColor:'#d63031', paddingHorizontal:10, paddingVertical:3, borderRadius:12 },
  elderHdrBadgeTxt:{ fontSize:11, fontWeight:'700', color:'#fff' },

  card:      { backgroundColor:colors.white, marginHorizontal:16, marginBottom:10, marginTop:2, borderRadius:14, overflow:'hidden', elevation:2, shadowColor:'#d63031', shadowOpacity:0.15, shadowRadius:6, shadowOffset:{width:0,height:2} },
  overdueStrip:     { backgroundColor:'#d63031', paddingVertical:7, paddingHorizontal:14, flexDirection:'row', justifyContent:'space-between', alignItems:'center' },
  overdueStripTxt:  { fontSize:12, fontWeight:'800', color:'#fff' },
  overdueStripTime: { fontSize:11, color:'rgba(255,255,255,0.85)' },
  cardBody:   { padding:14 },
  cardTop:    { flexDirection:'row', alignItems:'center', flexWrap:'wrap', gap:8, marginBottom:8 },
  typePill:   { paddingHorizontal:8, paddingVertical:3, borderRadius:8 },
  typePillTxt:{ fontSize:11, fontWeight:'700' },
  scheduledTimePill: { backgroundColor:'#f0f0f0', paddingHorizontal:8, paddingVertical:3, borderRadius:8 },
  scheduledTimeTxt:  { fontSize:11, color:colors.textSecondary },
  cardTitle:  { fontSize:16, fontWeight:'800', color:colors.textPrimary, marginBottom:3 },
  cardDosage: { fontSize:12, color:'#a29bfe', fontWeight:'600', marginBottom:6 },
  cardFooter: { marginTop:8, paddingTop:8, borderTopWidth:1, borderTopColor:colors.border },
  cardFooterTxt:{ fontSize:11, color:'#d63031', fontStyle:'italic' },
});

export default CaregiverOverdueScreen;