export interface Conversation {
  _id: number;
  jid: string;
  subject: string | null;
  display_name?: string;
  timestamp: number;
  messageCount?: number;
}

export interface Message {
  _id: number;
  from_me: boolean;
  text_data: string | null;
  timestamp: number;
  quoted_text: string | null;
  has_media: boolean;
  sender_name?: string | null;
  media_path?: string | null;
  media_mime_type?: string | null;
  media_url?: string | null;
  media_thumbnail_url?: string | null;
  media_type?: string;
}

export interface DbStats {
  chatCount: number;
  messageCount: number;
}
