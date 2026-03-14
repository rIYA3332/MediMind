// screens/doctor/PatientDetailScreen.tsx
// Reports tab → navigates to full caregiver ReportScreen (no blank space)
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, RefreshControl, Modal, TextInput,
  Alert, Linking, KeyboardAvoidingView, Platform, FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getApiUrl } from '../../config/api';

// ─── Types ────────────────────────────────────────────────────────────────────
interface PatientInfo {
  id: number; name: string; dob: string | null; phone: string | null;
  gender: string | null; blood_type?: string | null; emergency_contact: string | null;
}
interface Vital      { log_type: string; value: string; unit: string; logged_at: string }
interface Medication { id: number; name: string; dosage: string | null; frequency: string | null; time: string | null; notes: string | null }
interface Risk       { risk_type: string; severity: string; message: string; detected_at: string }
interface Condition  { id: number; condition: string; diagnosed_at: string | null }
interface CarePlan   { id: number; title: string; notes: string | null; priority: string; created_at: string; doctor_name: string }
interface Caregiver  { id: number; name: string; phone: string | null; relationship: string | null }
interface ChatMsg    { id: number; sender_id: number; sender_name: string; sender_role: string; message: string; sent_at: string }
interface RiskScore  { risk_level: string; risk_score: number; is_critical: number; alert_message: string }
interface FullData {
  patient: PatientInfo;
  latest_vitals: Vital[];
  medications: Medication[];
  recent_health_logs: any[];
  active_risks: Risk[];
  mood_history: any[];
  caregiver: Caregiver | null;
  medical_conditions: Condition[];
  care_plans: CarePlan[];
  latest_risk_score: RiskScore | null;
}
type Tab = 'overview' | 'doses' | 'report' | 'chat' | 'alerts';

const VITAL_COLORS: Record<string, string> = {
  blood_pressure: '#3498db', blood_sugar: '#9b59b6',
  heart_rate: '#e74c3c', temperature: '#e67e22', weight: '#27ae60',
};
const VITAL_NORMALS: Record<string, string> = {
  blood_pressure: '120/80 mmHg', blood_sugar: '70–140 mg/dL',
  heart_rate: '60–100 bpm', temperature: '97–99°F', weight: 'per BMI',
};

