
import React, { useState, useEffect, useCallback } from 'react';
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

  // Sync data on boot and user change
  useEffect(() => {
    try {
      const savedUser = localStorage.getItem('pulse_user_v2');
      if (savedUser && savedUser !== 'undefined') {
        setUser(JSON.parse(savedUser));
      }
    } catch (e) {
      console.error("Failed to parse saved user:", e);
      localStorage.removeItem('pulse_user_v2');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchData = useCallback(async () => {
    if (!user || !isSupabaseConfigured || !supabase) return;

    try {
      // Fetch all users
      const { data: users } = await supabase.from('users').select('*');
      if (users) setAllUsers(users);

      // Fetch user's conversations
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
        // Filter only convs where user is a participant
        const myConvs = convs.filter(c => 
          c.participants?.some((p: any) => p.user_id === user.id && p.status === 'joined')
        );
        setConversations(myConvs as any);
      }
    } catch (err) {
      console.error("Error fetching data:", err);
    }
  }, [user]);

  useEffect(() => {
    if (isSupabaseConfigured) {
      fetchData();
    }
  }, [fetchData]);

  // Real-time subscriptions
  useEffect(() => {
    if (!user || !isSupabaseConfigured || !supabase) return;

    try {
      const channel = supabase
        .channel('schema-db-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => {
          fetchData();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'conversation_participants' }, () => {
          fetchData();
        })
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    } catch (e) {
      console.error("Subscription error:", e);
    }
  }, [user, fetchData]);

  const handleLogin = async (name: string) => {
    if (!isSupabaseConfigured || !supabase) return;
    const id = `usr-${Math.random().toString(36).substr(2, 5)}`;
    const avatar_url = `https://picsum.photos/seed/${name}/200`;
    const newUser = { id, name, avatar_url };

    try {
      const { error } = await supabase.from('users').insert([newUser]);
      if (!error) {
        setUser(newUser);
        localStorage.setItem('pulse_user_v2', JSON.stringify(newUser));
      } else {
        console.error("Login DB error:", error);
        // Still allow login for UI purposes if table doesn't exist yet, but warned
        setUser(newUser);
      }
    } catch (e) {
      console.error("Login catch error:", e);
    }
  };

  const createDM = async (targetUserId: string) => {
    if (!user || !isSupabaseConfigured || !supabase) return;
    
    const existing = conversations.find(c => 
      c.type === 'dm' && c.participants?.some(p => p.user_id === targetUserId)
    );

    if (existing) {
      setActiveConvId(existing.id);
    } else {
      try {
        const { data: targetUser } = await supabase.from('users').select('*').eq('id', targetUserId).single();
        if (!targetUser) {
          await supabase.from('users').insert([{ 
            id: targetUserId, 
            name: `User ${targetUserId}`, 
            avatar_url: `https://picsum.photos/seed/${targetUserId}/200` 
          }]);
        }

        const { data: conv } = await supabase
          .from('conversations')
          .insert([{ type: 'dm' }])
          .select()
          .single();

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
    if (!user || !isSupabaseConfigured || !supabase) return;
    try {
      const { data: conv } = await supabase
        .from('conversations')
        .insert([{ type: 'group', name }])
        .select()
        .single();

      if (conv) {
        await supabase.from('conversation_participants').insert([
          { conversation_id: conv.id, user_id: user.id, is_admin: true, status: 'joined' }
        ]);
        setActiveConvId(conv.id);
        fetchData();
      }
    } catch (e) { console.error(e); }
    setShowAddModal(null);
  };

  const requestJoinGroup = async (groupId: string) => {
    if (!user || !isSupabaseConfigured || !supabase) return;
    try {
      await supabase.from('conversation_participants').insert([
        { conversation_id: groupId, user_id: user.id, status: 'pending' }
      ]);
      fetchData();
    } catch (e) { console.error(e); }
  };

  const handleRequest = async (groupId: string, requesterId: string, accept: boolean) => {
    if (!isSupabaseConfigured || !supabase) return;
    try {
      if (accept) {
        await supabase
          .from('conversation_participants')
          .update({ status: 'joined' })
          .match({ conversation_id: groupId, user_id: requesterId });
      } else {
        await supabase
          .from('conversation_participants')
          .delete()
          .match({ conversation_id: groupId, user_id: requesterId });
      }
      fetchData();
    } catch (e) { console.error(e); }
  };

  const sendMessage = async (text: string) => {
    if (!activeConvId || !user || !isSupabaseConfigured || !supabase) return;
    
    try {
      const { error } = await supabase.from('messages').insert([{
        conversation_id: activeConvId,
        sender_id: user.id,
        text
      }]);

      if (!error) {
        await supabase.from('conversations').update({ last_active: new Date().toISOString() }).match({ id: activeConvId });
        const conv = conversations.find(c => c.id === activeConvId);
        if (conv && (conv.participants?.some(p => p.user_id === 'usr-001') || conv.type === 'group')) {
           triggerAi(conv, text);
        }
      }
    } catch (e) { console.error(e); }
  };

  const triggerAi = async (conv: Conversation, lastMsg: string) => {
    if (!isSupabaseConfigured || !supabase) return;
    try {
      const { data: msgs } = await supabase
        .from('messages')
        .select('text, sender:users(name)')
        .eq('conversation_id', conv.id)
        .order('created_at', { ascending: false })
        .limit(5);

      if (msgs) {
        const history = msgs.reverse().map((m: any) => ({
          sender: m.sender?.name || 'User',
          text: m.text
        }));
        const reply = await gemini.generateReply(history, "Assistant");
        await supabase.from('messages').insert([{
          conversation_id: conv.id,
          sender_id: 'usr-001',
          text: reply,
          is_ai: true
        }]);
      }
    } catch (e) { console.error(e); }
  };

  if (!isSupabaseConfigured) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6 text-center">
        <div className="bg-white rounded-3xl p-10 max-w-lg shadow-2xl">
          <div className="w-20 h-20 bg-amber-100 rounded-2xl flex items-center justify-center mx-auto mb-6 text-amber-600">
            <ICONS.Plus className="w-10 h-10 rotate-45" />
          </div>
          <h2 className="text-2xl font-bold text-slate-800 mb-4">Configuration Missing</h2>
          <p className="text-slate-500 mb-6 leading-relaxed">
            Please set <strong>SUPABASE_URL</strong> and <strong>SUPABASE_ANON_KEY</strong> 
            to enable cloud persistence and real-time messaging.
          </p>
          <div className="p-4 bg-slate-50 rounded-xl text-left font-mono text-sm text-slate-600 space-y-2 overflow-x-auto">
            <div>SUPABASE_URL=https://your-id.supabase.co</div>
            <div>SUPABASE_ANON_KEY=eyJ...</div>
          </div>
        </div>
      </div>
    );
  }

  if (loading) return <div className="h-screen flex items-center justify-center font-bold text-slate-400">Initializing Pulse...</div>;
  if (!user) return <Login onLogin={handleLogin} />;

  const activeConv = conversations.find(c => c.id === activeConvId);

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden font-sans">
      <aside className={`bg-slate-900 text-white w-80 flex-shrink-0 flex flex-col transition-all duration-300 ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full absolute h-full z-20'}`}>
        <div className="p-6 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center font-bold text-lg">G</div>
            <h1 className="font-bold text-xl tracking-tight">B-Chat</h1>
          </div>
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
                        {conv.type === 'dm' ? 'Direct Message' : 'Workspace Group'}
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
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-12 text-center bg-slate-50">
             <div className="w-32 h-32 bg-white rounded-3xl shadow-xl flex items-center justify-center mb-8 rotate-3">
               <ICONS.Chat className="w-16 h-16 text-indigo-500" />
             </div>
             <h2 className="text-3xl font-bold text-slate-800">Welcome, {user.name}</h2>
             <p className="text-slate-500 mt-4 max-w-sm text-lg">Your professional workspace is ready. Select a contact or join a group to start collaborating.</p>
          </div>
        )}
      </main>

      {showAddModal === 'dm' && <DMModal allUsers={allUsers.filter(u => u.id !== user.id)} onSelect={createDM} onClose={() => setShowAddModal(null)} />}
      {showAddModal === 'group' && <GroupModal onJoin={requestJoinGroup} onCreate={createGroup} onClose={() => setShowAddModal(null)} />}
    </div>
  );
};

