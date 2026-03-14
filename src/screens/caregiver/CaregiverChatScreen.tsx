// screens/caregiver/CaregiverChatScreen.tsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, TextInput, KeyboardAvoidingView,
  Platform, Linking, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getApiUrl } from '../../config/api';

// ─── Types ────────────────────────────────────────────────────────────────────
interface Doctor {
  id: number;
  name: string;
  specialty?: string | null;
  phone?: string | null;
  last_message?: string | null;
  last_message_at?: string | null;
  unread_count?: number;
}
interface ChatMsg {
  id: number;
  sender_id: number;
  sender_name: string;
  sender_role: string;
  message: string;
  sent_at: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function timeAgo(iso: string | null): string {
  if (!iso) return '';
  const diff  = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(mins / 60);
  const days  = Math.floor(hours / 24);
  if (mins < 2)   return 'Just now';
  if (mins < 60)  return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}
function fmtTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
}
function doctorDisplay(name: string): string {
  return name.startsWith('Dr') ? name : `Dr. ${name}`;
}

// ─── Doctor List Row ──────────────────────────────────────────────────────────
const DoctorRow = ({ doctor, onPress }: { doctor: Doctor; onPress: () => void }) => (
  <TouchableOpacity style={C.doctorItem} onPress={onPress} activeOpacity={0.75}>
    <View style={C.doctorAv}>
      <Text style={C.doctorAvTxt}>
        {doctor.name.replace('Dr. ','').replace('Dr.','').charAt(0).toUpperCase()}
      </Text>
    </View>
    <View style={{ flex: 1 }}>
      <Text style={C.doctorName} numberOfLines={1}>{doctorDisplay(doctor.name)}</Text>
      {doctor.specialty ? (
        <Text style={C.doctorSpec} numberOfLines={1}>{doctor.specialty}</Text>
      ) : null}
      {doctor.last_message ? (
        <Text style={C.doctorLastMsg} numberOfLines={1}>{doctor.last_message}</Text>
      ) : (
        <Text style={C.doctorLastMsg}>Tap to start a conversation</Text>
      )}
    </View>
    <View style={{ alignItems: 'flex-end', gap: 4 }}>
      {doctor.last_message_at ? (
        <Text style={C.doctorTime}>{timeAgo(doctor.last_message_at)}</Text>
      ) : null}
      {(doctor.unread_count ?? 0) > 0 ? (
        <View style={C.unreadBadge}>
          <Text style={C.unreadBadgeTxt}>{doctor.unread_count}</Text>
        </View>
      ) : null}
      <Text style={{ fontSize: 18, color: '#bdc3c7' }}>›</Text>
    </View>
  </TouchableOpacity>
);

