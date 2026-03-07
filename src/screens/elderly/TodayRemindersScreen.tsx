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
  } catch (e) { console.log('Push token save failed', e); }
}

type Status       = 'pending' | 'done' | 'not_taken' | 'skipped' | 'overdue';
type ScheduleType = 'medicine' | 'appointment' | 'routine' | 'reminder';
type VisualState  = 'upcoming' | 'pending' | 'reminded' | 'taken' | 'not_taken' | 'overdue';

interface ScheduleItem {
  id:              number;
  type:            ScheduleType;
  title:           string;
  description?:    string;
  dosage?:         string;
  scheduled_time:  string;
  caregiver_name:  string;
  repeat_interval: number;
  max_reminders:   number;
  log_id?:         number;
  log_status?:     Status;
  is_overdue?:     number;
  reminded_count?: number;
}

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

function computeVisualState(item: ScheduleItem): VisualState {
  if (item.log_status === 'done') return 'taken';
  if (item.log_status === 'not_taken' || item.log_status === 'skipped') return 'not_taken';

  const now = new Date();
  const [hh, mm] = item.scheduled_time.split(':').map(Number);
  const scheduled = new Date();
  scheduled.setHours(hh, mm, 0, 0);

  const diffMins = (now.getTime() - scheduled.getTime()) / 60000;
  if (diffMins < 0) return 'upcoming';

  const interval   = item.repeat_interval > 0 ? item.repeat_interval : 30;
  const maxRemind  = item.max_reminders   > 0 ? item.max_reminders   : 1;
  const windowMins = interval * maxRemind;

  if (diffMins <= windowMins) {
    return (item.reminded_count ?? 0) > 0 ? 'reminded' : 'pending';
  }
  return 'overdue';
}