const ChatView: React.FC<{ user: User, conversation: Conversation, onSendMessage: (t: string) => void, onHandleRequest: (g: string, r: string, a: boolean) => void }> = ({ user, conversation, onSendMessage, onHandleRequest }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  
  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
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
  }, [conversation.id]);

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

          return (
            <div key={m.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
              <div className={`flex flex-col max-w-[75%] ${isMe ? 'items-end' : 'items-start'}`}>
                {showHeader && !isMe && <p className="text-[10px] font-bold text-slate-400 mb-1 ml-1 uppercase tracking-tighter">Sender ID: {m.sender_id}</p>}
                <div className={`p-4 rounded-2xl shadow-sm border ${isMe ? 'bg-indigo-600 text-white border-indigo-500 rounded-tr-none' : 'bg-white text-slate-800 border-slate-200 rounded-tl-none'}`}>
                  <p className="whitespace-pre-wrap">{m.text}</p>
                  {m.is_ai && <p className="mt-2 text-[10px] font-bold uppercase tracking-widest opacity-60">Generated by Gemini</p>}
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

const Login: React.FC<{ onLogin: (name: string) => void }> = ({ onLogin }) => {
  const [name, setName] = useState('');
  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white rounded-3xl p-10 shadow-2xl">
        <div className="w-16 h-16 bg-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
          <ICONS.Chat className="w-10 h-10 text-white" />
        </div>
        <h1 className="text-3xl font-bold text-center text-slate-800 mb-2">Pulse Messaging</h1>
        <p className="text-slate-400 text-center mb-10 font-medium">Professional workspace communication</p>
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
        placeholder="Type a professional message..."
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
          {/* Manual ID Entry */}
          <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
             <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Enter User ID Directly</label>
             <div className="flex gap-2">
               <input 
                 className="flex-1 p-3 bg-white border border-slate-200 rounded-xl outline-none text-sm font-mono focus:ring-2 focus:ring-indigo-100" 
                 placeholder="e.g. usr-abc12" 
                 value={manualId}
                 onChange={e => setManualId(e.target.value)}
               />
               <button 
                 onClick={() => manualId && onSelect(manualId)}
                 className="bg-indigo-600 text-white px-4 py-2 rounded-xl font-bold text-sm shadow-sm hover:bg-indigo-700 transition-colors"
               >
                 Chat
               </button>
             </div>
          </div>

          <div className="relative">
            <ICONS.Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
            <input 
              className="w-full pl-12 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-indigo-100" 
              placeholder="Search user list..." 
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3 px-2">Contacts In Workspace</p>
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

const GroupModal: React.FC<{ onCreate: (n: string) => void, onJoin: (id: string) => void, onClose: () => void }> = ({ onCreate, onJoin, onClose }) => {
  const [name, setName] = useState('');
  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-6 z-50">
      <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl p-8">
         <h2 className="text-2xl font-bold text-slate-800 mb-6">Create New Group</h2>
         <div className="space-y-6">
           <div>
             <label className="block text-sm font-bold text-slate-700 mb-2">Group Name</label>
             <input 
               className="w-full p-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-4 focus:ring-indigo-100 focus:border-indigo-500 transition-all font-medium" 
               placeholder="e.g. Design Systems" 
               value={name} 
               onChange={e => setName(e.target.value)} 
             />
           </div>
           <button 
             onClick={() => name && onCreate(name)} 
             className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-2xl shadow-xl shadow-indigo-500/20 transition-all"
           >
             Launch Group
           </button>
           <button onClick={onClose} className="w-full text-slate-400 font-bold text-sm">Cancel</button>
         </div>
      </div>
    </div>
  );
};

export default App;