function getAge(dob: string | null): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000));
}
function timeAgo(iso: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  const days = Math.floor(hours / 24);
  if (mins < 2) return 'Just now';
  if (mins < 60) return `${mins} min ago`;
  if (hours < 24) return `${hours} hr${hours > 1 ? 's' : ''} ago`;
  return `${days}d ago`;
}
function vLabel(t: string): string {
  return t.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

// ─── Component ────────────────────────────────────────────────────────────────
const PatientDetailScreen = ({ route, navigation }: any) => {
  const { elderId, elderName, doctorId, doctorName } = route.params || {};

  const [data,       setData]       = useState<FullData | null>(null);
  const [chat,       setChat]       = useState<ChatMsg[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tab,        setTab]        = useState<Tab>('overview');
  const [submitting, setSubmitting] = useState(false);

  // Medication form
  const [medName,   setMedName]   = useState('');
  const [medDosage, setMedDosage] = useState('');
  const [medFreq,   setMedFreq]   = useState('');
  const [medInstr,  setMedInstr]  = useState('');
  const [medStart,  setMedStart]  = useState('');
  const [medEnd,    setMedEnd]    = useState('');
  const [noteText,  setNoteText]  = useState('');
  const [condInput, setCondInput] = useState('');
  const [condModal, setCondModal] = useState(false);

  // Chat
  const [chatMsg,     setChatMsg]     = useState('');
  const [sendingChat, setSendingChat] = useState(false);
  const chatRef = useRef<FlatList>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Load ──────────────────────────────────────────────────────────────────
  const loadFull = useCallback(async () => {
    try {
      const res = await fetch(getApiUrl(`/api/doctor/patient/${elderId}/full`));
      if (!res.ok) return;
      setData(await res.json());
    } catch (e) { console.log('loadFull error:', e); }
  }, [elderId]);

  const loadChat = useCallback(async () => {
    try {
      const res  = await fetch(getApiUrl(`/api/chat/${elderId}/${doctorId}`));
      const msgs = await res.json();
      setChat(Array.isArray(msgs) ? msgs : []);
    } catch {}
  }, [elderId, doctorId]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.all([loadFull(), loadChat()]);
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (tab === 'chat') {
      pollRef.current = setInterval(loadChat, 10000);
    } else {
      if (pollRef.current) clearInterval(pollRef.current);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [tab, loadChat]);

  useEffect(() => {
    const id = setInterval(loadFull, 30000);
    return () => clearInterval(id);
  }, [loadFull]);

  const onRefresh = () => {
    setRefreshing(true);
    Promise.all([loadFull(), loadChat()]).finally(() => setRefreshing(false));
  };

  // ── Handle Reports tab click ──────────────────────────────────────────────
  // ✅ Navigate to the full caregiver ReportScreen as a proper stack screen
  const handleReportTab = () => {
    navigation.navigate('PatientReport', {
      elderId,
      elderName: data?.patient?.name || elderName,
    });
  };

  // ── Actions ───────────────────────────────────────────────────────────────
  const addMedication = async () => {
    if (!medName.trim()) { Alert.alert('Error', 'Medication name required'); return; }
    setSubmitting(true);
    try {
      const res = await fetch(getApiUrl('/api/doctor/add-medication'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ elderId, doctorId, name: medName.trim(), dosage: medDosage.trim() || null, frequency: medFreq.trim() || 'daily', notes: medInstr.trim() || null }),
      });
      if (res.ok) {
        setMedName(''); setMedDosage(''); setMedFreq(''); setMedInstr(''); setMedStart(''); setMedEnd('');
        Alert.alert('✅ Prescribed', 'Medication added');
        await loadFull();
      } else { const d = await res.json(); Alert.alert('Error', d.message || 'Failed'); }
    } catch { Alert.alert('Error', 'Failed to prescribe'); }
    finally { setSubmitting(false); }
  };

  const removeMedication = (med: Medication) => {
    Alert.alert('Remove', `Remove "${med.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        try { await fetch(getApiUrl(`/api/medications/${med.id}`), { method: 'DELETE' }); await loadFull(); } catch {}
      }},
    ]);
  };

  const saveCarePlan = async () => {
    if (!noteText.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(getApiUrl('/api/doctor/care-plan'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ elderId, doctorId, title: noteText.trim().substring(0, 100), notes: noteText.trim(), priority: 'medium' }),
      });
      if (res.ok) { setNoteText(''); Alert.alert('✅ Saved', 'Note added'); await loadFull(); }
    } catch {}
    finally { setSubmitting(false); }
  };

  const addCondition = async () => {
    const c = condInput.trim();
    if (!c) return;
    setSubmitting(true);
    try {
      await fetch(getApiUrl('/api/doctor/medical-condition'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ elderId, doctorId, condition: c }),
      });
      setCondInput(''); setCondModal(false); await loadFull();
    } catch {}
    finally { setSubmitting(false); }
  };

  const removeCondition = async (id: number) => {
    try { await fetch(getApiUrl(`/api/doctor/medical-condition/${id}`), { method: 'DELETE' }); await loadFull(); } catch {}
  };

  const sendChat = async () => {
    if (!chatMsg.trim() || !data?.caregiver) return;
    const msg = chatMsg.trim();
    setChatMsg('');
    setSendingChat(true);
    try {
      await fetch(getApiUrl('/api/chat/send'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ elderId, senderId: doctorId, receiverId: data.caregiver.id, senderRole: 'doctor', message: msg }),
      });
      await loadChat();
      setTimeout(() => chatRef.current?.scrollToEnd({ animated: true }), 150);
    } catch {}
    finally { setSendingChat(false); }
  };

  // ── Overview ──────────────────────────────────────────────────────────────
  const renderOverview = () => {
    const p      = data?.patient;
    const vitals = data?.latest_vitals || [];
    const meds   = data?.medications || [];
    const conds  = data?.medical_conditions || [];
    const age    = getAge(p?.dob ?? null);

    return (
      <>
        <View style={D.infoCard}>
          <View style={D.infoRow}>
            {age !== null && <View style={D.infoCol}><Text style={D.infoLbl}>Age</Text><Text style={D.infoVal}>{age} years</Text></View>}
            {p?.gender && <View style={D.infoCol}><Text style={D.infoLbl}>Gender</Text><Text style={D.infoVal}>{p.gender}</Text></View>}
            {p?.blood_type && <View style={D.infoCol}><Text style={D.infoLbl}>Blood Type</Text><Text style={D.infoVal}>{p.blood_type}</Text></View>}
          </View>
          {conds.length > 0 && (
            <View style={D.condBlock}>
              <Text style={D.condBlockLbl}>Medical Conditions:</Text>
              <Text style={D.condBlockTxt}>{conds.map(c => c.condition).join(', ')}</Text>
            </View>
          )}
        </View>

        {data?.latest_risk_score && (
          <View style={[D.riskBanner, {
            backgroundColor: data.latest_risk_score.is_critical ? '#fdecea' : data.latest_risk_score.risk_level === 'high' ? '#fef9e7' : '#eafaf1',
            borderColor: data.latest_risk_score.is_critical ? '#e74c3c' : data.latest_risk_score.risk_level === 'high' ? '#f39c12' : '#27ae60',
          }]}>
            <Text style={{ fontSize: 22 }}>{data.latest_risk_score.is_critical ? '🚨' : data.latest_risk_score.risk_level === 'high' ? '⚠️' : '✅'}</Text>
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={[D.riskBannerLevel, { color: data.latest_risk_score.is_critical ? '#c0392b' : data.latest_risk_score.risk_level === 'high' ? '#d68910' : '#1e8449' }]}>
                AI Risk: {(data.latest_risk_score.risk_level || 'LOW').toUpperCase()} · {Math.round(data.latest_risk_score.risk_score || 0)}%
              </Text>
              {data.latest_risk_score.alert_message ? <Text style={D.riskBannerMsg} numberOfLines={2}>{data.latest_risk_score.alert_message}</Text> : null}
            </View>
          </View>
        )}

        {vitals.length > 0 && (
          <>
            <Text style={D.sectionHead}>Recent Vitals</Text>
            <View style={D.vitalsGrid}>
              {vitals.map(v => {
                const clr = VITAL_COLORS[v.log_type] || '#3498db';
                return (
                  <View key={v.log_type} style={[D.vitalCard, { borderTopColor: clr }]}>
                    <Text style={D.vitalType}>{vLabel(v.log_type)}</Text>
                    <Text style={[D.vitalVal, { color: clr }]}>{v.value}</Text>
                    <Text style={D.vitalNormal}>{VITAL_NORMALS[v.log_type] || ''}</Text>
                    <Text style={D.vitalTime}>{timeAgo(v.logged_at)}</Text>
                  </View>
                );
              })}
            </View>
          </>
        )}

        <Text style={D.sectionHead}>Current Medications</Text>
        {meds.length === 0 ? <Text style={D.noDataTxt}>No medications on file</Text> : (
          meds.slice(0, 6).map(med => (
            <View key={med.id} style={D.medListRow}>
              <Text style={{ fontSize: 18, marginRight: 10 }}>💊</Text>
              <View style={{ flex: 1 }}>
                <Text style={D.medListName}>{med.name}{med.dosage ? ` ${med.dosage}` : ''}</Text>
                <Text style={D.medListDetail}>{med.frequency || 'daily'}{med.time ? ` · ${med.time}` : ' · After meals'}</Text>
              </View>
            </View>
          ))
        )}

        {/* ✅ VIEW FULL HISTORY navigates to the full caregiver ReportScreen */}
        <TouchableOpacity style={D.historyBtn} onPress={handleReportTab}>
          <Text style={D.historyBtnTxt}>VIEW FULL HISTORY</Text>
        </TouchableOpacity>
      </>
    );
  };

  // ── Update Doses ──────────────────────────────────────────────────────────
  const renderDoses = () => {
    const meds  = data?.medications || [];
    const conds = data?.medical_conditions || [];
    const plans = data?.care_plans || [];

    return (
      <>
        <View style={D.dosesHeader}>
          <Text style={D.dosesTitle}>{elderName} – Edit</Text>
          <TouchableOpacity style={D.saveBtn} onPress={async () => noteText.trim() ? await saveCarePlan() : Alert.alert('✅', 'No changes')}>
            <Text style={D.saveBtnTxt}>💊 Save</Text>
          </TouchableOpacity>
        </View>

        <View style={D.formCard}>
          <Text style={D.formCardTitle}>Add Medication</Text>
          <Text style={D.fieldLbl}>Medication Name *</Text>
          <TextInput style={D.fieldInput} value={medName} onChangeText={setMedName} placeholder="Search medication..." placeholderTextColor="#bbb" />
          <View style={D.twoCol}>
            <View style={{ flex: 1 }}><Text style={D.fieldLbl}>Dosage</Text><TextInput style={D.fieldInput} value={medDosage} onChangeText={setMedDosage} placeholder="500mg" placeholderTextColor="#bbb" /></View>
            <View style={{ flex: 1 }}><Text style={D.fieldLbl}>Frequency</Text><TextInput style={D.fieldInput} value={medFreq} onChangeText={setMedFreq} placeholder="Twice daily" placeholderTextColor="#bbb" /></View>
          </View>
          <Text style={D.fieldLbl}>Instructions</Text>
          <TextInput style={[D.fieldInput, D.fieldInputMulti]} value={medInstr} onChangeText={setMedInstr} placeholder="Take after meals..." placeholderTextColor="#bbb" multiline />
          <Text style={D.fieldLbl}>Duration</Text>
          <View style={D.twoCol}>
            <View style={{ flex: 1 }}><TextInput style={D.fieldInput} value={medStart} onChangeText={setMedStart} placeholder="Start Date" placeholderTextColor="#bbb" /></View>
            <View style={{ flex: 1 }}><TextInput style={D.fieldInput} value={medEnd} onChangeText={setMedEnd} placeholder="End Date" placeholderTextColor="#bbb" /></View>
          </View>
          <TouchableOpacity style={[D.addMedBtn, (!medName.trim() || submitting) && { opacity: 0.5 }]} onPress={addMedication} disabled={!medName.trim() || submitting}>
            {submitting ? <ActivityIndicator color="#3498db" /> : <Text style={D.addMedBtnTxt}>+ ADD MEDICATION</Text>}
          </TouchableOpacity>
        </View>

        {meds.length > 0 && (
          <View style={D.formCard}>
            <Text style={D.formCardTitle}>Current Medications</Text>
            {meds.map(med => (
              <View key={med.id} style={D.existingMedRow}>
                <Text style={{ fontSize: 18, marginRight: 10 }}>💊</Text>
                <View style={{ flex: 1 }}>
                  <Text style={D.medListName}>{med.name}{med.dosage ? ` ${med.dosage}` : ''}</Text>
                  <Text style={D.medListDetail}>{med.frequency || 'daily'}</Text>
                </View>
                <TouchableOpacity onPress={() => removeMedication(med)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Text style={D.removeX}>×</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        <View style={D.formCard}>
          <Text style={D.formCardTitle}>Clinical Notes</Text>
          <TextInput style={[D.fieldInput, D.fieldInputMulti]} value={noteText} onChangeText={setNoteText} placeholder="Patient showing improvement..." placeholderTextColor="#bbb" multiline />
          {noteText.trim().length > 0 && (
            <TouchableOpacity style={[D.addMedBtn, { borderColor: '#27ae60' }]} onPress={saveCarePlan} disabled={submitting}>
              <Text style={[D.addMedBtnTxt, { color: '#27ae60' }]}>SAVE NOTE</Text>
            </TouchableOpacity>
          )}
          {plans.slice(0, 3).map(plan => (
            <View key={plan.id} style={D.noteChip}>
              <Text style={D.noteChipTxt} numberOfLines={2}>{plan.notes || plan.title}</Text>
              <Text style={D.noteChipTime}>{timeAgo(plan.created_at)}</Text>
            </View>
          ))}
        </View>

        <View style={D.formCard}>
          <Text style={D.formCardTitle}>Medical Conditions</Text>
          {conds.map(cond => (
            <View key={cond.id} style={D.condChipRow}>
              <View style={{ flex: 1 }}>
                <Text style={D.condChipName}>{cond.condition}</Text>
                {cond.diagnosed_at && <Text style={D.condChipDate}>Diagnosed: {cond.diagnosed_at}</Text>}
              </View>
              <TouchableOpacity onPress={() => removeCondition(cond.id)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Text style={D.removeX}>×</Text>
              </TouchableOpacity>
            </View>
          ))}
          <TouchableOpacity style={D.addCondBtn} onPress={() => setCondModal(true)}>
            <Text style={D.addCondBtnTxt}>+ ADD CONDITION</Text>
          </TouchableOpacity>
        </View>
        <View style={{ height: 20 }} />
      </>
    );
  };

  // ── Chat ──────────────────────────────────────────────────────────────────
  const renderChat = () => {
    const cg = data?.caregiver;
    if (!cg) {
      return (
        <View style={D.emptyBox}>
          <Text style={{ fontSize: 40, marginBottom: 12 }}>💬</Text>
          <Text style={D.emptyTitle}>No caregiver connected</Text>
          <Text style={D.emptySub}>{elderName} doesn't have a caregiver linked yet.</Text>
        </View>
      );
    }
    return (
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }} keyboardVerticalOffset={180}>
        <View style={D.chatHeader}>
          <View style={D.chatAv}><Text style={D.chatAvTxt}>{cg.name.charAt(0).toUpperCase()}</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={D.chatName}>{cg.name}</Text>
            <Text style={D.chatRole}>Caregiver · {cg.relationship || 'Family'} · {elderName}</Text>
          </View>
          {cg.phone && (
            <TouchableOpacity style={D.callChip} onPress={() => Linking.openURL(`tel:${cg.phone}`)}>
              <Text style={D.callChipTxt}>📞 Call</Text>
            </TouchableOpacity>
          )}
        </View>
        <FlatList
          ref={chatRef}
          data={chat}
          keyExtractor={(item, idx) => `chat-${item.id}-${idx}`}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingVertical: 10, paddingHorizontal: 4 }}
          onContentSizeChange={() => chatRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={<View style={{ alignItems: 'center', paddingVertical: 40 }}><Text style={{ color: '#95a5a6', fontSize: 13 }}>No messages yet. Send a note to {cg.name}.</Text></View>}
          renderItem={({ item }) => {
            const isMe = item.sender_id === doctorId;
            return (
              <View style={[D.bubble, isMe ? D.bubbleMe : D.bubbleThem]}>
                {!isMe && <Text style={D.bubbleSender}>{item.sender_name}</Text>}
                <Text style={isMe ? D.bubbleMeTxt : D.bubbleThemTxt}>{item.message}</Text>
                <Text style={[D.bubbleTime, isMe && { color: 'rgba(255,255,255,0.65)' }]}>{timeAgo(item.sent_at)}</Text>
              </View>
            );
          }}
        />
        <View style={D.chatInputRow}>
          <TextInput style={D.chatInput} value={chatMsg} onChangeText={setChatMsg} placeholder={`Message ${cg.name}…`} placeholderTextColor="#aaa" multiline />
          <TouchableOpacity style={[D.sendBtn, (!chatMsg.trim() || sendingChat) && { backgroundColor: '#bdc3c7' }]} onPress={sendChat} disabled={!chatMsg.trim() || sendingChat}>
            {sendingChat ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ color: '#fff', fontWeight: '700', fontSize: 18 }}>↑</Text>}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    );
  };

  // ── Alerts ────────────────────────────────────────────────────────────────
  const renderAlerts = () => {
    const risks = data?.active_risks || [];
    const score = data?.latest_risk_score;
    if (risks.length === 0 && !score) {
      return <View style={D.emptyBox}><Text style={{ fontSize: 40, marginBottom: 12 }}>✅</Text><Text style={D.emptyTitle}>No active alerts</Text><Text style={D.emptySub}>All vitals look stable.</Text></View>;
    }
    return (
      <>
        {score && (
          <View style={[D.riskCard, { borderLeftColor: score.is_critical ? '#c0392b' : score.risk_level === 'high' ? '#e17055' : '#27ae60', marginBottom: 14 }]}>
            <Text style={[D.riskSev, { color: score.is_critical ? '#c0392b' : score.risk_level === 'high' ? '#e17055' : '#27ae60' }]}>
              🤖 AI Risk: {score.risk_level?.toUpperCase()} — {Math.round(score.risk_score || 0)}%
            </Text>
            {score.alert_message ? <Text style={D.riskMsg}>{score.alert_message}</Text> : null}
          </View>
        )}
        {risks.map((r, i) => {
          const clr = r.severity === 'critical' ? '#c0392b' : r.severity === 'danger' ? '#e17055' : '#f39c12';
          return (
            <View key={i} style={[D.riskCard, { borderLeftColor: clr }]}>
              <Text style={[D.riskSev, { color: clr }]}>{r.severity === 'critical' ? '🚨' : '⚠️'} {r.severity.toUpperCase()}</Text>
              <Text style={D.riskMsg}>{r.message}</Text>
              <Text style={{ fontSize: 11, color: '#95a5a6', marginTop: 4 }}>{timeAgo(r.detected_at)}</Text>
            </View>
          );
        })}
      </>
    );
  };

  if (loading) {
    return <SafeAreaView style={D.screen}><View style={D.loadBox}><ActivityIndicator size="large" color="#3498db" /></View></SafeAreaView>;
  }

  const p           = data?.patient;
  const totalAlerts = data?.active_risks?.length || 0;

  return (
    <SafeAreaView style={D.screen}>
      <View style={D.pageTitle}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={{ marginRight: 10 }}>
          <Text style={{ fontSize: 22, color: '#3498db' }}>←</Text>
        </TouchableOpacity>
        <Text style={D.pageTitleTxt}>Patient Details</Text>
      </View>

      <View style={D.patientNameRow}>
        <Text style={D.patientNameTxt}>{p?.name || elderName}</Text>
        <TouchableOpacity style={D.callBtn} onPress={() => p?.phone && Linking.openURL(`tel:${p.phone}`)}>
          <Text style={D.callBtnTxt}>📞 Call</Text>
        </TouchableOpacity>
        <TouchableOpacity style={{ padding: 6 }}>
          <Text style={{ fontSize: 22, color: '#2c3e50' }}>☰</Text>
        </TouchableOpacity>
      </View>

      {/* ✅ Reports tab uses handleReportTab to navigate — not setTab('report') */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={D.tabBar} contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8, gap: 8 }}>
        <TouchableOpacity style={[D.tabBtn, tab === 'overview' && D.tabBtnActive]} onPress={() => setTab('overview')}>
          <Text style={[D.tabTxt, tab === 'overview' && D.tabTxtActive]}>Overview</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[D.tabBtn, tab === 'doses' && D.tabBtnActive]} onPress={() => setTab('doses')}>
          <Text style={[D.tabTxt, tab === 'doses' && D.tabTxtActive]}>Update Doses</Text>
        </TouchableOpacity>
        {/* ✅ Reports: navigate to full ReportScreen stack screen */}
        <TouchableOpacity style={D.tabBtn} onPress={handleReportTab}>
          <Text style={D.tabTxt}>Reports</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[D.tabBtn, tab === 'chat' && D.tabBtnActive]} onPress={() => setTab('chat')}>
          <Text style={[D.tabTxt, tab === 'chat' && D.tabTxtActive]}>Chat</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[D.tabBtn, tab === 'alerts' && D.tabBtnActive, totalAlerts > 0 && tab !== 'alerts' && D.tabBtnAlert]} onPress={() => setTab('alerts')}>
          <Text style={[D.tabTxt, tab === 'alerts' && D.tabTxtActive, totalAlerts > 0 && tab !== 'alerts' && D.tabTxtAlert]}>
            {totalAlerts > 0 ? `Alerts (${totalAlerts})` : 'Alerts'}
          </Text>
        </TouchableOpacity>
      </ScrollView>

      {tab === 'chat' ? (
        <View style={{ flex: 1, paddingHorizontal: 15, paddingTop: 8 }}>
          {renderChat()}
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 15, paddingTop: 12 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#3498db" />}
          keyboardShouldPersistTaps="handled"
        >
          {tab === 'overview' && renderOverview()}
          {tab === 'doses'    && renderDoses()}
          {tab === 'alerts'   && renderAlerts()}
          <View style={{ height: 50 }} />
        </ScrollView>
      )}

      <Modal visible={condModal} transparent animationType="slide">
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <View style={D.modalOverlay}>
            <View style={D.modalBox}>
              <Text style={D.modalTitle}>Add Medical Condition</Text>
              <Text style={D.fieldLbl}>Condition Name</Text>
              <TextInput style={D.fieldInput} value={condInput} onChangeText={setCondInput} placeholder="e.g. Type 2 Diabetes" placeholderTextColor="#bbb" autoFocus />
              <View style={{ gap: 10, marginTop: 20 }}>
                <TouchableOpacity style={[D.addMedBtn, { borderColor: '#27ae60' }]} onPress={addCondition} disabled={submitting || !condInput.trim()}>
                  {submitting ? <ActivityIndicator color="#27ae60" /> : <Text style={[D.addMedBtnTxt, { color: '#27ae60' }]}>+ ADD CONDITION</Text>}
                </TouchableOpacity>
                <TouchableOpacity style={{ paddingVertical: 12, alignItems: 'center' }} onPress={() => setCondModal(false)}>
                  <Text style={{ color: '#95a5a6', fontSize: 14 }}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
};

const D = StyleSheet.create({
  screen:  { flex: 1, backgroundColor: '#f0f2f5' },
  loadBox: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  pageTitle:    { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f0f2f5', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 6 },
  pageTitleTxt: { fontSize: 17, fontWeight: '600', color: '#3498db' },
  patientNameRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#ecf0f1', gap: 10 },
  patientNameTxt: { flex: 1, fontSize: 18, fontWeight: '700', color: '#2c3e50' },
  callBtn:        { backgroundColor: '#3498db', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7 },
  callBtnTxt:     { color: '#fff', fontSize: 13, fontWeight: '700' },
  tabBar:       { flexGrow: 0, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#ecf0f1', maxHeight: 52 },
  tabBtn:       { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1, borderColor: '#e0e0e0', backgroundColor: '#f8f9fa' },
  tabBtnActive: { backgroundColor: '#3498db', borderColor: '#3498db' },
  tabBtnAlert:  { borderColor: '#e74c3c', backgroundColor: '#fdecea' },
  tabTxt:       { fontSize: 12, fontWeight: '600', color: '#7f8c8d' },
  tabTxtActive: { color: '#fff' },
  tabTxtAlert:  { color: '#c0392b' },
  sectionHead:  { fontSize: 14, fontWeight: '700', color: '#2c3e50', marginBottom: 12, marginTop: 6 },
  noDataTxt:    { fontSize: 13, color: '#95a5a6', textAlign: 'center', paddingVertical: 20 },
  infoCard:     { backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 14, elevation: 2, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 5 },
  infoRow:      { flexDirection: 'row', gap: 16, marginBottom: 8 },
  infoCol:      { flex: 1 },
  infoLbl:      { fontSize: 11, color: '#95a5a6', marginBottom: 4 },
  infoVal:      { fontSize: 16, fontWeight: '800', color: '#2c3e50' },
  condBlock:    { borderTopWidth: 1, borderTopColor: '#ecf0f1', paddingTop: 10, marginTop: 4 },
  condBlockLbl: { fontSize: 12, color: '#7f8c8d', marginBottom: 4 },
  condBlockTxt: { fontSize: 13, color: '#2c3e50', fontWeight: '500' },
  riskBanner:   { flexDirection: 'row', alignItems: 'flex-start', borderRadius: 12, borderWidth: 1, padding: 12, marginBottom: 14 },
  riskBannerLevel: { fontSize: 12, fontWeight: '700', marginBottom: 3 },
  riskBannerMsg:   { fontSize: 12, color: '#2c3e50', lineHeight: 17 },
  vitalsGrid:   { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  vitalCard:    { width: '47.5%', backgroundColor: '#fff', borderRadius: 12, padding: 14, borderTopWidth: 3, elevation: 2, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4 },
  vitalType:    { fontSize: 12, fontWeight: '700', color: '#2c3e50', marginBottom: 6 },
  vitalVal:     { fontSize: 24, fontWeight: '800', marginBottom: 4 },
  vitalNormal:  { fontSize: 10, color: '#95a5a6', marginBottom: 3 },
  vitalTime:    { fontSize: 11, color: '#bdc3c7' },
  medListRow:   { backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 13, marginBottom: 8, borderWidth: 1, borderColor: '#ecf0f1', flexDirection: 'row', alignItems: 'center' },
  medListName:  { fontSize: 14, fontWeight: '600', color: '#2c3e50' },
  medListDetail:{ fontSize: 12, color: '#7f8c8d', marginTop: 2 },
  historyBtn:   { backgroundColor: '#3498db', borderRadius: 12, paddingVertical: 17, alignItems: 'center', marginTop: 16, marginBottom: 4 },
  historyBtnTxt:{ color: '#fff', fontWeight: '700', fontSize: 14, letterSpacing: 0.8 },
  dosesHeader:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  dosesTitle:   { fontSize: 16, fontWeight: '700', color: '#2c3e50' },
  saveBtn:      { backgroundColor: '#3498db', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  saveBtnTxt:   { color: '#fff', fontSize: 13, fontWeight: '700' },
  formCard:     { backgroundColor: '#fff', borderRadius: 14, padding: 16, marginBottom: 14, elevation: 1 },
  formCardTitle:{ fontSize: 14, fontWeight: '700', color: '#2c3e50', marginBottom: 10 },
  fieldLbl:     { fontSize: 12, color: '#7f8c8d', marginBottom: 6, marginTop: 8 },
  fieldInput:   { backgroundColor: '#f8f9fa', borderRadius: 10, borderWidth: 1, borderColor: '#e8ecf0', paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: '#2c3e50' },
  fieldInputMulti: { minHeight: 80, textAlignVertical: 'top' },
  twoCol:       { flexDirection: 'row', gap: 12 },
  addMedBtn:    { borderWidth: 1.5, borderColor: '#3498db', borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 14, backgroundColor: '#fff' },
  addMedBtnTxt: { color: '#3498db', fontWeight: '700', fontSize: 13 },
  existingMedRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#f4f6f8', paddingVertical: 10 },
  removeX:      { fontSize: 26, color: '#e74c3c', fontWeight: '300', lineHeight: 30 },
  noteChip:     { backgroundColor: '#f8f9fa', borderRadius: 8, padding: 10, marginTop: 8, borderWidth: 1, borderColor: '#ecf0f1' },
  noteChipTxt:  { fontSize: 12, color: '#2c3e50', lineHeight: 17 },
  noteChipTime: { fontSize: 10, color: '#95a5a6', marginTop: 4 },
  condChipRow:  { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#f4f6f8', paddingVertical: 10 },
  condChipName: { fontSize: 14, fontWeight: '600', color: '#2c3e50' },
  condChipDate: { fontSize: 11, color: '#95a5a6', marginTop: 2 },
  addCondBtn:   { borderWidth: 1.5, borderColor: '#3498db', borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 10, borderStyle: 'dashed' as any },
  addCondBtnTxt:{ color: '#3498db', fontWeight: '700', fontSize: 13 },
  riskCard:     { borderLeftWidth: 4, backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 8, elevation: 1 },
  riskSev:      { fontSize: 12, fontWeight: '700', marginBottom: 5 },
  riskMsg:      { fontSize: 13, color: '#2c3e50', lineHeight: 19 },
  chatHeader:   { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 10, borderWidth: 1, borderColor: '#ecf0f1', gap: 12 },
  chatAv:       { width: 44, height: 44, borderRadius: 22, backgroundColor: '#27ae60', justifyContent: 'center', alignItems: 'center' },
  chatAvTxt:    { color: '#fff', fontWeight: '800', fontSize: 18 },
  chatName:     { fontSize: 15, fontWeight: '700', color: '#2c3e50' },
  chatRole:     { fontSize: 11, color: '#95a5a6', marginTop: 1 },
  callChip:     { backgroundColor: '#3498db', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7 },
  callChipTxt:  { color: '#fff', fontSize: 12, fontWeight: '700' },
  bubble:       { maxWidth: '80%', marginBottom: 10, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18 },
  bubbleMe:     { alignSelf: 'flex-end', backgroundColor: '#3498db', borderBottomRightRadius: 4 },
  bubbleThem:   { alignSelf: 'flex-start', backgroundColor: '#fff', borderBottomLeftRadius: 4, borderWidth: 1, borderColor: '#ecf0f1', elevation: 1 },
  bubbleSender: { fontSize: 10, color: '#95a5a6', marginBottom: 3, fontWeight: '600' },
  bubbleMeTxt:  { color: '#fff', fontSize: 14, lineHeight: 19 },
  bubbleThemTxt:{ color: '#2c3e50', fontSize: 14, lineHeight: 19 },
  bubbleTime:   { fontSize: 10, color: '#95a5a6', marginTop: 3, textAlign: 'right' },
  chatInputRow: { flexDirection: 'row', gap: 8, paddingVertical: 10 },
  chatInput:    { flex: 1, backgroundColor: '#fff', borderRadius: 24, borderWidth: 1, borderColor: '#e0e0e0', paddingHorizontal: 16, paddingVertical: 10, fontSize: 14, color: '#2c3e50', maxHeight: 100 },
  sendBtn:      { width: 46, height: 46, borderRadius: 23, backgroundColor: '#3498db', justifyContent: 'center', alignItems: 'center', alignSelf: 'flex-end' },
  emptyBox:     { alignItems: 'center', paddingVertical: 60 },
  emptyTitle:   { fontSize: 16, fontWeight: '700', color: '#2c3e50', marginTop: 6 },
  emptySub:     { fontSize: 13, color: '#95a5a6', textAlign: 'center', paddingHorizontal: 30, marginTop: 6 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalBox:     { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  modalTitle:   { fontSize: 18, fontWeight: '800', color: '#2c3e50', marginBottom: 16 },
});

export default PatientDetailScreen;