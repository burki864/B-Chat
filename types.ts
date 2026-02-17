
export type User = {
  id: string;
  name: string;
  avatar_url: string;
};

export type Message = {
  id: string;
  conversation_id: string;
  sender_id: string;
  text: string;
  is_ai: boolean;
  created_at: string;
};

export type ConversationType = 'dm' | 'group';

export type Conversation = {
  id: string;
  type: ConversationType;
  name?: string;
  last_active: string;
  participants?: Participant[];
  messages?: Message[];
};

export type Participant = {
  user_id: string;
  is_admin: boolean;
  status: 'joined' | 'pending';
  user?: User;
};
