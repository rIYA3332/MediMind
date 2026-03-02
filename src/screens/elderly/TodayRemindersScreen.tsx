// screens/elder/TodayRemindersScreen.tsx
// Elder view: shows today's schedule, handles responses, registers push token.

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl, ActivityIndicator, Modal, TextInput, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { colors } from '../../styles/colors';
import { getApiUrl } from '../../config/api';

// ─────────────────────────── push setup ──────────────────────────────────────
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert:  true,
    shouldPlaySound:  true,
    shouldSetBadge:   true,
    shouldShowBanner: true,
    shouldShowList:   true,
  }),
});
async function registerForPushNotifications(userId: number) {
  if (!Device.isDevice) return; // won't work in simulator
  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;
  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') return;

  const tokenData = await Notifications.getExpoPushTokenAsync();
  const token = tokenData.data;

  // Save token to backend
  try {
    await fetch(getApiUrl('/api/push-token'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, token }),
    });
  } catch (e) { console.log('Push token save failed', e); }
}

// ─────────────────────────── types ───────────────────────────────────────────
type Status       = 'pending' | 'done' | 'skipped' | 'overdue';
type ScheduleType = 'medicine' | 'appointment' | 'routine' | 'reminder';

interface ScheduleItem {
  id: number;
  type: ScheduleType;
  title: string;
  description?: string;
  dosage?: string;
  scheduled_time: string;
  caregiver_name: string;
  repeat_interval: number;
  max_reminders: number;
  log_id?: number;
  log_status?: Status;
  is_overdue?: number;
  reminded_count?: number;
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
  return `${h % 12 || 12}:${String(m).padStart(2,'0')} ${h >= 12 ? 'PM' : 'AM'}`;
};

const todayLabel = () =>
  new Date().toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' });

