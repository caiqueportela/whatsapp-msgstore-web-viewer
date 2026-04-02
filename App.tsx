import React, { useEffect, useMemo, useState } from 'react';
import { ConversationList } from './components/ConversationList';
import { ChatWindow } from './components/ChatWindow';
import { FileLoaderScreen } from './components/FileLoaderScreen';
import { Conversation, Message } from './types';
import { Database, Folder, RefreshCw } from 'lucide-react';
import {
  getConversations,
  getMediaUrl,
  getMessages,
  openDatabase,
  selectDbFile,
  selectMediaFolder,
} from './services/apiService';

const CHAT_PAGE_SIZE = 250;
const MESSAGE_PAGE_SIZE = 50;

const App: React.FC = () => {
  const [dbLoaded, setDbLoaded] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [conversationTotal, setConversationTotal] = useState(0);
  const [selectedChat, setSelectedChat] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadingConversations, setLoadingConversations] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const [messageOffset, setMessageOffset] = useState(0);
  const [messageTotal, setMessageTotal] = useState(0);
  const [conversationSearch, setConversationSearch] = useState('');
  const [messageSearch, setMessageSearch] = useState('');
  const [dbPath, setDbPath] = useState<string | null>(null);
  const [mediaRootPath, setMediaRootPath] = useState<string | null>(null);

  const hasMoreMessages = useMemo(() => messages.length < messageTotal, [messages.length, messageTotal]);

  const hydrateMediaUrls = async (input: Message[]): Promise<Message[]> => {
    const mapped = await Promise.all(
      input.map(async (message) => {
        if (!message.media_url) {
          return message;
        }

        try {
          const fullUrl = await getMediaUrl(message.media_url);
          return {
            ...message,
            media_url: fullUrl,
          };
        } catch {
          return message;
        }
      })
    );

    return mapped;
  };

  const fetchConversations = async (searchText: string) => {
    setLoadingConversations(true);
    try {
      const response = await getConversations(CHAT_PAGE_SIZE, 0, searchText);
      setConversations(response.data);
      setConversationTotal(response.total);
    } catch (err: any) {
      setError(err.message || 'Falha ao carregar conversas.');
    } finally {
      setLoadingConversations(false);
    }
  };

  const fetchMessages = async (chat: Conversation, searchText: string) => {
    setLoadingMessages(true);
    setError(null);
    try {
      const response = await getMessages(chat._id, MESSAGE_PAGE_SIZE, 0, searchText);
      const hydrated = await hydrateMediaUrls(response.data);
      setMessages(hydrated);
      setMessageOffset(response.data.length);
      setMessageTotal(response.total);
    } catch (err: any) {
      setError(err.message || 'Falha ao carregar mensagens.');
    } finally {
      setLoadingMessages(false);
    }
  };

  const loadOlderMessages = async () => {
    if (!selectedChat || loadingOlderMessages || loadingMessages || !hasMoreMessages) {
      return;
    }

    setLoadingOlderMessages(true);
    try {
      const response = await getMessages(selectedChat._id, MESSAGE_PAGE_SIZE, messageOffset, messageSearch);
      const hydrated = await hydrateMediaUrls(response.data);
      setMessages((prev) => [...hydrated, ...prev]);
      setMessageOffset((prev) => prev + response.data.length);
      setMessageTotal(response.total);
    } catch (err: any) {
      setError(err.message || 'Falha ao carregar mensagens antigas.');
    } finally {
      setLoadingOlderMessages(false);
    }
  };

  const openDatabaseFromPath = async (selectedDbPath: string) => {
    try {
      await openDatabase(selectedDbPath, mediaRootPath);
      setDbPath(selectedDbPath);
      setDbLoaded(true);
      setSelectedChat(null);
      setMessages([]);
      await fetchConversations(conversationSearch);
    } catch (err: any) {
      setError(err.message || 'Não foi possível abrir o banco selecionado.');
      setDbLoaded(false);
    }
  };

  const handleOpenDatabase = async () => {
    setError(null);
    const selectedDbPath = await selectDbFile();
    if (!selectedDbPath) {
      return;
    }

    await openDatabaseFromPath(selectedDbPath);
  };

  const handleSelectMediaFolder = async () => {
    const selectedPath = await selectMediaFolder();
    if (!selectedPath) {
      return;
    }

    setMediaRootPath(selectedPath);

    if (dbPath) {
      try {
        await openDatabase(dbPath, selectedPath);
      } catch (err: any) {
        setError(err.message || 'Falha ao atualizar pasta de mídia.');
      }
    }
  };

  const handleChatSelect = async (chat: Conversation) => {
    setSelectedChat(chat);
    setMessageSearch('');
    await fetchMessages(chat, '');
  };

  useEffect(() => {
    if (!dbLoaded) {
      return;
    }

    const timer = setTimeout(() => {
      fetchConversations(conversationSearch);
    }, 250);

    return () => clearTimeout(timer);
  }, [conversationSearch, dbLoaded]);

  useEffect(() => {
    if (!dbLoaded || !selectedChat) {
      return;
    }

    const timer = setTimeout(() => {
      fetchMessages(selectedChat, messageSearch);
    }, 250);

    return () => clearTimeout(timer);
  }, [messageSearch, selectedChat?._id, dbLoaded]);

  if (!dbLoaded) {
    return (
      <FileLoaderScreen
        error={error}
        mediaRootPath={mediaRootPath}
        onSelectMediaFolder={handleSelectMediaFolder}
        onDropFilePath={openDatabaseFromPath}
        onDropError={setError}
        onBrowseFile={handleOpenDatabase}
      />
    );
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      {/* Settings Bar */}
      <div className="bg-white border-b border-gray-200 px-4 py-2 flex items-center justify-between shadow-sm z-20">
        <div className="flex items-center space-x-2 text-green-700 font-semibold">
          <Database size={18} />
          <span>WA Viewer Pro Desktop</span>
        </div>

        <div className="flex items-center space-x-3 text-xs">
          <button
            onClick={async () => fetchConversations(conversationSearch)}
            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-700"
          >
            <RefreshCw size={12} />
            Atualizar
          </button>
          <button
            onClick={handleSelectMediaFolder}
            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-700"
          >
            <Folder size={12} />
            Mídias
          </button>
          <button
            onClick={() => {
              setDbLoaded(false);
              setSelectedChat(null);
              setConversations([]);
              setMessages([]);
              setError(null);
            }}
            className="text-red-500 hover:text-red-700 font-medium px-2"
          >
            Fechar arquivo
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex flex-1 overflow-hidden relative">
        <div className={`${selectedChat ? 'hidden md:flex' : 'flex'} w-full md:w-auto h-full flex-shrink-0 border-r border-gray-200 bg-white`}>
          <ConversationList
            conversations={conversations}
            selectedId={selectedChat?._id || null}
            onSelect={handleChatSelect}
            searchTerm={conversationSearch}
            onSearchTermChange={setConversationSearch}
            total={conversationTotal}
            loading={loadingConversations}
          />
        </div>
        <div className={`${!selectedChat ? 'hidden md:flex' : 'flex'} flex-1 h-full min-w-0 bg-[#efeae2] relative`}>
          <ChatWindow
            conversation={selectedChat}
            messages={messages}
            loading={loadingMessages}
            loadingOlder={loadingOlderMessages}
            hasMore={hasMoreMessages}
            onLoadOlder={loadOlderMessages}
            messageSearchTerm={messageSearch}
            onMessageSearchChange={setMessageSearch}
          />
          {/* Mobile Back Button Overlay */}
          {selectedChat && (
            <button
              onClick={() => setSelectedChat(null)}
              className="md:hidden absolute top-3 left-3 z-50 bg-white/80 p-2 rounded-full shadow-md text-gray-700 backdrop-blur-sm"
            >
              ← Back
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;