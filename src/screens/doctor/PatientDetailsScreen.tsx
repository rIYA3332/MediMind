// screens/doctor/PatientDetailScreen.tsx
// Added dedicated CONDITIONS tab for doctor to manage elder diseases

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
  gender: string | null; emergency_contact: string | null;
}
interface Vital      { log_type: string; value: string; unit: string; logged_at: string }
interface Medication { id: number; name: string; dosage: string | null; frequency: string | null; time: string | null; notes: string | null }
interface Risk       { risk_type: string; severity: string; message: string; detected_at: string }
interface Condition  { id: number; condition: string; diagnosed_at: string | null; notes: string | null }
interface CarePlan   { id: number; title: string; notes: string | null; priority: string; created_at: string; doctor_name: string }
interface Caregiver  { id: number; name: string; phone: string | null; relationship: string | null }
interface ChatMsg    { id: number; sender_id: number; sender_name: string; sender_role: string; message: string; sent_at: string }
interface RiskScore  { risk_level: string; risk_score: number; is_critical: number; alert_message: string }
interface FullData {
  patient: PatientInfo;
  latest_vitals: Vital[];
  medications: Medication[];
  active_risks: Risk[];
  caregiver: Caregiver | null;
  medical_conditions: Condition[];
  care_plans: CarePlan[];
  latest_risk_score: RiskScore | null;
}

type Tab = 'overview' | 'conditions' | 'doses' | 'chat' | 'alerts';

// ─── Predefined diseases ──────────────────────────────────────────────────────
const COMMON_CONDITIONS = [
  { label: 'Type 2 Diabetes',          icon: '🩸', category: 'metabolic'      },
  { label: 'Type 1 Diabetes',          icon: '🩸', category: 'metabolic'      },
  { label: 'Hypertension',             icon: '💔', category: 'cardiovascular' },
  { label: 'Heart Disease',            icon: '❤️', category: 'cardiovascular' },
  { label: 'Heart Failure',            icon: '❤️', category: 'cardiovascular' },
  { label: 'Atrial Fibrillation',      icon: '💓', category: 'cardiovascular' },
  { label: 'Obesity',                  icon: '⚖️', category: 'metabolic'      },
  { label: 'High Cholesterol',         icon: '🫀', category: 'metabolic'      },
  { label: 'Osteoarthritis',           icon: '🦴', category: 'musculoskeletal'},
  { label: 'Rheumatoid Arthritis',     icon: '🦴', category: 'musculoskeletal'},
  { label: 'Osteoporosis',             icon: '🦴', category: 'musculoskeletal'},
  { label: 'Chronic Kidney Disease',   icon: '🫘', category: 'renal'          },
  { label: 'Asthma',                   icon: '🫁', category: 'respiratory'    },
  { label: 'COPD',                     icon: '🫁', category: 'respiratory'    },
  { label: 'Depression',               icon: '🧠', category: 'mental'         },
  { label: 'Anxiety Disorder',         icon: '🧠', category: 'mental'         },
  { label: "Parkinson's Disease",      icon: '🧠', category: 'neurological'   },
  { label: "Alzheimer's Disease",      icon: '🧠', category: 'neurological'   },
  { label: 'Stroke',                   icon: '🧠', category: 'neurological'   },
  { label: 'Hypothyroidism',           icon: '⚕️', category: 'endocrine'      },
  { label: 'Hyperthyroidism',          icon: '⚕️', category: 'endocrine'      },
  { label: 'Anemia',                   icon: '🩺', category: 'blood'          },
  { label: 'Diabetes + Hypertension',  icon: '🩸', category: 'comorbidity'    },
  { label: 'Diabetes + Heart Disease', icon: '🩸', category: 'comorbidity'    },
];