// ─── Chat Thread ──────────────────────────────────────────────────────────────
const ChatThread = ({
  doctor, elderId, caregiverId, onBack,
}: {
  doctor: Doctor; elderId: number; caregiverId: number; onBack: () => void;
}) => {
  const [messages, setMessages]   = useState<ChatMsg[]>([]);
  const [input, setInput]         = useState('');
  const [sending, setSending]     = useState(false);
  const [loading, setLoading]     = useState(true);
  const listRef                   = useRef<FlatList>(null);
  const pollRef                   = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Fetch messages ──────────────────────────────────────────────────────────
  // Backend: GET /api/chat/:elderId/:userId
  // Returns messages WHERE elder_id=elderId AND (sender_id=userId OR receiver_id=userId)
  // We call it with caregiverId so we get all messages for this elder that involve the caregiver
  const loadMessages = useCallback(async () => {
    try {
      const res  = await fetch(getApiUrl(`/api/chat/${elderId}/${caregiverId}`));
      const data = await res.json();

      if (!Array.isArray(data)) {
        console.log('Chat response not array:', data);
        setMessages([]);
        return;
      }

      // The API already filters by elder_id + caregiver involvement.
      // We just show everything — no extra client-side filter that could drop messages.
      setMessages(data);
    } catch (e) {
      console.log('loadMessages error:', e);
    } finally {
      setLoading(false);
    }
  }, [elderId, caregiverId]);

  useEffect(() => {
    loadMessages();
    pollRef.current = setInterval(loadMessages, 8000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [loadMessages]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 100);
    }
  }, [messages.length]);

  // ── Send message ────────────────────────────────────────────────────────────
  const sendMessage = async () => {
    const msg = input.trim();
    if (!msg || sending) return;
    setInput('');
    setSending(true);
    try {
      const res = await fetch(getApiUrl('/api/chat/send'), {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          elderId,
          senderId:   caregiverId,
          receiverId: doctor.id,
          senderRole: 'caregiver',
          message:    msg,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        console.log('Send error:', err);
      }
      await loadMessages();
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 150);
    } catch (e) {
      console.log('sendMessage error:', e);
    } finally {
      setSending(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={90}
    >
      {/* Thread header */}
      <View style={C.threadHeader}>
        <TouchableOpacity onPress={onBack} style={C.backBtn} hitSlop={{ top:10, bottom:10, left:10, right:10 }}>
          <Text style={{ fontSize: 22, color: '#3498db' }}>←</Text>
        </TouchableOpacity>
        <View style={C.threadAv}>
          <Text style={C.threadAvTxt}>
            {doctor.name.replace('Dr. ','').replace('Dr.','').charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={C.threadName}>{doctorDisplay(doctor.name)}</Text>
          {doctor.specialty ? (
            <Text style={C.threadSpec}>{doctor.specialty}</Text>
          ) : null}
        </View>
        {doctor.phone ? (
          <TouchableOpacity
            style={C.callBtn}
            onPress={() => Linking.openURL(`tel:${doctor.phone}`)}
          >
            <Text style={C.callBtnTxt}>📞 Call</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Messages list */}
      {loading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f0f2f5' }}>
          <ActivityIndicator color="#3498db" />
          <Text style={{ color: '#95a5a6', marginTop: 10, fontSize: 13 }}>Loading messages…</Text>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item, i) => `${item.id}-${i}`}
          style={{ flex: 1, backgroundColor: '#f0f2f5' }}
          contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 12, flexGrow: 1 }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 60 }}>
              <Text style={{ fontSize: 42, marginBottom: 12 }}>💬</Text>
              <Text style={{ fontSize: 15, fontWeight: '700', color: '#2c3e50', marginBottom: 6 }}>
                No messages yet
              </Text>
              <Text style={{ fontSize: 13, color: '#95a5a6', textAlign: 'center', paddingHorizontal: 30 }}>
                Send a message to {doctorDisplay(doctor.name)}
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            // A message is "mine" if I (the caregiver) sent it
            const isMe = item.sender_id === caregiverId;
            return (
              <View style={{ marginBottom: 10, alignItems: isMe ? 'flex-end' : 'flex-start' }}>
                {/* Show sender name only for messages from the doctor */}
                {!isMe ? (
                  <Text style={C.bubbleSenderName}>{item.sender_name}</Text>
                ) : null}
                <View style={[C.bubble, isMe ? C.bubbleMe : C.bubbleThem]}>
                  <Text style={isMe ? C.bubbleMeTxt : C.bubbleThemTxt}>
                    {item.message}
                  </Text>
                  <Text style={[C.bubbleTime, isMe && { color: 'rgba(255,255,255,0.6)' }]}>
                    {fmtTime(item.sent_at)}
                  </Text>
                </View>
              </View>
            );
          }}
        />
      )}

      {/* Input bar */}
      <View style={C.inputRow}>
        <TextInput
          style={C.chatInput}
          value={input}
          onChangeText={setInput}
          placeholder={`Message ${doctorDisplay(doctor.name)}…`}
          placeholderTextColor="#aaa"
          multiline
          returnKeyType="send"
          blurOnSubmit={false}
          onSubmitEditing={sendMessage}
        />
        <TouchableOpacity
          style={[C.sendBtn, (!input.trim() || sending) && C.sendBtnDisabled]}
          onPress={sendMessage}
          disabled={!input.trim() || sending}
        >
          {sending
            ? <ActivityIndicator color="#fff" size="small" />
            : <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700' }}>↑</Text>}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
};

