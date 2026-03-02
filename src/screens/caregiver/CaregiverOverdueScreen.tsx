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

// ── push token registration ───────────────────────────────────────────────────
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

// ── Types ─────────────────────────────────────────────────────────────────────
type ScheduleType = 'medicine' | 'appointment' | 'routine' | 'reminder';
type TabType = 'overdue' | 'activity';

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

interface ActivityItem {
  source: 'intake' | 'reminder';
  id: number;
  medication_id: number;
  elder_id: number;
  elder_name: string;
  title: string;
  type: string;
  scheduled_time: string;
  dosage?: string;
  status: string;
  is_overdue: number;
  response_note?: string;
  event_time: string;
  attempt_number?: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────
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
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};

const fmtDateTime = (dt: string) => {
  if (!dt) return '';
  return new Date(dt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
};

const fmtEventTime = (dt: string) => {
  const d = new Date(dt);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ' · ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
};

const todayLabel = () =>
  new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

const getActivityMeta = (item: ActivityItem) => {
  if (item.source === 'reminder') {
    if (item.status === 'responded')
      return { icon: '✅', label: `Reminder ${item.attempt_number} — Elder responded`, color: '#00b894', bg: '#d4faf0' };
    return { icon: '🔔', label: `Reminder sent (attempt ${item.attempt_number})`, color: '#fdcb6e', bg: '#fff9e6' };
  }
  if (item.is_overdue)
    return { icon: '🚨', label: 'OVERDUE — No response after max reminders', color: '#ff4757', bg: '#fff0f0' };
  if (item.status === 'taken')
    return { icon: '✅', label: 'Taken', color: '#00b894', bg: '#d4faf0' };
  if (item.status === 'missed')
    return { icon: '⏭️', label: 'Skipped', color: '#a29bfe', bg: '#f0eeff' };
  return { icon: '❓', label: item.status, color: '#95a5a6', bg: '#f0f0f0' };
};

const typeIcons: Record<string, string> = {
  medicine: '💊', appointment: '🏥', routine: '🌿', reminder: '🔔',
};

// ── Component ─────────────────────────────────────────────────────────────────
const CaregiverOverdueScreen = ({ navigation }: any) => {
  const [caregiver,    setCaregiver]    = useState<any>(null);
  const [activeTab,    setActiveTab]    = useState<TabType>('overdue');
  const [items,        setItems]        = useState<OverdueItem[]>([]);
  const [activityItems, setActivityItems] = useState<ActivityItem[]>([]);
  const [activityDays, setActivityDays] = useState(1);
  const [loading,      setLoading]      = useState(true);
  const [actLoading,   setActLoading]   = useState(false);
  const [refreshing,   setRefreshing]   = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem('user');
        if (stored) {
          const user = JSON.parse(stored);
          setCaregiver(user);
          await Promise.all([
            loadOverdue(user.id),
            loadActivity(user.id, 1),
          ]);
          await registerCaregiverPush(user.id);
        }
      } catch (e) { console.log('Init error', e); }
      finally { setLoading(false); }
    })();
  }, []);

  // Refresh activity when days filter changes
  useEffect(() => {
    if (caregiver?.id) loadActivity(caregiver.id, activityDays);
  }, [activityDays]);

  // Listen for push tap → refresh
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(() => {
      if (caregiver?.id) {
        loadOverdue(caregiver.id);
        loadActivity(caregiver.id, activityDays);
      }
    });
    return () => sub.remove();
  }, [caregiver?.id, activityDays]);

  const loadOverdue = useCallback(async (cgId: number) => {
    try {
      const res  = await fetch(getApiUrl(`/api/overdue/caregiver/${cgId}`));
      const data = await res.json();
      setItems(Array.isArray(data) ? data : []);
    } catch (e) { console.log('Overdue load error', e); }
    finally { setRefreshing(false); }
  }, []);

  const loadActivity = useCallback(async (cgId: number, days: number) => {
    setActLoading(true);
    try {
      const res  = await fetch(getApiUrl(`/api/medication-activity/caregiver/${cgId}?days=${days}`));
      const data = await res.json();
      setActivityItems(Array.isArray(data) ? data : []);
    } catch (e) { console.log('Activity load error', e); }
    finally { setActLoading(false); setRefreshing(false); }
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    if (caregiver?.id) {
      loadOverdue(caregiver.id);
      loadActivity(caregiver.id, activityDays);
    }
  };

  // Group overdue by elder
  const grouped: Record<string, OverdueItem[]> = {};
  items.forEach(item => {
    const k = `${item.elder_id}:${item.elder_name}`;
    grouped[k] = grouped[k] ? [...grouped[k], item] : [item];
  });

  // Group activity by elder
  const actGrouped: Record<string, ActivityItem[]> = {};
  activityItems.forEach(item => {
    const k = `${item.elder_id}:${item.elder_name}`;
    actGrouped[k] = actGrouped[k] ? [...actGrouped[k], item] : [item];
  });

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={S.screen}>

      {/* Header */}
      <View style={S.header}>
        <View>
          <Text style={S.headerSup}>{todayLabel()}</Text>
          <Text style={S.headerTitle}>Medication Monitor</Text>
        </View>
        <View style={[S.badge, items.length > 0 && S.badgeAlert]}>
          <Text style={[S.badgeNum, items.length > 0 && S.badgeNumAlert]}>{items.length}</Text>
          <Text style={[S.badgeLbl, items.length > 0 && S.badgeLblAlert]}>overdue</Text>
        </View>
      </View>

      {/* Tab Bar */}
      <View style={S.tabBar}>
        <TouchableOpacity
          style={[S.tab, activeTab === 'overdue' && S.tabActive]}
          onPress={() => setActiveTab('overdue')}>
          <Text style={[S.tabTxt, activeTab === 'overdue' && S.tabTxtActive]}>
            🚨 Overdue{items.length > 0 ? ` (${items.length})` : ''}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[S.tab, activeTab === 'activity' && S.tabActive]}
          onPress={() => setActiveTab('activity')}>
          <Text style={[S.tabTxt, activeTab === 'activity' && { color: colors.primary, fontWeight: '700' }]}>
            📋 Activity Log
          </Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={S.center}>
          <ActivityIndicator size="large" color="#d63031" />
          <Text style={S.loadTxt}>Loading…</Text>
        </View>
      ) : (
        <>
          {/* ── OVERDUE TAB ── */}
          {activeTab === 'overdue' && (
            <>
              {items.length > 0 && (
                <View style={S.warningBanner}>
                  <Text style={S.warningBannerTxt}>
                    🚨 {items.length} task{items.length !== 1 ? 's' : ''} overdue — elders did not respond after maximum reminders.
                  </Text>
                </View>
              )}
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
                                {item.dosage ? <Text style={S.cardDosage}>💊 {item.dosage}</Text> : null}
                                <View style={S.cardFooter}>
                                  <Text style={S.cardFooterTxt}>Elder has been notified. Caregiver alert sent.</Text>
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
            </>
          )}

          {/* ── ACTIVITY TAB ── */}
          {activeTab === 'activity' && (
            <View style={{ flex: 1 }}>
              {/* Day filter */}
              <View style={S.dayFilterRow}>
                {([1, 3, 7] as const).map(d => (
                  <TouchableOpacity key={d}
                    style={[S.dayFilterBtn, activityDays === d && S.dayFilterBtnActive]}
                    onPress={() => setActivityDays(d)}>
                    <Text style={[S.dayFilterTxt, activityDays === d && S.dayFilterTxtActive]}>
                      {d === 1 ? 'Today' : `${d} days`}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {actLoading ? (
                <View style={S.center}>
                  <ActivityIndicator size="large" color={colors.primary} />
                  <Text style={S.loadTxt}>Loading activity…</Text>
                </View>
              ) : (
                <ScrollView
                  style={{ flex: 1 }}
                  refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}>

                  {activityItems.length === 0 ? (
                    <View style={S.empty}>
                      <Text style={S.emptyIco}>📋</Text>
                      <Text style={S.emptyTitle}>No activity yet</Text>
                      <Text style={S.emptyTxt}>Medication events will appear here as they happen.</Text>
                    </View>
                  ) : (
                    Object.entries(actGrouped).map(([key, elderItems]) => {
                      const elderName = key.split(':')[1];
                      return (
                        <View key={key}>
                          {/* Elder section header */}
                          <View style={S.elderHdr}>
                            <View style={S.elderHdrLeft}>
                              <Text style={S.elderHdrIco}>👤</Text>
                              <Text style={S.elderHdrName}>{elderName}</Text>
                            </View>
                            <View style={[S.elderHdrBadge, { backgroundColor: colors.primary }]}>
                              <Text style={S.elderHdrBadgeTxt}>{elderItems.length} events</Text>
                            </View>
                          </View>

                          {elderItems.map(item => {
                            const meta = getActivityMeta(item);
                            return (
                              <View key={`${item.source}-${item.id}`}
                                style={[S.actCard, { borderLeftColor: meta.color }]}>
                                {/* Color strip */}
                                <View style={[S.actStrip, { backgroundColor: meta.bg }]}>
                                  <Text style={[S.actStripLabel, { color: meta.color }]}>
                                    {meta.icon} {meta.label}
                                  </Text>
                                  <Text style={S.actStripTime}>{fmtEventTime(item.event_time)}</Text>
                                </View>
                                {/* Body */}
                                <View style={S.actBody}>
                                  <View style={S.actTitleRow}>
                                    <Text style={S.actTypeIcon}>{typeIcons[item.type] || '📋'}</Text>
                                    <Text style={S.actTitle}>{item.title}</Text>
                                  </View>
                                  {item.dosage ? (
                                    <Text style={S.actDosage}>💊 {item.dosage}</Text>
                                  ) : null}
                                  <Text style={S.actMeta}>
                                    🕐 Scheduled {fmtTime(item.scheduled_time)}
                                  </Text>
                                  {item.response_note ? (
                                    <Text style={S.actNote}>💬 "{item.response_note}"</Text>
                                  ) : null}
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
            </View>
          )}
        </>
      )}
    </SafeAreaView>
  );
};

// ── Styles ────────────────────────────────────────────────────────────────────
const S = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },

  header:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingBottom: 14, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.border },
  headerSup:   { fontSize: 11, color: colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.6 },
  headerTitle: { fontSize: 22, fontWeight: '800', color: colors.textPrimary, marginTop: 2 },

  badge:         { alignItems: 'center', backgroundColor: '#f0f0f0', padding: 10, borderRadius: 12 },
  badgeAlert:    { backgroundColor: '#ffe0e0' },
  badgeNum:      { fontSize: 22, fontWeight: '800', color: colors.textSecondary },
  badgeNumAlert: { color: '#d63031' },
  badgeLbl:      { fontSize: 10, color: colors.textSecondary },
  badgeLblAlert: { color: '#d63031' },

  // Tabs
  tabBar:       { flexDirection: 'row', backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.border },
  tab:          { flex: 1, paddingVertical: 14, alignItems: 'center', borderBottomWidth: 3, borderBottomColor: 'transparent' },
  tabActive:    { borderBottomColor: '#d63031' },
  tabTxt:       { fontSize: 13, fontWeight: '600', color: colors.textSecondary },
  tabTxtActive: { color: '#d63031', fontWeight: '700' },

  warningBanner:    { backgroundColor: '#ffe0e0', padding: 14, borderBottomWidth: 1, borderBottomColor: '#ffcccc' },
  warningBannerTxt: { fontSize: 13, color: '#d63031', fontWeight: '600', lineHeight: 18 },

  // Day filter
  dayFilterRow:       { flexDirection: 'row', gap: 8, padding: 12, backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.border },
  dayFilterBtn:       { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white },
  dayFilterBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  dayFilterTxt:       { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
  dayFilterTxtActive: { color: '#fff' },

  center:  { flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 60 },
  loadTxt: { marginTop: 12, color: colors.textSecondary },

  empty:      { alignItems: 'center', paddingVertical: 80, paddingHorizontal: 40 },
  emptyIco:   { fontSize: 72, marginBottom: 16 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: colors.textPrimary, marginBottom: 8 },
  emptyTxt:   { fontSize: 13, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },

  // Elder section header
  elderHdr:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#f5f5f5' },
  elderHdrLeft:    { flexDirection: 'row', alignItems: 'center', gap: 8 },
  elderHdrIco:     { fontSize: 16 },
  elderHdrName:    { fontSize: 14, fontWeight: '700', color: colors.textPrimary },
  elderHdrBadge:   { backgroundColor: '#d63031', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12 },
  elderHdrBadgeTxt:{ fontSize: 11, fontWeight: '700', color: '#fff' },

  // Overdue card
  card:             { backgroundColor: colors.white, marginHorizontal: 16, marginBottom: 10, marginTop: 2, borderRadius: 14, overflow: 'hidden', elevation: 2, shadowColor: '#d63031', shadowOpacity: 0.15, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  overdueStrip:     { backgroundColor: '#d63031', paddingVertical: 7, paddingHorizontal: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  overdueStripTxt:  { fontSize: 12, fontWeight: '800', color: '#fff' },
  overdueStripTime: { fontSize: 11, color: 'rgba(255,255,255,0.85)' },
  cardBody:         { padding: 14 },
  cardTop:          { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  typePill:         { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  typePillTxt:      { fontSize: 11, fontWeight: '700' },
  scheduledTimePill:{ backgroundColor: '#f0f0f0', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  scheduledTimeTxt: { fontSize: 11, color: colors.textSecondary },
  cardTitle:        { fontSize: 16, fontWeight: '800', color: colors.textPrimary, marginBottom: 3 },
  cardDosage:       { fontSize: 12, color: '#a29bfe', fontWeight: '600', marginBottom: 6 },
  cardFooter:       { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border },
  cardFooterTxt:    { fontSize: 11, color: '#d63031', fontStyle: 'italic' },

  // Activity cards
  actCard:       { backgroundColor: colors.white, marginHorizontal: 16, marginBottom: 8, marginTop: 2, borderRadius: 12, overflow: 'hidden', borderLeftWidth: 4, elevation: 1, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
  actStrip:      { paddingHorizontal: 12, paddingVertical: 7, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  actStripLabel: { fontSize: 12, fontWeight: '700', flex: 1, marginRight: 8 },
  actStripTime:  { fontSize: 11, color: colors.textSecondary },
  actBody:       { padding: 12 },
  actTitleRow:   { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  actTypeIcon:   { fontSize: 18 },
  actTitle:      { fontSize: 15, fontWeight: '700', color: colors.textPrimary, flex: 1 },
  actDosage:     { fontSize: 12, color: '#a29bfe', fontWeight: '600', marginBottom: 3 },
  actMeta:       { fontSize: 11, color: colors.textSecondary },
  actNote:       { fontSize: 12, color: colors.textSecondary, marginTop: 5, fontStyle: 'italic' },
});

export default CaregiverOverdueScreen;