const TodayRemindersScreen = ({ navigation }: any) => {
  const [elder,      setElder]      = useState<any>(null);
  const [items,      setItems]      = useState<ScheduleItem[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Modal is ONLY used for "Taken" confirmation + optional note
  const [activeItem, setActiveItem] = useState<ScheduleItem | null>(null);
  const [note,       setNote]       = useState('');
  const [submitting, setSubmitting] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem('user');
        if (stored) {
          const user = JSON.parse(stored);
          setElder(user);
          await load(user.id);
          await registerForPushNotifications(user.id);
        }
      } catch (e) { console.log('Init error', e); }
      finally { setLoading(false); }
    })();
  }, []);

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(response => {
      const data = response.notification.request.content.data as any;
      if (data?.screen === 'TodayReminders' && elder?.id) load(elder.id);
    });
    return () => sub.remove();
  }, [elder?.id]);

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
        const order: Record<VisualState, number> = {
          overdue: 0, reminded: 1, pending: 2, not_taken: 3, upcoming: 4, taken: 5,
        };
        const va = computeVisualState(a);
        const vb = computeVisualState(b);
        if (order[va] !== order[vb]) return order[va] - order[vb];
        return a.scheduled_time.localeCompare(b.scheduled_time);
      });

      setItems(sorted);
    } catch (e) { console.log('Load error', e); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  const onRefresh = () => { setRefreshing(true); if (elder?.id) load(elder.id); };

  // CHANGE 1: confirmTaken — used by modal, submits status 'done'
  const confirmTaken = async () => {
    if (!activeItem || !elder) return;
    setSubmitting(true);
    try {
      const res = await fetch(getApiUrl('/api/schedules/respond'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheduleId:    activeItem.id,
          elderId:       elder.id,
          status:        'done',
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

  // CHANGE 2: quickNotTaken — inline, NO modal, submits 'not_taken' directly
  // Backend will re-schedule the next reminder as per caregiver's interval
  const quickNotTaken = async (item: ScheduleItem) => {
    if (!elder) return;
    try {
      await fetch(getApiUrl('/api/schedules/respond'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scheduleId:    item.id,
          elderId:       elder.id,
          status:        'not_taken',
          responseNote:  null,
          scheduledDate: new Date().toISOString().split('T')[0],
        }),
      });
      await load(elder.id);
    } catch { Alert.alert('Error', 'Please try again.'); }
  };

  const visualStates = items.map(computeVisualState);
  const countOf = (vs: VisualState) => visualStates.filter(v => v === vs).length;

  const numOverdue  = countOf('overdue');
  const numPending  = countOf('pending') + countOf('reminded') + countOf('not_taken');
  const numUpcoming = countOf('upcoming');
  const numTaken    = countOf('taken');
  const total       = items.length;

  return (
    <SafeAreaView style={S.screen}>

      <View style={S.header}>
        <View>
          <Text style={S.headerDate}>{todayLabel()}</Text>
          <Text style={S.headerTitle}>Today's Schedule</Text>
        </View>
        {numOverdue > 0
          ? <View style={[S.headerBadge, { backgroundColor: '#ffe0e0' }]}>
              <Text style={[S.headerBadgeNum, { color: '#d63031' }]}>{numOverdue}</Text>
              <Text style={[S.headerBadgeLbl, { color: '#d63031' }]}>overdue</Text>
            </View>
          : <View style={S.headerBadge}>
              <Text style={S.headerBadgeNum}>{numPending}</Text>
              <Text style={S.headerBadgeLbl}>pending</Text>
            </View>
        }
      </View>

      {total > 0 && (
        <View style={S.progressWrap}>
          <View style={S.progressTrack}>
            <View style={[S.progressFill, { width: `${Math.round((numTaken / total) * 100)}%` as any }]} />
          </View>
          <Text style={S.progressTxt}>
            {numTaken}/{total} taken · {numUpcoming} upcoming · {numOverdue} overdue
          </Text>
        </View>
      )}

      <View style={S.pillRow}>
        {[
          { num: numUpcoming, label: 'Upcoming', bg: '#e8f4ff',  clr: '#0984e3' },
          { num: numPending,  label: 'Pending',  bg: '#fff3e6',  clr: '#e17055' },
          { num: numTaken,    label: 'Taken',    bg: '#d4faf0',  clr: '#00b894' },
          { num: numOverdue,  label: 'Overdue',  bg: numOverdue > 0 ? '#ffe0e0' : '#f0f0f0', clr: '#d63031' },
        ].map(p => (
          <View key={p.label} style={[S.pill, { backgroundColor: p.bg }]}>
            <Text style={[S.pillNum, { color: p.clr }]}>{p.num}</Text>
            <Text style={S.pillLbl}>{p.label}</Text>
          </View>
        ))}
      </View>

      {loading ? (
        <View style={S.center}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={S.loadTxt}>Loading today's schedule…</Text>
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        >
          {items.length === 0 ? (
            <View style={S.empty}>
              <Text style={S.emptyIco}>🎉</Text>
              <Text style={S.emptyTitle}>Nothing scheduled today</Text>
              <Text style={S.emptyTxt}>Your caregiver hasn't scheduled any tasks yet.</Text>
            </View>
          ) : (
            items.map(item => {
              const c  = TYPE_CONFIG[item.type];
              const vs = computeVisualState(item);

              const interval = item.repeat_interval > 0 ? item.repeat_interval : 30;
              const maxR     = item.max_reminders   > 0 ? item.max_reminders   : 1;
              const reminded = item.reminded_count  || 0;

              const [hh2, mm2]      = item.scheduled_time.split(':').map(Number);
              const nextReminderMin = hh2 * 60 + mm2 + (reminded + 1) * interval;
              const nextH           = Math.floor(nextReminderMin / 60) % 24;
              const nextM           = nextReminderMin % 60;
              const nextReminderLabel =
                `${nextH % 12 || 12}:${String(nextM).padStart(2,'0')} ${nextH >= 12 ? 'PM' : 'AM'}`;

              const cardBorderColor =
                vs === 'overdue'   ? '#d63031' :
                vs === 'taken'     ? '#00b894' :
                vs === 'not_taken' ? '#e17055' :
                vs === 'upcoming'  ? '#74b9ff' :
                vs === 'reminded'  ? '#fdcb6e' : c.color;

              return (
                <View key={item.id} style={[
                  S.card,
                  vs === 'taken'     && S.cardTaken,
                  vs === 'not_taken' && S.cardNotTaken,
                  vs === 'overdue'   && S.cardOverdue,
                  vs === 'upcoming'  && S.cardUpcoming,
                  { borderLeftColor: cardBorderColor },
                ]}>

                  <View style={[S.timeBadge, { backgroundColor: cardBorderColor }]}>
                    <Text style={S.timeBadgeTxt}>{fmtTime(item.scheduled_time)}</Text>
                  </View>

                  <View style={S.cardBody}>
                    <View style={S.cardTop}>
                      <View style={[S.typePill, { backgroundColor: c.color + '22' }]}>
                        <Text style={[S.typePillTxt, { color: c.color }]}>{c.icon} {c.label}</Text>
                      </View>
                      {vs === 'upcoming'  && <View style={[S.stateBadge, { backgroundColor: '#dbeeff' }]}><Text style={[S.stateBadgeTxt, { color: '#0984e3' }]}>🕐 Upcoming</Text></View>}
                      {vs === 'pending'   && <View style={[S.stateBadge, { backgroundColor: '#fff3e6' }]}><Text style={[S.stateBadgeTxt, { color: '#e17055' }]}>⏳ Pending</Text></View>}
                      {vs === 'reminded'  && <View style={[S.stateBadge, { backgroundColor: '#fff8e1' }]}><Text style={[S.stateBadgeTxt, { color: '#f39c12' }]}>🔔 Reminded {reminded}/{maxR}</Text></View>}
                      {vs === 'taken'     && <View style={[S.stateBadge, { backgroundColor: '#d4faf0' }]}><Text style={[S.stateBadgeTxt, { color: '#00b894' }]}>✅ Taken</Text></View>}
                      {vs === 'not_taken' && <View style={[S.stateBadge, { backgroundColor: '#fff0e8' }]}><Text style={[S.stateBadgeTxt, { color: '#e17055' }]}>❌ Not Taken</Text></View>}
                      {vs === 'overdue'   && <View style={[S.stateBadge, { backgroundColor: '#ffe0e0' }]}><Text style={[S.stateBadgeTxt, { color: '#d63031' }]}>🚨 Overdue</Text></View>}
                    </View>

                    <Text style={[S.cardTitle, vs === 'taken' && S.cardTitleFaded]}>{item.title}</Text>
                    {item.dosage      && <Text style={S.cardDosage}>💊 {item.dosage}</Text>}
                    {item.description && <Text style={S.cardDesc}>{item.description}</Text>}
                    <Text style={S.cardCG}>Scheduled by: {item.caregiver_name}</Text>

                    {vs === 'upcoming' && (
                      <View style={S.infoBox}>
                        <Text style={S.infoBoxTxt}>
                          ⏰ Scheduled for {fmtTime(item.scheduled_time)} — you'll be reminded then.
                        </Text>
                      </View>
                    )}

                    {(vs === 'pending' || vs === 'reminded') && (
                      <>
                        {vs === 'reminded' && (
                          <View style={S.reminderInfoBox}>
                            <Text style={S.reminderInfoTxt}>
                              🔔 Reminder {reminded} of {maxR} sent.
                              {reminded < maxR
                                ? ` Next reminder at ${nextReminderLabel}.`
                                : ' This was the last reminder.'}
                            </Text>
                          </View>
                        )}
                        <View style={S.actionRow}>
                          {/* Taken → opens modal for optional note */}
                          <TouchableOpacity style={S.takenBtn} onPress={() => setActiveItem(item)}>
                            <Text style={S.takenBtnTxt}>✅  Taken</Text>
                          </TouchableOpacity>
                          {/* CHANGE 2: Not Taken → direct submit, NO modal */}
                          <TouchableOpacity style={S.notTakenBtn} onPress={() => quickNotTaken(item)}>
                            <Text style={S.notTakenBtnTxt}>❌  Not Taken</Text>
                          </TouchableOpacity>
                        </View>
                        <Text style={S.notTakenHint}>
                          Tap "Not Taken" and you'll be reminded again at {nextReminderLabel}.
                        </Text>
                      </>
                    )}

                    {vs === 'not_taken' && (
                      <View style={S.notTakenBox}>
                        <Text style={S.notTakenBoxTxt}>
                          You marked this as not taken.
                          {reminded < maxR
                            ? ` You'll be reminded again at ${nextReminderLabel}.`
                            : ' All reminders have been sent. Please take it when you can.'}
                        </Text>
                        <TouchableOpacity style={[S.takenBtn, { marginTop: 10 }]} onPress={() => setActiveItem(item)}>
                          <Text style={S.takenBtnTxt}>✅  Mark as Taken Now</Text>
                        </TouchableOpacity>
                      </View>
                    )}

                    {vs === 'overdue' && (
                      <View style={S.overdueBox}>
                        <Text style={S.overdueBoxTxt}>
                          ⚠️ All {maxR} reminder{maxR !== 1 ? 's' : ''} sent. Your caregiver has been notified.
                          You can still mark it as taken below.
                        </Text>
                        <TouchableOpacity style={[S.takenBtn, { marginTop: 10 }]} onPress={() => setActiveItem(item)}>
                          <Text style={S.takenBtnTxt}>✅  Mark as Taken</Text>
                        </TouchableOpacity>
                      </View>
                    )}

                    {vs === 'taken' && (
                      <View style={S.takenBox}>
                        <Text style={S.takenBoxTxt}>✅ Great job! This has been marked as taken.</Text>
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

      {/* CHANGE 3: Modal only has "Taken" confirm — no "Not Taken" button inside */}
      {activeItem && (
        <Modal visible transparent animationType="slide">
          <View style={S.modalOverlay}>
            <View style={S.modalBox}>

              {computeVisualState(activeItem) === 'overdue' && (
                <View style={S.modalOverdueTag}>
                  <Text style={S.modalOverdueTagTxt}>🚨 Overdue Task</Text>
                </View>
              )}

              <Text style={S.modalTitle}>
                {TYPE_CONFIG[activeItem.type].icon}  {activeItem.title}
              </Text>
              {activeItem.dosage && <Text style={S.modalDosage}>💊 {activeItem.dosage}</Text>}

              {(activeItem.reminded_count || 0) > 0 && (
                <View style={S.modalInfoRow}>
                  <Text style={S.modalInfoTxt}>
                    🔔 Reminded {activeItem.reminded_count}/{activeItem.max_reminders} times
                  </Text>
                </View>
              )}

              <Text style={S.modalPrompt}>Add a note (optional)</Text>
              <TextInput
                style={S.modalInput}
                value={note}
                onChangeText={setNote}
                placeholder="e.g. Took with meal, felt fine…"
                placeholderTextColor={colors.textSecondary}
                multiline
              />

              <View style={S.modalBtns}>
                <TouchableOpacity
                  style={S.modalTakenBtn}
                  onPress={confirmTaken}
                  disabled={submitting}>
                  {submitting
                    ? <ActivityIndicator color="#fff" />
                    : <Text style={S.modalTakenBtnTxt}>✅  Yes, I took it!</Text>}
                </TouchableOpacity>

                <TouchableOpacity
                  style={S.modalCancelBtn}
                  onPress={() => { setActiveItem(null); setNote(''); }}
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

const S = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },

  header:         { flexDirection:'row', justifyContent:'space-between', alignItems:'center', padding:20, backgroundColor:colors.white, borderBottomWidth:1, borderBottomColor:colors.border },
  headerDate:     { fontSize:12, color:colors.textSecondary },
  headerTitle:    { fontSize:22, fontWeight:'800', color:colors.textPrimary, marginTop:2 },
  headerBadge:    { alignItems:'center', backgroundColor:'#fff3e6', padding:10, borderRadius:12 },
  headerBadgeNum: { fontSize:22, fontWeight:'800', color:'#e17055' },
  headerBadgeLbl: { fontSize:10, color:'#e17055' },

  progressWrap:  { backgroundColor:colors.white, paddingHorizontal:20, paddingBottom:10, paddingTop:6 },
  progressTrack: { height:6, backgroundColor:'#e0e0e0', borderRadius:3, overflow:'hidden' },
  progressFill:  { height:'100%', backgroundColor:'#00b894', borderRadius:3 },
  progressTxt:   { fontSize:11, color:colors.textSecondary, marginTop:4 },

  pillRow: { flexDirection:'row', gap:8, paddingHorizontal:16, paddingVertical:10, backgroundColor:colors.white, borderBottomWidth:1, borderBottomColor:colors.border },
  pill:    { flex:1, alignItems:'center', paddingVertical:8, borderRadius:12 },
  pillNum: { fontSize:18, fontWeight:'800' },
  pillLbl: { fontSize:10, color:colors.textSecondary, marginTop:1 },

  center:     { flex:1, justifyContent:'center', alignItems:'center' },
  loadTxt:    { marginTop:12, color:colors.textSecondary },
  empty:      { alignItems:'center', paddingVertical:80, paddingHorizontal:40 },
  emptyIco:   { fontSize:72, marginBottom:16 },
  emptyTitle: { fontSize:20, fontWeight:'700', color:colors.textPrimary, marginBottom:8 },
  emptyTxt:   { fontSize:13, color:colors.textSecondary, textAlign:'center', lineHeight:20 },

  card:        { backgroundColor:colors.white, marginHorizontal:16, marginTop:10, borderRadius:16, borderLeftWidth:5, overflow:'hidden', elevation:2, shadowColor:'#000', shadowOpacity:0.06, shadowRadius:6, shadowOffset:{width:0,height:2} },
  cardTaken:   { opacity:0.78 },
  cardNotTaken:{ borderWidth:1, borderColor:'#ffccbb', borderLeftWidth:5 },
  cardOverdue: { borderWidth:1, borderColor:'#d63031', borderLeftWidth:5 },
  cardUpcoming:{ opacity:0.85 },

  timeBadge:    { paddingVertical:6, paddingHorizontal:14, alignSelf:'flex-start' },
  timeBadgeTxt: { fontSize:13, color:'#fff', fontWeight:'700' },
  cardBody:     { padding:14 },
  cardTop:      { flexDirection:'row', alignItems:'center', flexWrap:'wrap', gap:6, marginBottom:8 },

  typePill:    { paddingHorizontal:8, paddingVertical:3, borderRadius:8 },
  typePillTxt: { fontSize:11, fontWeight:'700' },

  stateBadge:    { paddingHorizontal:9, paddingVertical:3, borderRadius:8 },
  stateBadgeTxt: { fontSize:11, fontWeight:'700' },

  cardTitle:      { fontSize:17, fontWeight:'800', color:colors.textPrimary, marginBottom:3 },
  cardTitleFaded: { color:colors.textSecondary },
  cardDosage:     { fontSize:13, color:'#a29bfe', fontWeight:'600', marginBottom:3 },
  cardDesc:       { fontSize:13, color:colors.textSecondary, marginBottom:6, lineHeight:18 },
  cardCG:         { fontSize:11, color:colors.textSecondary, marginTop:4 },

  infoBox:         { backgroundColor:'#e8f4ff', borderRadius:10, padding:10, marginTop:10 },
  infoBoxTxt:      { fontSize:12, color:'#0984e3', lineHeight:18 },

  reminderInfoBox: { backgroundColor:'#fff8e1', borderRadius:10, padding:10, marginTop:10, borderWidth:1, borderColor:'#ffeaa7' },
  reminderInfoTxt: { fontSize:12, color:'#f39c12', lineHeight:18 },

  notTakenBox:     { backgroundColor:'#fff5f0', borderRadius:10, padding:10, marginTop:10, borderWidth:1, borderColor:'#ffccbb' },
  notTakenBoxTxt:  { fontSize:12, color:'#e17055', lineHeight:18 },

  overdueBox:      { backgroundColor:'#fff5f5', borderRadius:10, padding:10, marginTop:10, borderWidth:1, borderColor:'#ffcccc' },
  overdueBoxTxt:   { fontSize:12, color:'#d63031', lineHeight:18 },

  takenBox:        { backgroundColor:'#f0fff8', borderRadius:10, padding:10, marginTop:10, borderWidth:1, borderColor:'#b2dfdb' },
  takenBoxTxt:     { fontSize:12, color:'#00b894', lineHeight:18, fontWeight:'600' },

  actionRow:      { flexDirection:'row', gap:10, marginTop:12 },
  takenBtn:       { flex:2, backgroundColor:'#00b894', paddingVertical:13, borderRadius:12, alignItems:'center' },
  takenBtnTxt:    { color:'#fff', fontSize:14, fontWeight:'700' },
  notTakenBtn:    { flex:1.5, backgroundColor:'#fff0eb', paddingVertical:13, borderRadius:12, alignItems:'center', borderWidth:1, borderColor:'#ffb3a7' },
  notTakenBtnTxt: { color:'#e17055', fontSize:13, fontWeight:'700' },
  notTakenHint:   { fontSize:11, color:colors.textSecondary, marginTop:6, textAlign:'center', fontStyle:'italic' },

  modalOverlay:      { flex:1, backgroundColor:'rgba(0,0,0,0.5)', justifyContent:'flex-end' },
  modalBox:          { backgroundColor:'#fff', borderTopLeftRadius:24, borderTopRightRadius:24, padding:24 },
  modalOverdueTag:   { backgroundColor:'#ffe0e0', alignSelf:'flex-start', paddingHorizontal:10, paddingVertical:4, borderRadius:8, marginBottom:8 },
  modalOverdueTagTxt:{ fontSize:12, fontWeight:'800', color:'#d63031' },
  modalTitle:        { fontSize:20, fontWeight:'800', color:colors.textPrimary, marginBottom:4 },
  modalDosage:       { fontSize:13, color:'#a29bfe', fontWeight:'600', marginBottom:8 },
  modalInfoRow:      { backgroundColor:'#fff8e1', borderRadius:8, padding:8, marginBottom:10 },
  modalInfoTxt:      { fontSize:12, color:'#f39c12', fontWeight:'600' },
  modalPrompt:       { fontSize:13, fontWeight:'600', color:colors.textSecondary, marginBottom:6, marginTop:4 },
  modalInput:        { borderWidth:1, borderColor:colors.border, borderRadius:12, padding:12, fontSize:14, color:colors.textPrimary, minHeight:80, textAlignVertical:'top', marginBottom:16 },
  modalBtns:         { gap:10 },

  modalTakenBtn:    { backgroundColor:'#00b894', paddingVertical:15, borderRadius:14, alignItems:'center' },
  modalTakenBtnTxt: { color:'#fff', fontSize:16, fontWeight:'700' },
  modalCancelBtn:   { paddingVertical:10, alignItems:'center' },
  modalCancelBtnTxt:{ color:colors.textSecondary, fontSize:14 },
});

export default TodayRemindersScreen; 
// update this