
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { User, Conversation, Message, Participant } from './types';
import { ICONS } from './constants';
import { gemini } from './services/geminiService';
import { supabase, isSupabaseConfigured } from './services/supabase';

const App: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [isSidebarOpen, setSidebarOpen] = useState(true);
  const [showAddModal, setShowAddModal] = useState<'dm' | 'group' | null>(null);
  const [loading, setLoading] = useState(true);

  // Demo Mode State (Fallback when Supabase is missing)
  const isDemo = !isSupabaseConfigured;

  // Sync data on boot
  useEffect(() => {
    try {
      const storageKey = isDemo ? 'pulse_demo_user' : 'pulse_user_v2';
      const savedUser = localStorage.getItem(storageKey);
      if (savedUser && savedUser !== 'undefined') {
        setUser(JSON.parse(savedUser));
      }
    } catch (e) {
      console.error("Failed to parse saved user:", e);
    } finally {
      setLoading(false);
    }
  }, [isDemo]);

  const fetchData = useCallback(async () => {
    if (!user) return;

    if (isDemo) {
      // Demo Logic: Load from Local Storage
      const localUsers = JSON.parse(localStorage.getItem('pulse_demo_all_users') || '[]');
      const localConvs = JSON.parse(localStorage.getItem('pulse_demo_conversations') || '[]');
      
      // Ensure AI Assistant exists in demo
      const aiUser: User = { id: 'usr-001', name: 'Gemini Assistant', avatar_url: 'https://picsum.photos/seed/ai/200' };
      if (!localUsers.find((u: User) => u.id === aiUser.id)) {
        localUsers.push(aiUser);
      }
      
      setAllUsers(localUsers);
      setConversations(localConvs.filter((c: Conversation) => 
        c.participants?.some(p => p.user_id === user.id && p.status === 'joined')
      ));
    } else if (supabase) {
      // Real Logic: Load from Supabase
      try {
        const { data: users } = await supabase.from('users').select('*');
        if (users) setAllUsers(users);

        const { data: convs } = await supabase
          .from('conversations')
          .select(`
            *,
            participants:conversation_participants(
              user_id,
              is_admin,
              status,
              user:users(*)
            )
          `)
          .order('last_active', { ascending: false });

        if (convs) {
          const myConvs = convs.filter(c => 
            c.participants?.some((p: any) => p.user_id === user.id && p.status === 'joined')
          );
          setConversations(myConvs as any);
        }
      } catch (err) {
        console.error("Error fetching data:", err);
      }
    }
  }, [user, isDemo]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Real-time subscriptions (Only for real mode)
  useEffect(() => {
    if (!user || isDemo || !supabase) return;

    try {
      const channel = supabase
        .channel('schema-db-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => fetchData())
        .on('postgres_changes', { event: '*', schema: 'public', table: 'conversation_participants' }, () => fetchData())
        .subscribe();

      return () => { supabase.removeChannel(channel); };
    } catch (e) { console.error("Subscription error:", e); }
  }, [user, fetchData, isDemo]);

  const handleLogin = async (name: string) => {
    const id = `usr-${Math.random().toString(36).substr(2, 5)}`;
    const avatar_url = `https://picsum.photos/seed/${name}/200`;
    const newUser = { id, name, avatar_url };

    if (isDemo) {
      const localUsers = JSON.parse(localStorage.getItem('pulse_demo_all_users') || '[]');
      localUsers.push(newUser);
      localStorage.setItem('pulse_demo_all_users', JSON.stringify(localUsers));
      localStorage.setItem('pulse_demo_user', JSON.stringify(newUser));
      setUser(newUser);
      fetchData();
    } else if (supabase) {
      const { error } = await supabase.from('users').insert([newUser]);
      if (!error) {
        setUser(newUser);
        localStorage.setItem('pulse_user_v2', JSON.stringify(newUser));
      }
    }
  };

  const createDM = async (targetUserId: string) => {
    if (!user) return;
    
    if (isDemo) {
      const localConvs = JSON.parse(localStorage.getItem('pulse_demo_conversations') || '[]');
      let conv = localConvs.find((c: Conversation) => 
        c.type === 'dm' && c.participants?.some(p => p.user_id === targetUserId)
      );

      if (!conv) {
        conv = {
          id: `conv-${Date.now()}`,
          type: 'dm',
          last_active: new Date().toISOString(),
          participants: [
            { user_id: user.id, is_admin: false, status: 'joined', user },
            { user_id: targetUserId, is_admin: false, status: 'joined', user: allUsers.find(u => u.id === targetUserId) }
          ],
          messages: []
        };
        localConvs.push(conv);
        localStorage.setItem('pulse_demo_conversations', JSON.stringify(localConvs));
      }
      setActiveConvId(conv.id);
      fetchData();
    } else if (supabase) {
      try {
        const { data: conv } = await supabase.from('conversations').insert([{ type: 'dm' }]).select().single();
        if (conv) {
          await supabase.from('conversation_participants').insert([
            { conversation_id: conv.id, user_id: user.id, status: 'joined' },
            { conversation_id: conv.id, user_id: targetUserId, status: 'joined' }
          ]);
          setActiveConvId(conv.id);
          fetchData();
        }
      } catch (e) { console.error(e); }
    }
    setShowAddModal(null);
  };

  const createGroup = async (name: string) => {
    if (!user) return;
    if (isDemo) {
      const localConvs = JSON.parse(localStorage.getItem('pulse_demo_conversations') || '[]');
      const conv: Conversation = {
        id: `group-${Date.now()}`,
        type: 'group',
        name,
        last_active: new Date().toISOString(),
        participants: [{ user_id: user.id, is_admin: true, status: 'joined', user }],
        messages: []
      };
      localConvs.push(conv);
      localStorage.setItem('pulse_demo_conversations', JSON.stringify(localConvs));
      setActiveConvId(conv.id);
      fetchData();
    } else if (supabase) {
      try {
        const { data: conv } = await supabase.from('conversations').insert([{ type: 'group', name }]).select().single();
        if (conv) {
          await supabase.from('conversation_participants').insert([
            { conversation_id: conv.id, user_id: user.id, is_admin: true, status: 'joined' }
          ]);
          setActiveConvId(conv.id);
          fetchData();
        }
      } catch (e) { console.error(e); }
    }
    setShowAddModal(null);
  };

  const requestJoinGroup = async (groupId: string) => {
    if (!user) return;
    if (isDemo) {
      const localConvs = JSON.parse(localStorage.getItem('pulse_demo_conversations') || '[]');
      const conv = localConvs.find((c: Conversation) => c.id === groupId);
      if (conv) {
        conv.participants.push({ user_id: user.id, is_admin: false, status: 'pending', user });
        localStorage.setItem('pulse_demo_conversations', JSON.stringify(localConvs));
        fetchData();
      }
    } else if (supabase) {
      await supabase.from('conversation_participants').insert([{ conversation_id: groupId, user_id: user.id, status: 'pending' }]);
      fetchData();
    }
  };

  const handleRequest = async (groupId: string, requesterId: string, accept: boolean) => {
    if (isDemo) {
      const localConvs = JSON.parse(localStorage.getItem('pulse_demo_conversations') || '[]');
      const conv = localConvs.find((c: Conversation) => c.id === groupId);
      if (conv) {
        if (accept) {
          const p = conv.participants.find((p: any) => p.user_id === requesterId);
          if (p) p.status = 'joined';
        } else {
          conv.participants = conv.participants.filter((p: any) => p.user_id !== requesterId);
        }
        localStorage.setItem('pulse_demo_conversations', JSON.stringify(localConvs));
        fetchData();
      }
    } else if (supabase) {
      if (accept) {
        await supabase.from('conversation_participants').update({ status: 'joined' }).match({ conversation_id: groupId, user_id: requesterId });
      } else {
        await supabase.from('conversation_participants').delete().match({ conversation_id: groupId, user_id: requesterId });
      }
      fetchData();
    }
  };

  const sendMessage = async (text: string) => {
    if (!activeConvId || !user) return;
    
    if (isDemo) {
      const localConvs = JSON.parse(localStorage.getItem('pulse_demo_conversations') || '[]');
      const conv = localConvs.find((c: Conversation) => c.id === activeConvId);
      if (conv) {
        const msg: Message = {
          id: `msg-${Date.now()}`,
          conversation_id: activeConvId,
          sender_id: user.id,
          text,
          is_ai: false,
          created_at: new Date().toISOString()
        };
        conv.messages = conv.messages || [];
        conv.messages.push(msg);
        conv.last_active = new Date().toISOString();
        localStorage.setItem('pulse_demo_conversations', JSON.stringify(localConvs));
        fetchData();
        
        if (conv.participants?.some(p => p.user_id === 'usr-001') || conv.type === 'group') {
          triggerAiDemo(conv);
        }
      }
    } else if (supabase) {
      const { error } = await supabase.from('messages').insert([{ conversation_id: activeConvId, sender_id: user.id, text }]);
      if (!error) {
        await supabase.from('conversations').update({ last_active: new Date().toISOString() }).match({ id: activeConvId });
        const conv = conversations.find(c => c.id === activeConvId);
        if (conv && (conv.participants?.some(p => p.user_id === 'usr-001') || conv.type === 'group')) {
           triggerAiReal(conv);
        }
      }
    }
  };

  const triggerAiDemo = async (conv: Conversation) => {
    const history = (conv.messages || []).slice(-5).map(m => ({
      sender: allUsers.find(u => u.id === m.sender_id)?.name || 'User',
      text: m.text
    }));
    const reply = await gemini.generateReply(history, "Assistant");
    
    const localConvs = JSON.parse(localStorage.getItem('pulse_demo_conversations') || '[]');
    const targetConv = localConvs.find((c: Conversation) => c.id === conv.id);
    if (targetConv) {
      targetConv.messages.push({
        id: `msg-ai-${Date.now()}`,
        conversation_id: conv.id,
        sender_id: 'usr-001',
        text: reply,
        is_ai: true,
        created_at: new Date().toISOString()
      });
      localStorage.setItem('pulse_demo_conversations', JSON.stringify(localConvs));
      fetchData();
    }
  };

  const triggerAiReal = async (conv: Conversation) => {
    if (!supabase) return;
    const { data: msgs } = await supabase.from('messages').select('text, sender:users(name)').eq('conversation_id', conv.id).order('created_at', { ascending: false }).limit(5);
    if (msgs) {
      const history = msgs.reverse().map((m: any) => ({ sender: m.sender?.name || 'User', text: m.text }));
      const reply = await gemini.generateReply(history, "Assistant");
      await supabase.from('messages').insert([{ conversation_id: conv.id, sender_id: 'usr-001', text: reply, is_ai: true }]);
    }
  };

  if (loading) return <div className="h-screen flex items-center justify-center font-bold text-slate-400">Initializing...</div>;
  if (!user) return <Login onLogin={handleLogin} isDemo={isDemo} />;

  const activeConv = conversations.find(c => c.id === activeConvId);

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden font-sans">
      <aside className={`bg-slate-900 text-white w-80 flex-shrink-0 flex flex-col transition-all duration-300 ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full absolute h-full z-20'}`}>
        <div className="p-6 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center font-bold text-lg">G</div>
            <h1 className="font-bold text-xl tracking-tight">B-Chat</h1>
          </div>
          {isDemo && <span className="text-[10px] bg-amber-500/20 text-amber-500 px-2 py-1 rounded-full font-bold uppercase">Demo</span>}
        </div>

        <div className="p-4 flex-1 overflow-y-auto space-y-6">
          <div className="flex items-center gap-3 p-3 bg-slate-800 rounded-xl">
            <img src={user.avatar_url} className="w-10 h-10 rounded-full border-2 border-indigo-500" />
            <div className="flex-1 min-w-0">
              <p className="font-semibold truncate">{user.name}</p>
              <p className="text-xs text-slate-400 truncate">ID: {user.id}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setShowAddModal('dm')} className="flex items-center justify-center gap-2 p-3 bg-slate-800 hover:bg-slate-700 rounded-xl text-sm transition-all shadow-sm">
              <ICONS.Plus className="w-4 h-4" /> DM
            </button>
            <button onClick={() => setShowAddModal('group')} className="flex items-center justify-center gap-2 p-3 bg-indigo-600 hover:bg-indigo-700 rounded-xl text-sm transition-all shadow-lg">
              <ICONS.Group className="w-4 h-4" /> Group
            </button>
          </div>

          <div>
            <h2 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3 px-2">Conversations</h2>
            <div className="space-y-1">
              {conversations.length === 0 && (
                <p className="text-slate-500 text-xs px-2 py-4 italic">No active conversations</p>
              )}
              {conversations.map(conv => {
                const otherParticipant = conv.type === 'dm' ? conv.participants?.find(p => p.user_id !== user.id) : null;
                const isActive = activeConvId === conv.id;
                const displayName = conv.type === 'dm' ? (otherParticipant?.user?.name || `User ${otherParticipant?.user_id}`) : conv.name;
                const displayAvatar = conv.type === 'dm' ? (otherParticipant?.user?.avatar_url || `https://picsum.photos/seed/${otherParticipant?.user_id}/200`) : `https://picsum.photos/seed/${conv.name}/200`;

                return (
                  <button key={conv.id} onClick={() => setActiveConvId(conv.id)} className={`w-full flex items-center gap-3 p-3 rounded-xl transition-all ${isActive ? 'bg-indigo-600 text-white' : 'hover:bg-slate-800'}`}>
                    <img src={displayAvatar} className="w-11 h-11 rounded-full object-cover border-2 border-slate-700" />
                    <div className="text-left flex-1 min-w-0">
                      <p className="font-semibold truncate">{displayName}</p>
                      <p className="text-[10px] truncate opacity-60 uppercase tracking-tighter">
                        {conv.type === 'dm' ? 'Direct Message' : 'Group'}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </aside>

      <main className="flex-1 flex flex-col relative min-w-0">
        {activeConv ? (
          <ChatView 
            user={user} 
            conversation={activeConv} 
            onSendMessage={sendMessage} 
            onHandleRequest={handleRequest}
            isDemo={isDemo}
            allUsers={allUsers}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-12 text-center bg-slate-50">
             <div className="w-32 h-32 bg-white rounded-3xl shadow-xl flex items-center justify-center mb-8 rotate-3">
               <ICONS.Chat className="w-16 h-16 text-indigo-500" />
             </div>
             <h2 className="text-3xl font-bold text-slate-800">Welcome, {user.name}</h2>
             <p className="text-slate-500 mt-4 max-w-sm text-lg">Your workspace is ready. Select a contact or join a group to start collaborating.</p>
             {isDemo && (
               <div className="mt-8 p-4 bg-amber-50 border border-amber-100 rounded-2xl text-amber-700 text-sm flex items-center gap-3">
                 <ICONS.Plus className="w-5 h-5 rotate-45" />
                 <span>Running in <strong>Demo Mode</strong>. Cloud features disabled.</span>
               </div>
             )}
          </div>
        )}
      </main>

      {showAddModal === 'dm' && <DMModal allUsers={allUsers.filter(u => u.id !== user.id)} onSelect={createDM} onClose={() => setShowAddModal(null)} />}
      {showAddModal === 'group' && <GroupModal onJoin={requestJoinGroup} onCreate={createGroup} onClose={() => setShowAddModal(null)} isDemo={isDemo} conversations={conversations} />}
    </div>
  );
};

const ChatView: React.FC<{ user: User, conversation: Conversation, onSendMessage: (t: string) => void, onHandleRequest: (g: string, r: string, a: boolean) => void, isDemo: boolean, allUsers: User[] }> = ({ user, conversation, onSendMessage, onHandleRequest, isDemo, allUsers }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  
  useEffect(() => {
    if (isDemo) {
      setMessages(conversation.messages || []);
    } else if (supabase) {
      const loadMessages = async () => {
        try {
          const { data } = await supabase.from('messages').select('*').eq('conversation_id', conversation.id).order('created_at', { ascending: true });
          if (data) setMessages(data);
        } catch (e) { console.error(e); }
      };
      loadMessages();

      const channel = supabase.channel(`msgs-${conversation.id}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversation.id}` }, (payload) => {
          setMessages(prev => {
            if (prev.find(m => m.id === payload.new.id)) return prev;
            return [...prev, payload.new as Message];
          });
        })
        .subscribe();

      return () => { supabase.removeChannel(channel); };
    }
  }, [conversation.id, conversation.messages, isDemo]);

  const participants = conversation.participants || [];
  const pending = participants.filter(p => p.status === 'pending');
  const isAdmin = participants.find(p => p.user_id === user.id)?.is_admin;
  const otherParticipant = conversation.type === 'dm' ? participants.find(p => p.user_id !== user.id) : null;
  const displayName = conversation.type === 'dm' ? (otherParticipant?.user?.name || `User ${otherParticipant?.user_id}`) : conversation.name;

  return (
    <div className="flex flex-col h-full bg-white">
      <header className="h-20 bg-white border-b px-6 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-4">
          <img 
            src={conversation.type === 'dm' ? (otherParticipant?.user?.avatar_url || `https://picsum.photos/seed/${otherParticipant?.user_id}/200`) : `https://picsum.photos/seed/${conversation.name}/200`}
            className="w-10 h-10 rounded-full border shadow-sm"
          />
          <div>
            <h2 className="font-bold text-lg text-slate-800">{displayName}</h2>
            <p className="text-[10px] text-slate-400 uppercase font-bold tracking-widest">{conversation.type}</p>
          </div>
        </div>
      </header>

      {isAdmin && pending.length > 0 && (
        <div className="bg-amber-50 p-4 border-b border-amber-100 flex flex-col gap-2">
          <p className="text-[10px] font-bold text-amber-800 uppercase tracking-widest px-1">Pending Access Requests</p>
          {pending.map(p => (
            <div key={p.user_id} className="flex items-center justify-between bg-white p-3 rounded-xl shadow-sm border border-amber-100">
               <span className="text-sm font-semibold text-slate-700">{p.user?.name || p.user_id}</span>
               <div className="flex gap-2">
                 <button onClick={() => onHandleRequest(conversation.id, p.user_id, true)} className="bg-green-500 hover:bg-green-600 text-white p-2 rounded-lg transition-colors"><ICONS.Check className="w-4 h-4" /></button>
                 <button onClick={() => onHandleRequest(conversation.id, p.user_id, false)} className="bg-red-500 hover:bg-red-600 text-white p-2 rounded-lg transition-colors"><ICONS.X className="w-4 h-4" /></button>
               </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-slate-50/30">
        {messages.map((m, idx) => {
          const isMe = m.sender_id === user.id;
          const showHeader = idx === 0 || messages[idx-1].sender_id !== m.sender_id;
          const sender = allUsers.find(u => u.id === m.sender_id);

          return (
            <div key={m.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
              <div className={`flex flex-col max-w-[75%] ${isMe ? 'items-end' : 'items-start'}`}>
                {showHeader && !isMe && <p className="text-[10px] font-bold text-slate-400 mb-1 ml-1 uppercase tracking-tighter">{sender?.name || m.sender_id}</p>}
                <div className={`p-4 rounded-2xl shadow-sm border ${isMe ? 'bg-indigo-600 text-white border-indigo-500 rounded-tr-none' : 'bg-white text-slate-800 border-slate-200 rounded-tl-none'}`}>
                  <p className="whitespace-pre-wrap">{m.text}</p>
                  {m.is_ai && <p className="mt-2 text-[10px] font-bold uppercase tracking-widest opacity-60">AI Assistant</p>}
                </div>
                <p className="text-[10px] text-slate-400 mt-1 px-1">{new Date(m.created_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</p>
              </div>
            </div>
          );
        })}
      </div>

      <footer className="p-6 bg-white border-t border-slate-100">
        <ChatInput onSend={onSendMessage} />
      </footer>
    </div>
  );
};

const Login: React.FC<{ onLogin: (name: string) => void, isDemo: boolean }> = ({ onLogin, isDemo }) => {
  const [name, setName] = useState('');
  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white rounded-3xl p-10 shadow-2xl">
        <div className="w-16 h-16 bg-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
          <ICONS.Chat className="w-10 h-10 text-white" />
        </div>
        <h1 className="text-3xl font-bold text-center text-slate-800 mb-2">Pulse B-Chat</h1>
        <p className="text-slate-400 text-center mb-4 font-medium">Communication Workspace</p>
        
        {isDemo && (
          <div className="bg-amber-50 text-amber-700 p-4 rounded-2xl text-xs font-medium mb-8 text-center border border-amber-100">
            Note: You are entering in <strong>Demo Mode</strong> as Supabase credentials are not detected.
          </div>
        )}

        <form onSubmit={e => { e.preventDefault(); if(name.trim()) onLogin(name.trim()); }} className="space-y-6">
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">Display Name</label>
            <input 
              className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-4 focus:ring-indigo-100 focus:border-indigo-500 transition-all font-medium" 
              placeholder="e.g. Alex Carter" 
              value={name}
              onChange={e => setName(e.target.value)}
              required
            />
          </div>
          <button type="submit" className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-2xl shadow-xl shadow-indigo-500/20 transition-all active:scale-95">
            Join Workspace
          </button>
        </form>
      </div>
    </div>
  );
};

const ChatInput: React.FC<{ onSend: (text: string) => void }> = ({ onSend }) => {
  const [text, setText] = useState('');
  const submit = () => {
    if (text.trim()) {
      onSend(text);
      setText('');
    }
  };
  return (
    <div className="flex gap-3 max-w-4xl mx-auto">
      <input 
        className="flex-1 bg-slate-50 p-4 border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-indigo-200 focus:bg-white transition-all font-medium" 
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && submit()}
        placeholder="Type a message..."
      />
      <button onClick={submit} className="p-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl shadow-lg shadow-indigo-500/10 transition-all active:scale-95 flex-shrink-0">
        <ICONS.Send className="w-6 h-6" />
      </button>
    </div>
  );
};

const DMModal: React.FC<{ allUsers: User[], onSelect: (id: string) => void, onClose: () => void }> = ({ allUsers, onSelect, onClose }) => {
  const [manualId, setManualId] = useState('');
  const [search, setSearch] = useState('');
  const filtered = allUsers.filter(u => u.name.toLowerCase().includes(search.toLowerCase()) || u.id.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-6 z-50">
      <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-2xl font-bold text-slate-800">New Direct Message</h2>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-xl transition-colors"><ICONS.X className="w-6 h-6" /></button>
        </div>
        
        <div className="p-6 space-y-6 overflow-y-auto">
          <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
             <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">User ID</label>
             <div className="flex gap-2">
               <input className="flex-1 p-3 bg-white border border-slate-200 rounded-xl outline-none text-sm font-mono" placeholder="usr-xyz12" value={manualId} onChange={e => setManualId(e.target.value)} />
               <button onClick={() => manualId && onSelect(manualId)} className="bg-indigo-600 text-white px-4 py-2 rounded-xl font-bold text-sm shadow-sm hover:bg-indigo-700">Chat</button>
             </div>
          </div>

          <div className="relative">
            <ICONS.Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-indigo-100" placeholder="Search users..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>

          <div className="space-y-1">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3 px-2">Contacts</p>
            {filtered.map(u => (
              <button key={u.id} onClick={() => onSelect(u.id)} className="w-full flex items-center gap-4 p-4 hover:bg-indigo-50 rounded-2xl transition-all group border border-transparent hover:border-indigo-100">
                <img src={u.avatar_url} className="w-12 h-12 rounded-full border shadow-sm" />
                <div className="text-left flex-1">
                  <p className="font-bold text-slate-800 group-hover:text-indigo-700 transition-colors">{u.name}</p>
                  <p className="text-[10px] text-slate-400 font-mono">ID: {u.id}</p>
                </div>
                <ICONS.Plus className="w-5 h-5 text-slate-200 group-hover:text-indigo-500" />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

const GroupModal: React.FC<{ onCreate: (n: string) => void, onJoin: (id: string) => void, onClose: () => void, isDemo: boolean, conversations: Conversation[] }> = ({ onCreate, onJoin, onClose, isDemo, conversations }) => {
  const [name, setName] = useState('');
  const [tab, setTab] = useState<'create' | 'join'>('create');

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-6 z-50">
      <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden flex flex-col">
         <div className="p-6 border-b border-slate-100 flex items-center justify-between">
           <h2 className="text-2xl font-bold text-slate-800">Groups</h2>
           <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-xl transition-colors"><ICONS.X className="w-6 h-6" /></button>
         </div>

         <div className="flex border-b">
           <button onClick={() => setTab('create')} className={`flex-1 py-4 text-xs font-bold uppercase tracking-widest ${tab === 'create' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-slate-400'}`}>Create</button>
           <button onClick={() => setTab('join')} className={`flex-1 py-4 text-xs font-bold uppercase tracking-widest ${tab === 'join' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-slate-400'}`}>Browse</button>
         </div>

         <div className="p-8">
           {tab === 'create' ? (
             <div className="space-y-6">
               <div>
                 <label className="block text-sm font-bold text-slate-700 mb-2">Group Name</label>
                 <input className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-4 focus:ring-indigo-100" placeholder="e.g. Marketing Team" value={name} onChange={e => setName(e.target.value)} />
               </div>
               <button onClick={() => name && onCreate(name)} className="w-full py-4 bg-indigo-600 text-white font-bold rounded-2xl shadow-xl shadow-indigo-500/20">Launch Group</button>
             </div>
           ) : (
             <div className="space-y-2 max-h-[40vh] overflow-y-auto">
               <p className="text-xs text-slate-400 text-center py-8">No public groups found in this workspace yet.</p>
             </div>
           )}
         </div>
      </div>
    </div>
  );
};

export default App;