const CATEGORY_COLORS: Record<string, string> = {
  metabolic:      '#6c5ce7',
  cardiovascular: '#e17055',
  musculoskeletal:'#00b894',
  renal:          '#0984e3',
  respiratory:    '#74b9ff',
  mental:         '#a29bfe',
  neurological:   '#fd79a8',
  endocrine:      '#fdcb6e',
  blood:          '#ff7675',
  comorbidity:    '#2d3436',
};

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
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
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

  // Condition modal state
  const [condModalOpen,  setCondModalOpen]  = useState(false);
  const [condSearch,     setCondSearch]     = useState('');
  const [condCustom,     setCondCustom]     = useState('');
  const [condDiagDate,   setCondDiagDate]   = useState('');
  const [condNotes,      setCondNotes]      = useState('');
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [savingCond,     setSavingCond]     = useState(false);

  // Medication form
  const [medName,   setMedName]   = useState('');
  const [medDosage, setMedDosage] = useState('');
  const [medFreq,   setMedFreq]   = useState('');
  const [medInstr,  setMedInstr]  = useState('');
  const [noteText,  setNoteText]  = useState('');

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

  const onRefresh = () => {
    setRefreshing(true);
    Promise.all([loadFull(), loadChat()]).finally(() => setRefreshing(false));
  };

  // ── Add Condition ─────────────────────────────────────────────────────────
  const openAddCondition = () => {
    setCondSearch('');
    setCondCustom('');
    setCondDiagDate('');
    setCondNotes('');
    setSelectedPreset(null);
    setCondModalOpen(true);
  };

  const handleSaveCondition = async () => {
    const conditionName = selectedPreset || condCustom.trim();
    if (!conditionName) {
      Alert.alert('Error', 'Please select or enter a condition.');
      return;
    }
    setSavingCond(true);
    try {
      const res = await fetch(getApiUrl('/api/doctor/medical-condition'), {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          elderId,
          doctorId,
          condition:   conditionName,
          diagnosedAt: condDiagDate.trim() || null,
          notes:       condNotes.trim()    || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        Alert.alert('Error', err.message || 'Failed to add condition');
        return;
      }
      setCondModalOpen(false);
      await loadFull();
      Alert.alert('✅ Added', `"${conditionName}" added to patient's conditions.`);
    } catch (e) {
      Alert.alert('Error', 'Failed to save condition.');
    } finally {
      setSavingCond(false);
    }
  };

  const removeCondition = async (id: number, name: string) => {
    Alert.alert(
      'Remove Condition',
      `Remove "${name}" from this patient's record?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove', style: 'destructive',
          onPress: async () => {
            try {
              await fetch(getApiUrl(`/api/doctor/medical-condition/${id}`),
                { method: 'DELETE' });
              await loadFull();
            } catch {}
          },
        },
      ]
    );
  };

  // ── Add Medication ────────────────────────────────────────────────────────
  const addMedication = async () => {
    if (!medName.trim()) { Alert.alert('Error', 'Medication name required'); return; }
    setSubmitting(true);
    try {
      const res = await fetch(getApiUrl('/api/doctor/add-medication'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          elderId, doctorId,
          name: medName.trim(),
          dosage: medDosage.trim() || null,
          frequency: medFreq.trim() || 'daily',
          notes: medInstr.trim() || null,
        }),
      });
      if (res.ok) {
        setMedName(''); setMedDosage(''); setMedFreq(''); setMedInstr('');
        Alert.alert('✅ Prescribed', 'Medication added and caregiver notified.');
        await loadFull();
      } else {
        const d = await res.json();
        Alert.alert('Error', d.message || 'Failed');
      }
    } catch { Alert.alert('Error', 'Failed to prescribe'); }
    finally { setSubmitting(false); }
  };

  const saveCarePlan = async () => {
    if (!noteText.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch(getApiUrl('/api/doctor/care-plan'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          elderId, doctorId,
          title: noteText.trim().substring(0, 100),
          notes: noteText.trim(),
          priority: 'medium',
        }),
      });
      if (res.ok) { setNoteText(''); Alert.alert('✅ Saved', 'Note added'); await loadFull(); }
    } catch {}
    finally { setSubmitting(false); }
  };

  const sendChat = async () => {
    if (!chatMsg.trim() || !data?.caregiver) return;
    const msg = chatMsg.trim();
    setChatMsg('');
    setSendingChat(true);
    try {
      await fetch(getApiUrl('/api/chat/send'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          elderId, senderId: doctorId,
          receiverId: data.caregiver.id,
          senderRole: 'doctor', message: msg,
        }),
      });
      await loadChat();
      setTimeout(() => chatRef.current?.scrollToEnd({ animated: true }), 150);
    } catch {}
    finally { setSendingChat(false); }
  };

  // ── Filter conditions for search ─────────────────────────────────────────
  const filteredPresets = COMMON_CONDITIONS.filter(c =>
    condSearch.trim() === '' ||
    c.label.toLowerCase().includes(condSearch.toLowerCase())
  );

  // ── Overview ──────────────────────────────────────────────────────────────
  const renderOverview = () => {
    const p      = data?.patient;
    const vitals = data?.latest_vitals || [];
    const conds  = data?.medical_conditions || [];
    const age    = getAge(p?.dob ?? null);

    return (
      <>
        {/* Patient info card */}
        <View style={D.infoCard}>
          <View style={D.infoRow}>
            {age !== null && <View style={D.infoCol}><Text style={D.infoLbl}>Age</Text><Text style={D.infoVal}>{age} yrs</Text></View>}
            {p?.gender    && <View style={D.infoCol}><Text style={D.infoLbl}>Gender</Text><Text style={D.infoVal}>{p.gender}</Text></View>}
          </View>
          {/* Conditions summary */}
          {conds.length > 0 ? (
            <View style={D.condSummaryBox}>
              <Text style={D.condSummaryTitle}>🏥 Medical Conditions</Text>
              <View style={D.condChipsRow}>
                {conds.map(c => {
                  const preset = COMMON_CONDITIONS.find(
                    p => p.label.toLowerCase() === c.condition.toLowerCase()
                  );
                  const cat   = preset?.category || 'blood';
                  const color = CATEGORY_COLORS[cat] || '#636e72';
                  return (
                    <View key={c.id} style={[D.condChip, { backgroundColor: color + '18', borderColor: color + '50' }]}>
                      <Text style={D.condChipIcon}>{preset?.icon || '🏥'}</Text>
                      <Text style={[D.condChipTxt, { color }]}>{c.condition}</Text>
                    </View>
                  );
                })}
              </View>
            </View>
          ) : (
            <TouchableOpacity style={D.noCondBanner} onPress={() => setTab('conditions')}>
              <Text style={D.noCondBannerIcon}>⚠️</Text>
              <View style={{ flex: 1 }}>
                <Text style={D.noCondBannerTitle}>No conditions recorded</Text>
                <Text style={D.noCondBannerSub}>Tap to add medical conditions →</Text>
              </View>
            </TouchableOpacity>
          )}
        </View>

        {/* Risk banner */}
        {data?.latest_risk_score && (
          <View style={[D.riskBanner, {
            backgroundColor: data.latest_risk_score.is_critical ? '#fdecea' :
                             data.latest_risk_score.risk_level === 'high' ? '#fef9e7' : '#eafaf1',
            borderColor:     data.latest_risk_score.is_critical ? '#e74c3c' :
                             data.latest_risk_score.risk_level === 'high' ? '#f39c12' : '#27ae60',
          }]}>
            <Text style={{ fontSize: 22 }}>
              {data.latest_risk_score.is_critical ? '🚨' :
               data.latest_risk_score.risk_level === 'high' ? '⚠️' : '✅'}
            </Text>
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={[D.riskBannerLevel, {
                color: data.latest_risk_score.is_critical ? '#c0392b' :
                       data.latest_risk_score.risk_level === 'high' ? '#d68910' : '#1e8449'
              }]}>
                AI Risk: {(data.latest_risk_score.risk_level || 'LOW').toUpperCase()} · {Math.round(data.latest_risk_score.risk_score || 0)}%
              </Text>
              {data.latest_risk_score.alert_message &&
                <Text style={D.riskBannerMsg} numberOfLines={2}>
                  {data.latest_risk_score.alert_message}
                </Text>}
            </View>
          </View>
        )}

        {/* Vitals */}
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

        {/* Current Medications */}
        <Text style={D.sectionHead}>Current Medications</Text>
        {(data?.medications || []).length === 0 ? (
          <Text style={D.noDataTxt}>No medications on file</Text>
        ) : (
          (data?.medications || []).slice(0, 5).map(med => (
            <View key={med.id} style={D.medListRow}>
              <Text style={{ fontSize: 18, marginRight: 10 }}>💊</Text>
              <View style={{ flex: 1 }}>
                <Text style={D.medListName}>{med.name}{med.dosage ? ` ${med.dosage}` : ''}</Text>
                <Text style={D.medListDetail}>{med.frequency || 'daily'}{med.time ? ` · ${med.time}` : ''}</Text>
              </View>
            </View>
          ))
        )}

        {/* VIEW FULL HISTORY — navigates to ReportScreen */}
        <TouchableOpacity
          style={D.historyBtn}
          onPress={() => navigation.navigate('PatientReport', {
            elderId,
            elderName: data?.patient?.name || elderName,
          })}>
          <Text style={D.historyBtnTxt}>VIEW FULL HISTORY</Text>
        </TouchableOpacity>
      </>
    );
  };

  // ── CONDITIONS TAB ────────────────────────────────────────────────────────
  const renderConditions = () => {
    const conds = data?.medical_conditions || [];

    return (
      <>
        {/* Header */}
        <View style={D.condTabHeader}>
          <View>
            <Text style={D.condTabTitle}>Medical Conditions</Text>
            <Text style={D.condTabSub}>
              {conds.length === 0
                ? 'No conditions recorded yet'
                : `${conds.length} condition${conds.length !== 1 ? 's' : ''} on record`}
            </Text>
          </View>
          <TouchableOpacity style={D.addCondTabBtn} onPress={openAddCondition}>
            <Text style={D.addCondTabBtnTxt}>+ Add</Text>
          </TouchableOpacity>
        </View>

        {/* Important note */}
        <View style={D.condInfoBanner}>
          <Text style={D.condInfoIcon}>💡</Text>
          <Text style={D.condInfoTxt}>
            Conditions you add here are used to generate personalized care plans for this patient. The more accurate this list, the better the care plan.
          </Text>
        </View>

        {/* Empty state */}
        {conds.length === 0 && (
          <TouchableOpacity style={D.condEmptyBox} onPress={openAddCondition}>
            <Text style={{ fontSize: 48, marginBottom: 12 }}>🏥</Text>
            <Text style={D.condEmptyTitle}>No conditions recorded</Text>
            <Text style={D.condEmptyTxt}>
              Tap to add this patient's medical conditions. This is required to generate a personalized care plan.
            </Text>
            <View style={D.condEmptyBtn}>
              <Text style={D.condEmptyBtnTxt}>+ Add First Condition</Text>
            </View>
          </TouchableOpacity>
        )}

        {/* Condition cards */}
        {conds.map(cond => {
          const preset = COMMON_CONDITIONS.find(
            p => p.label.toLowerCase() === cond.condition.toLowerCase()
          );
          const cat   = preset?.category || 'blood';
          const color = CATEGORY_COLORS[cat] || '#636e72';

          return (
            <View key={cond.id} style={[D.condCard, { borderLeftColor: color }]}>
              <View style={D.condCardTop}>
                <View style={[D.condIconWrap, { backgroundColor: color + '18' }]}>
                  <Text style={{ fontSize: 22 }}>{preset?.icon || '🏥'}</Text>
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={[D.condCardName, { color }]}>{cond.condition}</Text>
                  {cond.diagnosed_at && (
                    <Text style={D.condCardDate}>Diagnosed: {cond.diagnosed_at}</Text>
                  )}
                  <View style={[D.condCategoryBadge, { backgroundColor: color + '15' }]}>
                    <Text style={[D.condCategoryTxt, { color }]}>
                      {(cat.charAt(0).toUpperCase() + cat.slice(1)).replace('_', ' ')}
                    </Text>
                  </View>
                </View>
                <TouchableOpacity
                  style={D.condRemoveBtn}
                  onPress={() => removeCondition(cond.id, cond.condition)}
                >
                  <Text style={D.condRemoveBtnTxt}>Remove</Text>
                </TouchableOpacity>
              </View>
              {cond.notes && (
                <Text style={D.condCardNotes}>📋 {cond.notes}</Text>
              )}
            </View>
          );
        })}

        {/* Add more button at bottom */}
        {conds.length > 0 && (
          <TouchableOpacity style={D.addMoreCondBtn} onPress={openAddCondition}>
            <Text style={D.addMoreCondBtnTxt}>+ Add Another Condition</Text>
          </TouchableOpacity>
        )}

        <View style={{ height: 40 }} />
      </>
    );
  };

  // ── Doses tab ─────────────────────────────────────────────────────────────
  const renderDoses = () => {
    const plans = data?.care_plans || [];
    return (
      <>
        <View style={D.formCard}>
          <Text style={D.formCardTitle}>Prescribe Medication</Text>
          <Text style={D.fieldLbl}>Medication Name *</Text>
          <TextInput style={D.fieldInput} value={medName} onChangeText={setMedName}
            placeholder="Search medication..." placeholderTextColor="#bbb" />
          <View style={D.twoCol}>
            <View style={{ flex: 1 }}>
              <Text style={D.fieldLbl}>Dosage</Text>
              <TextInput style={D.fieldInput} value={medDosage} onChangeText={setMedDosage}
                placeholder="500mg" placeholderTextColor="#bbb" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={D.fieldLbl}>Frequency</Text>
              <TextInput style={D.fieldInput} value={medFreq} onChangeText={setMedFreq}
                placeholder="Twice daily" placeholderTextColor="#bbb" />
            </View>
          </View>
          <Text style={D.fieldLbl}>Instructions</Text>
          <TextInput style={[D.fieldInput, D.fieldInputMulti]} value={medInstr}
            onChangeText={setMedInstr} placeholder="Take after meals..."
            placeholderTextColor="#bbb" multiline />
          <TouchableOpacity
            style={[D.addMedBtn, (!medName.trim() || submitting) && { opacity: 0.5 }]}
            onPress={addMedication} disabled={!medName.trim() || submitting}>
            {submitting
              ? <ActivityIndicator color="#3498db" />
              : <Text style={D.addMedBtnTxt}>+ PRESCRIBE MEDICATION</Text>}
          </TouchableOpacity>
        </View>

        <View style={D.formCard}>
          <Text style={D.formCardTitle}>Clinical Notes</Text>
          <TextInput style={[D.fieldInput, D.fieldInputMulti]} value={noteText}
            onChangeText={setNoteText} placeholder="Clinical observations..."
            placeholderTextColor="#bbb" multiline />
          {noteText.trim().length > 0 && (
            <TouchableOpacity style={[D.addMedBtn, { borderColor: '#27ae60' }]}
              onPress={saveCarePlan} disabled={submitting}>
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
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
        keyboardVerticalOffset={180}>
        <View style={D.chatHeader}>
          <View style={D.chatAv}>
            <Text style={D.chatAvTxt}>{cg.name.charAt(0).toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={D.chatName}>{cg.name}</Text>
            <Text style={D.chatRole}>Caregiver · {cg.relationship || 'Family'}</Text>
          </View>
          {cg.phone && (
            <TouchableOpacity style={D.callChip}
              onPress={() => Linking.openURL(`tel:${cg.phone}`)}>
              <Text style={D.callChipTxt}>📞 Call</Text>
            </TouchableOpacity>
          )}
        </View>
        <FlatList
          ref={chatRef}
          data={chat}
          keyExtractor={(item, idx) => `${item.id}-${idx}`}
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 10 }}
          onContentSizeChange={() => chatRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingVertical: 40 }}>
              <Text style={{ color: '#95a5a6', fontSize: 13 }}>
                No messages yet. Send a note to {cg.name}.
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const isMe = item.sender_id === doctorId;
            return (
              <View style={[D.bubble, isMe ? D.bubbleMe : D.bubbleThem]}>
                {!isMe && <Text style={D.bubbleSender}>{item.sender_name}</Text>}
                <Text style={isMe ? D.bubbleMeTxt : D.bubbleThemTxt}>{item.message}</Text>
                <Text style={[D.bubbleTime, isMe && { color: 'rgba(255,255,255,0.65)' }]}>
                  {timeAgo(item.sent_at)}
                </Text>
              </View>
            );
          }}
        />
        <View style={D.chatInputRow}>
          <TextInput style={D.chatInput} value={chatMsg} onChangeText={setChatMsg}
            placeholder={`Message ${cg.name}…`} placeholderTextColor="#aaa" multiline />
          <TouchableOpacity
            style={[D.sendBtn, (!chatMsg.trim() || sendingChat) && { backgroundColor: '#bdc3c7' }]}
            onPress={sendChat} disabled={!chatMsg.trim() || sendingChat}>
            {sendingChat
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={{ color: '#fff', fontWeight: '700', fontSize: 18 }}>↑</Text>}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    );
  };

  // ── Alerts ────────────────────────────────────────────────────────────────
  const renderAlerts = () => {
    const risks = data?.active_risks || [];
    const score = data?.latest_risk_score;
    if (!risks.length && !score) {
      return (
        <View style={D.emptyBox}>
          <Text style={{ fontSize: 40, marginBottom: 12 }}>✅</Text>
          <Text style={D.emptyTitle}>No active alerts</Text>
          <Text style={D.emptySub}>All vitals look stable.</Text>
        </View>
      );
    }
    return (
      <>
        {score && (
          <View style={[D.riskCard, {
            borderLeftColor: score.is_critical ? '#c0392b' :
                             score.risk_level === 'high' ? '#e17055' : '#27ae60',
            marginBottom: 14,
          }]}>
            <Text style={[D.riskSev, {
              color: score.is_critical ? '#c0392b' :
                     score.risk_level === 'high' ? '#e17055' : '#27ae60',
            }]}>
              🤖 AI Risk: {score.risk_level?.toUpperCase()} — {Math.round(score.risk_score || 0)}%
            </Text>
            {score.alert_message && <Text style={D.riskMsg}>{score.alert_message}</Text>}
          </View>
        )}
        {risks.map((r, i) => {
          const clr = r.severity === 'critical' ? '#c0392b' :
                      r.severity === 'danger'   ? '#e17055' : '#f39c12';
          return (
            <View key={i} style={[D.riskCard, { borderLeftColor: clr }]}>
              <Text style={[D.riskSev, { color: clr }]}>
                {r.severity === 'critical' ? '🚨' : '⚠️'} {r.severity.toUpperCase()}
              </Text>
              <Text style={D.riskMsg}>{r.message}</Text>
              <Text style={{ fontSize: 11, color: '#95a5a6', marginTop: 4 }}>
                {timeAgo(r.detected_at)}
              </Text>
            </View>
          );
        })}
      </>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={D.screen}>
        <View style={D.loadBox}>
          <ActivityIndicator size="large" color="#3498db" />
        </View>
      </SafeAreaView>
    );
  }

  const p           = data?.patient;
  const totalAlerts = data?.active_risks?.length || 0;
  const condCount   = data?.medical_conditions?.length || 0;

  return (
    <SafeAreaView style={D.screen}>
      {/* Page title */}
      <View style={D.pageTitle}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={{ marginRight: 10 }}>
          <Text style={{ fontSize: 22, color: '#3498db' }}>←</Text>
        </TouchableOpacity>
        <Text style={D.pageTitleTxt}>Patient Details</Text>
      </View>

      {/* Patient name row */}
      <View style={D.patientNameRow}>
        <Text style={D.patientNameTxt}>{p?.name || elderName}</Text>
        <TouchableOpacity style={D.callBtn}
          onPress={() => p?.phone && Linking.openURL(`tel:${p.phone}`)}>
          <Text style={D.callBtnTxt}>📞 Call</Text>
        </TouchableOpacity>
      </View>

      {/* Tab bar */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}
        style={D.tabBar}
        contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8, gap: 8 }}>

        <TouchableOpacity
          style={[D.tabBtn, tab === 'overview' && D.tabBtnActive]}
          onPress={() => setTab('overview')}>
          <Text style={[D.tabTxt, tab === 'overview' && D.tabTxtActive]}>Overview</Text>
        </TouchableOpacity>

        {/* CONDITIONS tab — highlighted if no conditions yet */}
        <TouchableOpacity
          style={[
            D.tabBtn,
            tab === 'conditions' && D.tabBtnActive,
            condCount === 0 && tab !== 'conditions' && D.tabBtnWarning,
          ]}
          onPress={() => setTab('conditions')}>
          <Text style={[
            D.tabTxt,
            tab === 'conditions' && D.tabTxtActive,
            condCount === 0 && tab !== 'conditions' && { color: '#e67e22' },
          ]}>
            {condCount === 0 ? '⚠️ Conditions' : `Conditions (${condCount})`}
          </Text>
        </TouchableOpacity>

        {/* Reports — navigates to full ReportScreen */}
        <TouchableOpacity
          style={D.tabBtn}
          onPress={() => navigation.navigate('PatientReport', {
            elderId,
            elderName: data?.patient?.name || elderName,
          })}>
          <Text style={D.tabTxt}>Reports</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[D.tabBtn, tab === 'doses' && D.tabBtnActive]}
          onPress={() => setTab('doses')}>
          <Text style={[D.tabTxt, tab === 'doses' && D.tabTxtActive]}>Prescribe</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[D.tabBtn, tab === 'chat' && D.tabBtnActive]}
          onPress={() => setTab('chat')}>
          <Text style={[D.tabTxt, tab === 'chat' && D.tabTxtActive]}>Chat</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            D.tabBtn,
            tab === 'alerts' && D.tabBtnActive,
            totalAlerts > 0 && tab !== 'alerts' && D.tabBtnAlert,
          ]}
          onPress={() => setTab('alerts')}>
          <Text style={[
            D.tabTxt,
            tab === 'alerts' && D.tabTxtActive,
            totalAlerts > 0 && tab !== 'alerts' && D.tabTxtAlert,
          ]}>
            {totalAlerts > 0 ? `Alerts (${totalAlerts})` : 'Alerts'}
          </Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Content */}
      {tab === 'chat' ? (
        <View style={{ flex: 1, paddingHorizontal: 15, paddingTop: 8 }}>
          {renderChat()}
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 15, paddingTop: 12 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh}
              tintColor="#3498db" />
          }
          keyboardShouldPersistTaps="handled">
          {tab === 'overview'    && renderOverview()}
          {tab === 'conditions'  && renderConditions()}
          {tab === 'doses'       && renderDoses()}
          {tab === 'alerts'      && renderAlerts()}
          <View style={{ height: 50 }} />
        </ScrollView>
      )}

      {/* ── Add Condition Modal ─────────────────────────────────────────────── */}
      <Modal visible={condModalOpen} transparent animationType="slide"
        onRequestClose={() => setCondModalOpen(false)}>
        <View style={D.modalOverlay}>
          <View style={D.condModalBox}>
            {/* Modal header */}
            <View style={D.condModalHeader}>
              <Text style={D.condModalTitle}>Add Medical Condition</Text>
              <TouchableOpacity onPress={() => setCondModalOpen(false)}>
                <Text style={{ fontSize: 22, color: '#7f8c8d' }}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled">

              {/* Search */}
              <View style={D.condSearchBox}>
                <Text style={D.condSearchIcon}>🔍</Text>
                <TextInput
                  style={D.condSearchInput}
                  value={condSearch}
                  onChangeText={v => { setCondSearch(v); setSelectedPreset(null); }}
                  placeholder="Search conditions..."
                  placeholderTextColor="#bbb"
                />
              </View>

              {/* Preset list */}
              <Text style={D.condSectionLabel}>Common Conditions</Text>
              <View style={D.condPresetGrid}>
                {filteredPresets.map(c => {
                  const color   = CATEGORY_COLORS[c.category] || '#636e72';
                  const isSelected = selectedPreset === c.label;
                  return (
                    <TouchableOpacity
                      key={c.label}
                      style={[
                        D.condPresetItem,
                        { borderColor: isSelected ? color : '#e0e0e0' },
                        isSelected && { backgroundColor: color + '15' },
                      ]}
                      onPress={() => {
                        setSelectedPreset(isSelected ? null : c.label);
                        setCondCustom('');
                      }}>
                      <Text style={D.condPresetIcon}>{c.icon}</Text>
                      <Text style={[
                        D.condPresetTxt,
                        isSelected && { color, fontWeight: '700' },
                      ]}>
                        {c.label}
                      </Text>
                      {isSelected && (
                        <Text style={[D.condPresetCheck, { color }]}>✓</Text>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* Custom input */}
              <Text style={D.condSectionLabel}>Or Enter Custom Condition</Text>
              <TextInput
                style={[
                  D.fieldInput,
                  condCustom.trim() && { borderColor: '#3498db' },
                ]}
                value={condCustom}
                onChangeText={v => { setCondCustom(v); setSelectedPreset(null); }}
                placeholder="Type condition name..."
                placeholderTextColor="#bbb"
              />

              {/* Extra details */}
              <Text style={D.condSectionLabel}>
                Additional Details <Text style={{ fontWeight: '400' }}>(optional)</Text>
              </Text>
              <TextInput
                style={D.fieldInput}
                value={condDiagDate}
                onChangeText={setCondDiagDate}
                placeholder="Diagnosis date (e.g. 2022-03)"
                placeholderTextColor="#bbb"
              />
              <TextInput
                style={[D.fieldInput, { marginTop: 8, height: 70, textAlignVertical: 'top' }]}
                value={condNotes}
                onChangeText={setCondNotes}
                placeholder="Notes (e.g. controlled with medication, severe stage...)"
                placeholderTextColor="#bbb"
                multiline
              />

              {/* Selected preview */}
              {(selectedPreset || condCustom.trim()) && (
                <View style={D.condSelectedPreview}>
                  <Text style={D.condSelectedLabel}>Adding:</Text>
                  <Text style={D.condSelectedName}>
                    {selectedPreset || condCustom.trim()}
                  </Text>
                </View>
              )}

              {/* Action buttons */}
              <View style={D.condModalActions}>
                <TouchableOpacity
                  style={D.condCancelBtn}
                  onPress={() => setCondModalOpen(false)}
                  disabled={savingCond}>
                  <Text style={D.condCancelBtnTxt}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    D.condConfirmBtn,
                    !(selectedPreset || condCustom.trim()) && { opacity: 0.5 },
                    savingCond && { opacity: 0.6 },
                  ]}
                  onPress={handleSaveCondition}
                  disabled={!(selectedPreset || condCustom.trim()) || savingCond}>
                  {savingCond
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Text style={D.condConfirmBtnTxt}>✅ Add Condition</Text>}
                </TouchableOpacity>
              </View>

              <View style={{ height: 20 }} />
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────
const D = StyleSheet.create({
  screen:  { flex: 1, backgroundColor: '#f0f2f5' },
  loadBox: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  pageTitle:    { flexDirection:'row', alignItems:'center', backgroundColor:'#f0f2f5', paddingHorizontal:16, paddingTop:8, paddingBottom:6 },
  pageTitleTxt: { fontSize:17, fontWeight:'600', color:'#3498db' },

  patientNameRow: { flexDirection:'row', alignItems:'center', backgroundColor:'#fff', paddingHorizontal:16, paddingVertical:14, borderBottomWidth:1, borderBottomColor:'#ecf0f1', gap:10 },
  patientNameTxt: { flex:1, fontSize:18, fontWeight:'700', color:'#2c3e50' },
  callBtn:        { backgroundColor:'#3498db', borderRadius:8, paddingHorizontal:14, paddingVertical:7 },
  callBtnTxt:     { color:'#fff', fontSize:13, fontWeight:'700' },

  tabBar:       { flexGrow:0, backgroundColor:'#fff', borderBottomWidth:1, borderBottomColor:'#ecf0f1', maxHeight:52 },
  tabBtn:       { paddingHorizontal:14, paddingVertical:7, borderRadius:20, borderWidth:1, borderColor:'#e0e0e0', backgroundColor:'#f8f9fa' },
  tabBtnActive: { backgroundColor:'#3498db', borderColor:'#3498db' },
  tabBtnAlert:  { borderColor:'#e74c3c', backgroundColor:'#fdecea' },
  tabBtnWarning:{ borderColor:'#e67e22', backgroundColor:'#fef9e7' },
  tabTxt:       { fontSize:12, fontWeight:'600', color:'#7f8c8d' },
  tabTxtActive: { color:'#fff' },
  tabTxtAlert:  { color:'#c0392b' },

  sectionHead:  { fontSize:14, fontWeight:'700', color:'#2c3e50', marginBottom:12, marginTop:6 },
  noDataTxt:    { fontSize:13, color:'#95a5a6', textAlign:'center', paddingVertical:20 },

  infoCard: { backgroundColor:'#fff', borderRadius:14, padding:16, marginBottom:14, elevation:2, shadowColor:'#000', shadowOpacity:0.05, shadowRadius:5 },
  infoRow:  { flexDirection:'row', gap:16, marginBottom:8 },
  infoCol:  { flex:1 },
  infoLbl:  { fontSize:11, color:'#95a5a6', marginBottom:4 },
  infoVal:  { fontSize:16, fontWeight:'800', color:'#2c3e50' },

  // Condition summary in overview
  condSummaryBox:   { borderTopWidth:1, borderTopColor:'#ecf0f1', paddingTop:12, marginTop:4 },
  condSummaryTitle: { fontSize:13, fontWeight:'700', color:'#2c3e50', marginBottom:8 },
  condChipsRow:     { flexDirection:'row', flexWrap:'wrap', gap:8 },
  condChip:         { flexDirection:'row', alignItems:'center', gap:4, paddingHorizontal:10, paddingVertical:5, borderRadius:20, borderWidth:1 },
  condChipIcon:     { fontSize:14 },
  condChipTxt:      { fontSize:12, fontWeight:'600' },

  noCondBanner:      { flexDirection:'row', alignItems:'center', backgroundColor:'#fef9e7', borderRadius:10, padding:12, borderWidth:1, borderColor:'#f39c12', marginTop:8, gap:10 },
  noCondBannerIcon:  { fontSize:20 },
  noCondBannerTitle: { fontSize:13, fontWeight:'700', color:'#d68910' },
  noCondBannerSub:   { fontSize:11, color:'#e67e22', marginTop:2 },

  // Conditions tab
  condTabHeader:   { flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:12 },
  condTabTitle:    { fontSize:18, fontWeight:'800', color:'#2c3e50' },
  condTabSub:      { fontSize:12, color:'#7f8c8d', marginTop:2 },
  addCondTabBtn:   { backgroundColor:'#3498db', borderRadius:20, paddingHorizontal:16, paddingVertical:8 },
  addCondTabBtnTxt:{ color:'#fff', fontSize:13, fontWeight:'700' },

  condInfoBanner:  { flexDirection:'row', backgroundColor:'#eaf4fb', borderRadius:10, padding:12, marginBottom:14, borderWidth:1, borderColor:'#aed6f1', gap:10 },
  condInfoIcon:    { fontSize:18 },
  condInfoTxt:     { flex:1, fontSize:12, color:'#2980b9', lineHeight:18 },

  condEmptyBox:    { alignItems:'center', paddingVertical:50, backgroundColor:'#fff', borderRadius:14, marginBottom:14, elevation:1 },
  condEmptyTitle:  { fontSize:17, fontWeight:'700', color:'#2c3e50', marginBottom:8 },
  condEmptyTxt:    { fontSize:13, color:'#7f8c8d', textAlign:'center', paddingHorizontal:30, lineHeight:20, marginBottom:20 },
  condEmptyBtn:    { backgroundColor:'#3498db', borderRadius:12, paddingHorizontal:24, paddingVertical:12 },
  condEmptyBtnTxt: { color:'#fff', fontWeight:'700', fontSize:14 },

  condCard:        { backgroundColor:'#fff', borderRadius:12, padding:14, marginBottom:10, borderLeftWidth:4, elevation:2, shadowColor:'#000', shadowOpacity:0.05, shadowRadius:4 },
  condCardTop:     { flexDirection:'row', alignItems:'flex-start' },
  condIconWrap:    { width:44, height:44, borderRadius:22, justifyContent:'center', alignItems:'center' },
  condCardName:    { fontSize:15, fontWeight:'700', marginBottom:3 },
  condCardDate:    { fontSize:11, color:'#95a5a6', marginBottom:5 },
  condCategoryBadge:{ alignSelf:'flex-start', paddingHorizontal:8, paddingVertical:2, borderRadius:8 },
  condCategoryTxt: { fontSize:10, fontWeight:'600' },
  condRemoveBtn:   { paddingHorizontal:10, paddingVertical:5, borderRadius:8, borderWidth:1, borderColor:'#e74c3c', backgroundColor:'#fdecea' },
  condRemoveBtnTxt:{ fontSize:11, color:'#c0392b', fontWeight:'600' },
  condCardNotes:   { fontSize:12, color:'#7f8c8d', marginTop:10, paddingTop:10, borderTopWidth:1, borderTopColor:'#f4f6f8', lineHeight:18 },

  addMoreCondBtn:   { borderWidth:1.5, borderColor:'#3498db', borderRadius:12, paddingVertical:14, alignItems:'center', borderStyle:'dashed' as any, marginTop:4 },
  addMoreCondBtnTxt:{ color:'#3498db', fontWeight:'700', fontSize:14 },

  // Risk
  riskBanner:       { flexDirection:'row', alignItems:'flex-start', borderRadius:12, borderWidth:1, padding:12, marginBottom:14 },
  riskBannerLevel:  { fontSize:12, fontWeight:'700', marginBottom:3 },
  riskBannerMsg:    { fontSize:12, color:'#2c3e50', lineHeight:17 },

  vitalsGrid:   { flexDirection:'row', flexWrap:'wrap', gap:10, marginBottom:16 },
  vitalCard:    { width:'47.5%', backgroundColor:'#fff', borderRadius:12, padding:14, borderTopWidth:3, elevation:2, shadowColor:'#000', shadowOpacity:0.05, shadowRadius:4 },
  vitalType:    { fontSize:12, fontWeight:'700', color:'#2c3e50', marginBottom:6 },
  vitalVal:     { fontSize:24, fontWeight:'800', marginBottom:4 },
  vitalNormal:  { fontSize:10, color:'#95a5a6', marginBottom:3 },
  vitalTime:    { fontSize:11, color:'#bdc3c7' },

  medListRow:    { backgroundColor:'#fff', borderRadius:10, paddingHorizontal:14, paddingVertical:13, marginBottom:8, borderWidth:1, borderColor:'#ecf0f1', flexDirection:'row', alignItems:'center' },
  medListName:   { fontSize:14, fontWeight:'600', color:'#2c3e50' },
  medListDetail: { fontSize:12, color:'#7f8c8d', marginTop:2 },

  formCard:      { backgroundColor:'#fff', borderRadius:14, padding:16, marginBottom:14, elevation:1 },
  formCardTitle: { fontSize:14, fontWeight:'700', color:'#2c3e50', marginBottom:10 },
  fieldLbl:      { fontSize:12, color:'#7f8c8d', marginBottom:6, marginTop:8 },
  fieldInput:    { backgroundColor:'#f8f9fa', borderRadius:10, borderWidth:1, borderColor:'#e8ecf0', paddingHorizontal:14, paddingVertical:12, fontSize:14, color:'#2c3e50' },
  fieldInputMulti:{ minHeight:80, textAlignVertical:'top' },
  twoCol:        { flexDirection:'row', gap:12 },
  addMedBtn:     { borderWidth:1.5, borderColor:'#3498db', borderRadius:10, paddingVertical:14, alignItems:'center', marginTop:14, backgroundColor:'#fff' },
  addMedBtnTxt:  { color:'#3498db', fontWeight:'700', fontSize:13 },
  noteChip:      { backgroundColor:'#f8f9fa', borderRadius:8, padding:10, marginTop:8, borderWidth:1, borderColor:'#ecf0f1' },
  noteChipTxt:   { fontSize:12, color:'#2c3e50', lineHeight:17 },
  noteChipTime:  { fontSize:10, color:'#95a5a6', marginTop:4 },

  riskCard:  { borderLeftWidth:4, backgroundColor:'#fff', borderRadius:10, padding:14, marginBottom:8, elevation:1 },
  riskSev:   { fontSize:12, fontWeight:'700', marginBottom:5 },
  riskMsg:   { fontSize:13, color:'#2c3e50', lineHeight:19 },

  // Chat
  chatHeader:   { flexDirection:'row', alignItems:'center', backgroundColor:'#fff', borderRadius:14, padding:14, marginBottom:10, borderWidth:1, borderColor:'#ecf0f1', gap:12 },
  chatAv:       { width:44, height:44, borderRadius:22, backgroundColor:'#27ae60', justifyContent:'center', alignItems:'center' },
  chatAvTxt:    { color:'#fff', fontWeight:'800', fontSize:18 },
  chatName:     { fontSize:15, fontWeight:'700', color:'#2c3e50' },
  chatRole:     { fontSize:11, color:'#95a5a6', marginTop:1 },
  callChip:     { backgroundColor:'#3498db', borderRadius:8, paddingHorizontal:12, paddingVertical:7 },
  callChipTxt:  { color:'#fff', fontSize:12, fontWeight:'700' },
  bubble:       { maxWidth:'80%', marginBottom:10, paddingHorizontal:14, paddingVertical:10, borderRadius:18 },
  bubbleMe:     { alignSelf:'flex-end', backgroundColor:'#3498db', borderBottomRightRadius:4 },
  bubbleThem:   { alignSelf:'flex-start', backgroundColor:'#fff', borderBottomLeftRadius:4, borderWidth:1, borderColor:'#ecf0f1', elevation:1 },
  bubbleSender: { fontSize:10, color:'#95a5a6', marginBottom:3, fontWeight:'600' },
  bubbleMeTxt:  { color:'#fff', fontSize:14, lineHeight:19 },
  bubbleThemTxt:{ color:'#2c3e50', fontSize:14, lineHeight:19 },
  bubbleTime:   { fontSize:10, color:'#95a5a6', marginTop:3, textAlign:'right' },
  chatInputRow: { flexDirection:'row', gap:8, paddingVertical:10 },
  chatInput:    { flex:1, backgroundColor:'#fff', borderRadius:24, borderWidth:1, borderColor:'#e0e0e0', paddingHorizontal:16, paddingVertical:10, fontSize:14, color:'#2c3e50', maxHeight:100 },
  sendBtn:      { width:46, height:46, borderRadius:23, backgroundColor:'#3498db', justifyContent:'center', alignItems:'center', alignSelf:'flex-end' },

  emptyBox:  { alignItems:'center', paddingVertical:60 },
  emptyTitle:{ fontSize:16, fontWeight:'700', color:'#2c3e50', marginTop:6 },
  emptySub:  { fontSize:13, color:'#95a5a6', textAlign:'center', paddingHorizontal:30, marginTop:6 },

  // Condition modal
  modalOverlay:    { flex:1, backgroundColor:'rgba(0,0,0,0.5)', justifyContent:'flex-end' },
  condModalBox:    { backgroundColor:'#fff', borderTopLeftRadius:24, borderTopRightRadius:24, padding:20, maxHeight:'90%' },
  condModalHeader: { flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:16 },
  condModalTitle:  { fontSize:18, fontWeight:'800', color:'#2c3e50' },

  condSearchBox:   { flexDirection:'row', alignItems:'center', backgroundColor:'#f4f6f7', borderRadius:12, paddingHorizontal:12, paddingVertical:10, marginBottom:16, gap:8 },
  condSearchIcon:  { fontSize:16 },
  condSearchInput: { flex:1, fontSize:14, color:'#2c3e50' },

  condSectionLabel:{ fontSize:12, fontWeight:'700', color:'#7f8c8d', textTransform:'uppercase', letterSpacing:0.5, marginBottom:10, marginTop:8 },

  condPresetGrid:  { flexDirection:'row', flexWrap:'wrap', gap:8, marginBottom:8 },
  condPresetItem:  { flexDirection:'row', alignItems:'center', paddingHorizontal:12, paddingVertical:8, borderRadius:20, borderWidth:1.5, backgroundColor:'#f8f9fa', gap:6 },
  condPresetIcon:  { fontSize:16 },
  condPresetTxt:   { fontSize:13, color:'#2c3e50', fontWeight:'500' },
  condPresetCheck: { fontSize:14, fontWeight:'800', marginLeft:2 },

  condSelectedPreview:{ backgroundColor:'#eaf4fb', borderRadius:12, padding:12, marginTop:14, borderWidth:1, borderColor:'#aed6f1', flexDirection:'row', alignItems:'center', gap:10 },
  condSelectedLabel:  { fontSize:12, color:'#2980b9', fontWeight:'600' },
  condSelectedName:   { fontSize:15, fontWeight:'700', color:'#1a5276', flex:1 },

  condModalActions:{ flexDirection:'row', gap:12, marginTop:20 },
  condCancelBtn:   { flex:1, borderWidth:1, borderColor:'#d5d8dc', borderRadius:12, paddingVertical:14, alignItems:'center' },
  condCancelBtnTxt:{ fontSize:14, fontWeight:'600', color:'#7f8c8d' },
  condConfirmBtn:  { flex:2, backgroundColor:'#3498db', borderRadius:12, paddingVertical:14, alignItems:'center' },
  condConfirmBtnTxt:{ fontSize:14, fontWeight:'700', color:'#fff' },

  // View Full History button
  historyBtn:    { borderWidth:1.5, borderColor:'#3498db', borderRadius:12, paddingVertical:13, alignItems:'center', marginTop:16, backgroundColor:'#eaf4fb' },
  historyBtnTxt: { color:'#3498db', fontWeight:'700', fontSize:13, letterSpacing:0.5 },
});

export default PatientDetailScreen;