// ─────────────────────────── component ───────────────────────────────────────
const TodayRemindersScreen = ({ navigation }: any) => {
  const [elder,      setElder]      = useState<any>(null);
  const [items,      setItems]      = useState<ScheduleItem[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // respond modal
  const [activeItem,  setActiveItem]  = useState<ScheduleItem | null>(null);
  const [pendingStatus, setPendingStatus] = useState<Status>('done'); // which button was tapped
  const [note,        setNote]        = useState('');
  const [submitting,  setSubmitting]  = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── init ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem('user');
        if (stored) {
          const user = JSON.parse(stored);
          setElder(user);
          await load(user.id);
          // Register for push notifications
          await registerForPushNotifications(user.id);
        }
      } catch (e) { console.log('Init error', e); }
      finally { setLoading(false); }
    })();
  }, []);

  // Handle notification tap — navigate to this screen
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(response => {
      const data = response.notification.request.content.data as any;
      if (data?.screen === 'TodayReminders') {
        if (elder?.id) load(elder.id);
      }
    });
    return () => sub.remove();
  }, [elder?.id]);

  // Poll every 60s
  useEffect(() => {
    if (!elder?.id) return;
    pollRef.current = setInterval(() => load(elder.id, true), 60_000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [elder?.id]);

  const load = useCallback(async (elderId: number, silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res  = await fetch(getApiUrl(`/api/schedules/today/${elderId}`));
      const data = await res.json();
      const sorted = (Array.isArray(data) ? data : []).sort((a: ScheduleItem, b: ScheduleItem) => {
        // Order: overdue first → pending → done/skipped
        const rank = (s: ScheduleItem) => {
          if (s.is_overdue || s.log_status === 'overdue') return 0;
          if (!s.log_status || s.log_status === 'pending') return 1;
          return 2;
        };
        if (rank(a) !== rank(b)) return rank(a) - rank(b);
        return a.scheduled_time.localeCompare(b.scheduled_time);
      });
      setItems(sorted);
    } catch (e) { console.log('Load error', e); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  const onRefresh = () => { setRefreshing(true); if (elder?.id) load(elder.id); };

  // ── open respond modal ────────────────────────────────────────────────────
  const openRespond = (item: ScheduleItem, status: Status) => {
    setActiveItem(item);
    setPendingStatus(status);
    setNote('');
  };

  // ── submit response ───────────────────────────────────────────────────────
  const respond = async (status: Status) => {
    if (!activeItem || !elder) return;
    setSubmitting(true);
    try {
      const res = await fetch(getApiUrl('/api/schedules/respond'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheduleId:    activeItem.id,
          elderId:       elder.id,
          status,
          responseNote:  note.trim() || null,
          scheduledDate: new Date().toISOString().split('T')[0],
        }),
      });
      if (!res.ok) { Alert.alert('Error', 'Failed to submit response.'); return; }
      setActiveItem(null);
      setNote('');
      await load(elder.id);
    } catch { Alert.alert('Error', 'Please try again.'); }
    finally { setSubmitting(false); }
  };

  // ── counts ────────────────────────────────────────────────────────────────
  const overdue = items.filter(i => i.is_overdue || i.log_status === 'overdue').length;
  const pending = items.filter(i => !i.log_status || i.log_status === 'pending').length;
  const done    = items.filter(i => i.log_status === 'done').length;
  const skipped = items.filter(i => i.log_status === 'skipped').length;

  // ─────────────────────────── render ──────────────────────────────────────
  return (
    <SafeAreaView style={S.screen}>

      {/* ── Header ── */}
      <View style={S.header}>
        <View>
          <Text style={S.headerDate}>{todayLabel()}</Text>
          <Text style={S.headerTitle}>Today's Schedule</Text>
        </View>
        {overdue > 0
          ? <View style={[S.headerBadge, { backgroundColor: '#ffe0e0' }]}>
              <Text style={[S.headerBadgeNum, { color: '#d63031' }]}>{overdue}</Text>
              <Text style={[S.headerBadgeLbl, { color: '#d63031' }]}>overdue</Text>
            </View>
          : <View style={S.headerBadge}>
              <Text style={S.headerBadgeNum}>{pending}</Text>
              <Text style={S.headerBadgeLbl}>pending</Text>
            </View>
        }
      </View>

      {/* ── Progress strip ── */}
      {items.length > 0 && (
        <View style={S.progressWrap}>
          <View style={S.progressTrack}>
            <View style={[S.progressFill, { width: `${Math.round((done / items.length) * 100)}%` as any }]} />
          </View>
          <Text style={S.progressTxt}>{done}/{items.length} completed · {skipped} skipped · {overdue} overdue</Text>
        </View>
      )}

      {/* ── Summary pills ── */}
      <View style={S.pillRow}>
        <View style={[S.pill, { backgroundColor: '#fff3e6' }]}>
          <Text style={[S.pillNum, { color: '#e17055' }]}>{pending}</Text>
          <Text style={S.pillLbl}>Pending</Text>
        </View>
        <View style={[S.pill, { backgroundColor: '#d4faf0' }]}>
          <Text style={[S.pillNum, { color: '#00b894' }]}>{done}</Text>
          <Text style={S.pillLbl}>Done</Text>
        </View>
        <View style={[S.pill, { backgroundColor: '#f0f0f0' }]}>
          <Text style={[S.pillNum, { color: '#636e72' }]}>{skipped}</Text>
          <Text style={S.pillLbl}>Skipped</Text>
        </View>
        <View style={[S.pill, { backgroundColor: overdue > 0 ? '#ffe0e0' : '#f0f0f0' }]}>
          <Text style={[S.pillNum, { color: '#d63031' }]}>{overdue}</Text>
          <Text style={S.pillLbl}>Overdue</Text>
        </View>
      </View>

      {loading ? (
        <View style={S.center}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={S.loadTxt}>Loading today's schedule…</Text>
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}>

          {items.length === 0 ? (
            <View style={S.empty}>
              <Text style={S.emptyIco}>🎉</Text>
              <Text style={S.emptyTitle}>Nothing scheduled today</Text>
              <Text style={S.emptyTxt}>Your caregiver hasn't scheduled any tasks for today yet.</Text>
            </View>
          ) : (
            items.map(item => {
              const c        = TYPE_CONFIG[item.type];
              const isDone   = item.log_status === 'done';
              const isSkip   = item.log_status === 'skipped';
              const isOver   = !!(item.is_overdue || item.log_status === 'overdue');
              const isPend   = !isDone && !isSkip && !isOver;

              return (
                <View key={item.id} style={[
                  S.card,
                  isDone && S.cardDone,
                  isSkip && S.cardSkip,
                  isOver && S.cardOverdue,
                  { borderLeftColor: isOver ? '#d63031' : c.color },
                ]}>
                  {/* time badge */}
                  <View style={[S.timeBadge, { backgroundColor: isOver ? '#d63031' : c.color }]}>
                    <Text style={S.timeBadgeTxt}>{fmtTime(item.scheduled_time)}</Text>
                  </View>

                  <View style={S.cardBody}>
                    <View style={S.cardTop}>
                      <View style={[S.typePill, { backgroundColor: c.color + '18' }]}>
                        <Text style={[S.typePillTxt, { color: c.color }]}>{c.icon} {c.label}</Text>
                      </View>

                      {/* status badges */}
                      {isDone && <View style={S.doneBadge}><Text style={S.doneBadgeTxt}>✅ Done</Text></View>}
                      {isSkip && <View style={S.skipBadge}><Text style={S.skipBadgeTxt}>⏭ Skipped</Text></View>}
                      {isOver && <View style={S.overdueBadge}><Text style={S.overdueBadgeTxt}>🚨 OVERDUE</Text></View>}
                      {isPend && item.reminded_count && item.reminded_count > 0
                        ? <View style={S.remindedBadge}>
                            <Text style={S.remindedBadgeTxt}>
                              🔔 Reminded {item.reminded_count}/{item.max_reminders}
                            </Text>
                          </View>
                        : null}
                    </View>

                    <Text style={[S.cardTitle, (isDone || isSkip) && S.cardTitleFaded]}>{item.title}</Text>
                    {item.dosage      && <Text style={S.cardDosage}>💊 {item.dosage}</Text>}
                    {item.description && <Text style={S.cardDesc}>{item.description}</Text>}
                    <Text style={S.cardCG}>Scheduled by: {item.caregiver_name}</Text>

                    {/* OVERDUE — still let elder respond */}
                    {isOver && (
                      <View style={S.overdueBox}>
                        <Text style={S.overdueBoxTxt}>
                          ⚠️ This task is overdue. Your caregiver has been notified. You can still mark it as done below.
                        </Text>
                        <View style={S.actionRow}>
                          <TouchableOpacity style={S.doneBtn} onPress={() => openRespond(item, 'done')}>
                            <Text style={S.doneBtnTxt}>✅  I Did It</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={S.skipBtn} onPress={() => openRespond(item, 'skipped')}>
                            <Text style={S.skipBtnTxt}>⏭  Skip</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    )}

                    {/* PENDING — normal action buttons */}
                    {isPend && (
                      <View style={S.actionRow}>
                        <TouchableOpacity style={S.doneBtn} onPress={() => openRespond(item, 'done')}>
                          <Text style={S.doneBtnTxt}>✅  Mark as Done</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={S.skipBtn} onPress={() => openRespond(item, 'skipped')}>
                          <Text style={S.skipBtnTxt}>⏭  Skip</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                </View>
              );
            })
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      )}

      {/* ── Respond modal ── */}
      {activeItem && (
        <Modal visible={!!activeItem} transparent animationType="slide">
          <View style={S.modalOverlay}>
            <View style={S.modalBox}>
              {activeItem.is_overdue
                ? <View style={S.modalOverdueTag}><Text style={S.modalOverdueTagTxt}>🚨 Overdue Task</Text></View>
                : null}
              <Text style={S.modalTitle}>
                {TYPE_CONFIG[activeItem.type].icon} {activeItem.title}
              </Text>
              {activeItem.dosage && (
                <Text style={S.modalDosage}>💊 {activeItem.dosage}</Text>
              )}
              <Text style={S.modalPrompt}>Add a note (optional)</Text>
              <TextInput
                style={S.modalInput}
                value={note}
                onChangeText={setNote}
                placeholder="e.g. Took with meal, felt fine…"
                placeholderTextColor={colors.textSecondary}
                multiline />

              <View style={S.modalBtns}>
                <TouchableOpacity
                  style={S.modalDoneBtn}
                  onPress={() => respond('done')}
                  disabled={submitting}>
                  {submitting && pendingStatus === 'done'
                    ? <ActivityIndicator color="#fff" />
                    : <Text style={S.modalDoneBtnTxt}>✅  Done – I did it!</Text>}
                </TouchableOpacity>
                <TouchableOpacity
                  style={S.modalSkipBtn}
                  onPress={() => respond('skipped')}
                  disabled={submitting}>
                  <Text style={S.modalSkipBtnTxt}>⏭  Skip this time</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={S.modalCancelBtn}
                  onPress={() => setActiveItem(null)}
                  disabled={submitting}>
                  <Text style={S.modalCancelBtnTxt}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </SafeAreaView>
  );
};

// ─────────────────────────── styles ──────────────────────────────────────────
const S = StyleSheet.create({
  screen: { flex:1, backgroundColor:colors.background },

  header:        { flexDirection:'row', justifyContent:'space-between', alignItems:'center', padding:20, backgroundColor:colors.white, borderBottomWidth:1, borderBottomColor:colors.border },
  headerDate:    { fontSize:12, color:colors.textSecondary },
  headerTitle:   { fontSize:22, fontWeight:'800', color:colors.textPrimary, marginTop:2 },
  headerBadge:   { alignItems:'center', backgroundColor:'#fff3e6', padding:10, borderRadius:12 },
  headerBadgeNum:{ fontSize:22, fontWeight:'800', color:'#e17055' },
  headerBadgeLbl:{ fontSize:10, color:'#e17055' },

  progressWrap: { backgroundColor:colors.white, paddingHorizontal:20, paddingBottom:10, paddingTop:6 },
  progressTrack:{ height:6, backgroundColor:'#e0e0e0', borderRadius:3, overflow:'hidden' },
  progressFill: { height:'100%', backgroundColor:'#00b894', borderRadius:3 },
  progressTxt:  { fontSize:11, color:colors.textSecondary, marginTop:4 },

  pillRow: { flexDirection:'row', gap:8, paddingHorizontal:16, paddingVertical:10, backgroundColor:colors.white, borderBottomWidth:1, borderBottomColor:colors.border },
  pill:    { flex:1, alignItems:'center', paddingVertical:8, borderRadius:12 },
  pillNum: { fontSize:18, fontWeight:'800' },
  pillLbl: { fontSize:10, color:colors.textSecondary, marginTop:1 },

  center:  { flex:1, justifyContent:'center', alignItems:'center' },
  loadTxt: { marginTop:12, color:colors.textSecondary },
  empty:   { alignItems:'center', paddingVertical:80, paddingHorizontal:40 },
  emptyIco:  { fontSize:72, marginBottom:16 },
  emptyTitle:{ fontSize:20, fontWeight:'700', color:colors.textPrimary, marginBottom:8 },
  emptyTxt:  { fontSize:13, color:colors.textSecondary, textAlign:'center', lineHeight:20 },

  card:        { backgroundColor:colors.white, marginHorizontal:16, marginTop:10, borderRadius:16, borderLeftWidth:5, overflow:'hidden', elevation:2, shadowColor:'#000', shadowOpacity:0.06, shadowRadius:6, shadowOffset:{width:0,height:2} },
  cardDone:    { opacity: 0.75 },
  cardSkip:    { opacity: 0.60 },
  cardOverdue: { borderWidth:1, borderColor:'#d63031', borderLeftWidth:5 },
  timeBadge:   { paddingVertical:6, paddingHorizontal:14, alignSelf:'flex-start' },
  timeBadgeTxt:{ fontSize:13, color:'#fff', fontWeight:'700' },
  cardBody:    { padding:14 },
  cardTop:     { flexDirection:'row', alignItems:'center', flexWrap:'wrap', gap:6, marginBottom:8 },
  typePill:    { paddingHorizontal:8, paddingVertical:3, borderRadius:8 },
  typePillTxt: { fontSize:11, fontWeight:'700' },

  doneBadge:     { backgroundColor:'#d4faf0', paddingHorizontal:8, paddingVertical:3, borderRadius:8 },
  doneBadgeTxt:  { fontSize:11, fontWeight:'700', color:'#00b894' },
  skipBadge:     { backgroundColor:'#f0f0f0', paddingHorizontal:8, paddingVertical:3, borderRadius:8 },
  skipBadgeTxt:  { fontSize:11, fontWeight:'700', color:'#636e72' },
  overdueBadge:  { backgroundColor:'#ffe0e0', paddingHorizontal:8, paddingVertical:3, borderRadius:8 },
  overdueBadgeTxt:{ fontSize:11, fontWeight:'800', color:'#d63031' },
  remindedBadge: { backgroundColor:'#fff8e1', paddingHorizontal:8, paddingVertical:3, borderRadius:8 },
  remindedBadgeTxt:{ fontSize:11, fontWeight:'600', color:'#f39c12' },

  cardTitle:      { fontSize:17, fontWeight:'800', color:colors.textPrimary, marginBottom:3 },
  cardTitleFaded: { color:colors.textSecondary },
  cardDosage:     { fontSize:13, color:'#a29bfe', fontWeight:'600', marginBottom:3 },
  cardDesc:       { fontSize:13, color:colors.textSecondary, marginBottom:6, lineHeight:18 },
  cardCG:         { fontSize:11, color:colors.textSecondary, marginTop:4 },

  overdueBox:    { backgroundColor:'#fff5f5', borderRadius:10, padding:10, marginTop:10, borderWidth:1, borderColor:'#ffcccc' },
  overdueBoxTxt: { fontSize:12, color:'#d63031', lineHeight:18, marginBottom:10 },

  actionRow:  { flexDirection:'row', gap:10, marginTop:12 },
  doneBtn:    { flex:2, backgroundColor:'#00b894', paddingVertical:12, borderRadius:12, alignItems:'center' },
  doneBtnTxt: { color:'#fff', fontSize:14, fontWeight:'700' },
  skipBtn:    { flex:1, backgroundColor:'#f0f0f0', paddingVertical:12, borderRadius:12, alignItems:'center' },
  skipBtnTxt: { color:'#636e72', fontSize:13, fontWeight:'600' },

  modalOverlay:     { flex:1, backgroundColor:'rgba(0,0,0,0.5)', justifyContent:'flex-end' },
  modalBox:         { backgroundColor:'#fff', borderTopLeftRadius:24, borderTopRightRadius:24, padding:24 },
  modalOverdueTag:  { backgroundColor:'#ffe0e0', alignSelf:'flex-start', paddingHorizontal:10, paddingVertical:4, borderRadius:8, marginBottom:8 },
  modalOverdueTagTxt:{ fontSize:12, fontWeight:'800', color:'#d63031' },
  modalTitle:       { fontSize:20, fontWeight:'800', color:colors.textPrimary, marginBottom:4 },
  modalDosage:      { fontSize:13, color:'#a29bfe', fontWeight:'600', marginBottom:12 },
  modalPrompt:      { fontSize:13, fontWeight:'600', color:colors.textSecondary, marginBottom:6 },
  modalInput:       { borderWidth:1, borderColor:colors.border, borderRadius:12, padding:12, fontSize:14, color:colors.textPrimary, minHeight:80, textAlignVertical:'top', marginBottom:16 },
  modalBtns:        { gap:10 },
  modalDoneBtn:     { backgroundColor:'#00b894', paddingVertical:15, borderRadius:14, alignItems:'center' },
  modalDoneBtnTxt:  { color:'#fff', fontSize:16, fontWeight:'700' },
  modalSkipBtn:     { backgroundColor:'#f0f0f0', paddingVertical:13, borderRadius:14, alignItems:'center' },
  modalSkipBtnTxt:  { color:'#636e72', fontSize:15, fontWeight:'600' },
  modalCancelBtn:   { paddingVertical:10, alignItems:'center' },
  modalCancelBtnTxt:{ color:colors.textSecondary, fontSize:14 },
});

export default TodayRemindersScreen;