// ─── Main Screen ──────────────────────────────────────────────────────────────
const CaregiverChatScreen = ({ route }: any) => {
  const { elderId, caregiverId, caregiverName } = route.params || {};

  const [doctors, setDoctors]         = useState<Doctor[]>([]);
  const [loading, setLoading]         = useState(true);
  const [refreshing, setRefreshing]   = useState(false);
  const [activeDoctor, setActiveDoctor] = useState<Doctor | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Fetch connected doctors ─────────────────────────────────────────────────
  // Uses /api/doctor/connected/:elderId which returns doctors connected to this elder
  const loadDoctors = useCallback(async () => {
    // elderId might still be loading — show empty state gracefully
    if (!elderId) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      const res  = await fetch(getApiUrl(`/api/doctor/connected/${elderId}`));
      if (!res.ok) {
        console.log('loadDoctors error:', res.status);
        setDoctors([]);
        return;
      }
      const data = await res.json();
      setDoctors(Array.isArray(data) ? data : []);
    } catch (e) {
      console.log('loadDoctors error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [elderId]);

  useEffect(() => {
    loadDoctors();
    pollRef.current = setInterval(loadDoctors, 20000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [loadDoctors]);

  const onRefresh = () => { setRefreshing(true); loadDoctors(); };

  const totalUnread = doctors.reduce((a, d) => a + (d.unread_count || 0), 0);

  // ── Chat thread view ────────────────────────────────────────────────────────
  if (activeDoctor) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#f0f2f5' }}>
        <ChatThread
          doctor={activeDoctor}
          elderId={elderId}
          caregiverId={caregiverId}
          onBack={() => { setActiveDoctor(null); loadDoctors(); }}
        />
      </SafeAreaView>
    );
  }

  // ── Doctor list ─────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={C.screen}>
      <View style={C.header}>
        <View>
          <Text style={C.headerTitle}>Messages</Text>
          <Text style={C.headerSub}>
            {doctors.length} Doctor{doctors.length !== 1 ? 's' : ''} Connected
            {totalUnread > 0 ? ` · ${totalUnread} unread` : ''}
          </Text>
        </View>
        {totalUnread > 0 ? (
          <View style={C.unreadHeaderBadge}>
            <Text style={C.unreadHeaderTxt}>{totalUnread} new</Text>
          </View>
        ) : null}
      </View>

      {loading ? (
        <View style={C.loadBox}>
          <ActivityIndicator size="large" color="#3498db" />
          <Text style={{ color: '#95a5a6', marginTop: 12, fontSize: 13 }}>
            {elderId ? 'Loading doctors…' : 'Connecting…'}
          </Text>
        </View>
      ) : !elderId ? (
        <View style={C.emptyBox}>
          <Text style={{ fontSize: 48, marginBottom: 14 }}>⏳</Text>
          <Text style={C.emptyTitle}>Setting up chat…</Text>
          <Text style={C.emptySub}>Please wait a moment and pull down to refresh.</Text>
        </View>
      ) : doctors.length === 0 ? (
        <View style={C.emptyBox}>
          <Text style={{ fontSize: 48, marginBottom: 14 }}>🩺</Text>
          <Text style={C.emptyTitle}>No doctors connected yet</Text>
          <Text style={C.emptySub}>
            Once a doctor connects to the elderly patient, you'll be able to message them here.
          </Text>
        </View>
      ) : (
        <FlatList
          data={doctors}
          keyExtractor={d => String(d.id)}
          contentContainerStyle={{ paddingTop: 8 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#3498db" />
          }
          ItemSeparatorComponent={() => <View style={C.separator} />}
          ListHeaderComponent={
            <View style={C.listHeader}>
              <Text style={C.listHeaderTxt}>
                {doctors.length} Physician{doctors.length !== 1 ? 's' : ''} · Tap to open chat
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <DoctorRow doctor={item} onPress={() => setActiveDoctor(item)} />
          )}
        />
      )}
    </SafeAreaView>
  );
};

// ─── Styles ───────────────────────────────────────────────────────────────────
const C = StyleSheet.create({
  screen:  { flex: 1, backgroundColor: '#f0f2f5' },
  loadBox: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#fff', paddingHorizontal: 18, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: '#ecf0f1',
    elevation: 2, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4,
  },
  headerTitle:       { fontSize: 20, fontWeight: '800', color: '#2c3e50' },
  headerSub:         { fontSize: 12, color: '#95a5a6', marginTop: 3 },
  unreadHeaderBadge: { backgroundColor: '#3498db', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 5 },
  unreadHeaderTxt:   { fontSize: 12, fontWeight: '700', color: '#fff' },

  listHeader:    { paddingHorizontal: 16, paddingVertical: 10 },
  listHeaderTxt: { fontSize: 12, color: '#95a5a6', fontWeight: '500' },

  doctorItem: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    paddingHorizontal: 16, paddingVertical: 14, gap: 12,
  },
  doctorAv:      { width: 50, height: 50, borderRadius: 25, backgroundColor: '#3498db', justifyContent: 'center', alignItems: 'center' },
  doctorAvTxt:   { fontSize: 20, fontWeight: '800', color: '#fff' },
  doctorName:    { fontSize: 15, fontWeight: '700', color: '#2c3e50' },
  doctorSpec:    { fontSize: 12, color: '#7f8c8d', marginTop: 2 },
  doctorLastMsg: { fontSize: 12, color: '#95a5a6', marginTop: 3 },
  doctorTime:    { fontSize: 11, color: '#bdc3c7' },
  unreadBadge:   { backgroundColor: '#3498db', borderRadius: 10, minWidth: 20, height: 20, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 5 },
  unreadBadgeTxt:{ fontSize: 11, fontWeight: '700', color: '#fff' },
  separator:     { height: 1, backgroundColor: '#f4f6f8', marginLeft: 78 },

  threadHeader: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff',
    paddingHorizontal: 14, paddingVertical: 13,
    borderBottomWidth: 1, borderBottomColor: '#ecf0f1', gap: 10,
    elevation: 2, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4,
  },
  backBtn:       { paddingRight: 4 },
  threadAv:      { width: 42, height: 42, borderRadius: 21, backgroundColor: '#3498db', justifyContent: 'center', alignItems: 'center' },
  threadAvTxt:   { fontSize: 17, fontWeight: '800', color: '#fff' },
  threadName:    { fontSize: 15, fontWeight: '700', color: '#2c3e50' },
  threadSpec:    { fontSize: 11, color: '#95a5a6', marginTop: 1 },
  callBtn:       { backgroundColor: '#3498db', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 7 },
  callBtnTxt:    { color: '#fff', fontSize: 12, fontWeight: '700' },

  bubbleSenderName: { fontSize: 10, color: '#95a5a6', marginBottom: 3, paddingLeft: 4, fontWeight: '600' },
  bubble:           { maxWidth: '80%', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 18 },
  bubbleMe:         { backgroundColor: '#3498db', borderBottomRightRadius: 4 },
  bubbleThem:       { backgroundColor: '#fff', borderBottomLeftRadius: 4, borderWidth: 1, borderColor: '#ecf0f1', elevation: 1 },
  bubbleMeTxt:      { color: '#fff', fontSize: 14, lineHeight: 19 },
  bubbleThemTxt:    { color: '#2c3e50', fontSize: 14, lineHeight: 19 },
  bubbleTime:       { fontSize: 10, color: '#95a5a6', marginTop: 4, textAlign: 'right' },

  inputRow:       { flexDirection: 'row', gap: 8, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#ecf0f1' },
  chatInput:      { flex: 1, backgroundColor: '#f8f9fa', borderRadius: 24, borderWidth: 1, borderColor: '#e0e0e0', paddingHorizontal: 16, paddingVertical: 10, fontSize: 14, color: '#2c3e50', maxHeight: 100 },
  sendBtn:        { width: 46, height: 46, borderRadius: 23, backgroundColor: '#3498db', justifyContent: 'center', alignItems: 'center', alignSelf: 'flex-end' },
  sendBtnDisabled:{ backgroundColor: '#bdc3c7' },

  emptyBox:  { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 },
  emptyTitle:{ fontSize: 17, fontWeight: '700', color: '#2c3e50', marginBottom: 8 },
  emptySub:  { fontSize: 13, color: '#95a5a6', textAlign: 'center', lineHeight: 20 },
});

export default CaregiverChatScreen;