import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useScreenShare } from '@/hooks/useScreenShare';
import { useWebRTCPeer } from '@/hooks/useWebRTCPeer';
import { useRoom } from '@/hooks/useRoom';
import { VideoPreview } from '@/components/VideoPreview';
import { StatusBadge } from '@/components/StatusBadge';
import { StreamMetadata } from '@/components/StreamMetadata';
import { ChatPanel } from '@/components/ChatPanel';
import { ViewerRequestCard, ViewerListCard } from '@/components/ViewerCard';

export default function HostRoomPage() {
  const { roomCode } = useParams<{ roomCode: string }>();
  const navigate = useNavigate();
  const hostId = sessionStorage.getItem(`host_${roomCode}`) || '';
  const hostName = sessionStorage.getItem(`name_${roomCode}`) || 'Host';

  const {
    state: shareState,
    stream,
    metadata,
    error: shareError,
    startSharing,
    stopSharing,
    pauseSharing,
    resumeSharing,
  } = useScreenShare();

  const {
    room,
    joinRequests,
    messages,
    viewers,
    fetchRoom,
    updateSharingState,
    endRoom,
    handleJoinRequest,
    sendMessage,
    trackPresence,
  } = useRoom();

  const {
    connectionState,
    createOffer,
    setLocalStream,
  } = useWebRTCPeer(roomCode || '', hostId, true);

  const [copied, setCopied] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<'requests' | 'viewers' | 'chat'>('requests');
  const [connectedViewers, setConnectedViewers] = useState<Set<string>>(new Set());

  // Verify host access
  useEffect(() => {
    if (!hostId && roomCode) {
      navigate(`/room/${roomCode}/join`);
    }
  }, [hostId, roomCode, navigate]);

  // Fetch room on mount
  useEffect(() => {
    if (roomCode) {
      fetchRoom(roomCode);
    }
  }, [roomCode, fetchRoom]);

  // Track host presence
  useEffect(() => {
    if (room && hostId) {
      trackPresence(hostId, hostName);
    }
  }, [room, hostId, hostName, trackPresence]);

  // Update stream for WebRTC
  useEffect(() => {
    console.log('Setting local stream:', stream ? 'available' : 'null');
    setLocalStream(stream);
  }, [stream, setLocalStream]);

  // Update sharing state in database
  useEffect(() => {
    if (room) {
      const isSharing = shareState === 'active' || shareState === 'paused';
      const isPaused = shareState === 'paused';
      updateSharingState(isSharing, isPaused);
    }
  }, [shareState, room, updateSharingState]);

  // Create offers for newly approved viewers
  useEffect(() => {
    const approvedViewers = joinRequests.filter(r => r.status === 'approved');
    console.log('Approved viewers:', approvedViewers.length, 'Connected:', connectedViewers.size);
    
    approvedViewers.forEach((request) => {
      // Create offer if we haven't already for this viewer
      if (!connectedViewers.has(request.viewer_id)) {
        console.log('Creating offer for viewer:', request.viewer_id);
        createOffer(request.viewer_id);
        setConnectedViewers(prev => new Set([...prev, request.viewer_id]));
      }
    });
  }, [joinRequests, createOffer, connectedViewers]);

  const handleCopyCode = useCallback(async () => {
    if (roomCode) {
      await navigator.clipboard.writeText(roomCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [roomCode]);

  const handleEndSession = useCallback(async () => {
    stopSharing();
    await endRoom();
    navigate(`/room/${roomCode}/end?role=host`);
  }, [stopSharing, endRoom, navigate, roomCode]);

  const handleSendMessage = useCallback((message: string) => {
    sendMessage(hostId, hostName, message);
  }, [sendMessage, hostId, hostName]);

  const pendingRequests = joinRequests.filter(r => r.status === 'pending');
  const approvedViewers = joinRequests.filter(r => r.status === 'approved');

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="flex-shrink-0 h-16 px-6 border-b border-border flex items-center justify-between bg-card">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
              <svg className="w-4 h-4 text-primary-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <span className="font-semibold">Host Room</span>
          </div>
          
          <div className="h-8 w-px bg-border" />
          
          <button
            onClick={handleCopyCode}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted hover:bg-muted/80 transition-colors"
          >
            <span className="text-sm font-mono font-bold tracking-wider">{roomCode}</span>
            <svg className="w-4 h-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            {copied && <span className="text-xs text-success">Copied!</span>}
          </button>
        </div>

        <div className="flex items-center gap-4">
          <StatusBadge 
            status={shareState === 'active' ? 'active' : shareState === 'paused' ? 'paused' : 'idle'} 
          />
          <button
            onClick={handleEndSession}
            className="h-9 px-4 rounded-lg bg-destructive text-destructive-foreground text-sm font-medium hover:bg-destructive/90 transition-colors"
          >
            End Session
          </button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Video Area */}
        <div className="flex-1 p-6 flex flex-col">
          <div className="flex-1 rounded-xl overflow-hidden border border-border bg-card">
            <VideoPreview 
              stream={stream} 
              showOverlay={shareState === 'paused'}
              overlayText="Sharing paused"
            />
          </div>

          {/* Stream Controls */}
          <div className="mt-4 flex items-center justify-between">
            <StreamMetadata metadata={metadata} />
            
            <div className="flex items-center gap-3">
              {shareState === 'idle' || shareState === 'stopped' || shareState === 'cancelled' || shareState === 'denied' ? (
                <button
                  onClick={startSharing}
                  className="h-10 px-6 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  Start Sharing
                </button>
              ) : shareState === 'requesting' ? (
                <button
                  disabled
                  className="h-10 px-6 rounded-lg bg-primary text-primary-foreground font-medium opacity-50 flex items-center gap-2"
                >
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Requesting...
                </button>
              ) : (
                <>
                  {shareState === 'active' ? (
                    <button
                      onClick={pauseSharing}
                      className="h-10 px-4 rounded-lg bg-warning text-warning-foreground font-medium hover:bg-warning/90 transition-colors flex items-center gap-2"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Pause
                    </button>
                  ) : shareState === 'paused' ? (
                    <button
                      onClick={resumeSharing}
                      className="h-10 px-4 rounded-lg bg-success text-success-foreground font-medium hover:bg-success/90 transition-colors flex items-center gap-2"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Resume
                    </button>
                  ) : null}
                  <button
                    onClick={stopSharing}
                    className="h-10 px-4 rounded-lg bg-destructive text-destructive-foreground font-medium hover:bg-destructive/90 transition-colors flex items-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
                    </svg>
                    Stop
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Error Message */}
          {shareError && (
            <div className="mt-4 p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive">
              <p className="text-sm">{shareError}</p>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="w-80 border-l border-border bg-card flex flex-col">
          {/* Sidebar Tabs */}
          <div className="flex border-b border-border">
            <button
              onClick={() => setSidebarTab('requests')}
              className={`flex-1 py-3 text-sm font-medium transition-colors relative ${
                sidebarTab === 'requests' 
                  ? 'text-primary' 
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Requests
              {pendingRequests.length > 0 && (
                <span className="absolute top-2 right-2 w-5 h-5 rounded-full bg-destructive text-destructive-foreground text-xs flex items-center justify-center">
                  {pendingRequests.length}
                </span>
              )}
              {sidebarTab === 'requests' && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
              )}
            </button>
            <button
              onClick={() => setSidebarTab('viewers')}
              className={`flex-1 py-3 text-sm font-medium transition-colors relative ${
                sidebarTab === 'viewers' 
                  ? 'text-primary' 
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Viewers ({approvedViewers.length})
              {sidebarTab === 'viewers' && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
              )}
            </button>
            <button
              onClick={() => setSidebarTab('chat')}
              className={`flex-1 py-3 text-sm font-medium transition-colors relative ${
                sidebarTab === 'chat' 
                  ? 'text-primary' 
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Chat
              {sidebarTab === 'chat' && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
              )}
            </button>
          </div>

          {/* Sidebar Content */}
          <div className="flex-1 overflow-hidden">
            {sidebarTab === 'requests' && (
              <div className="h-full overflow-y-auto p-4 space-y-3">
                {pendingRequests.length === 0 ? (
                  <p className="text-center text-muted-foreground text-sm py-8">
                    No pending requests
                  </p>
                ) : (
                  pendingRequests.map((request) => (
                    <ViewerRequestCard
                      key={request.id}
                      request={request}
                      onApprove={() => handleJoinRequest(request.id, true)}
                      onReject={() => handleJoinRequest(request.id, false)}
                    />
                  ))
                )}
              </div>
            )}

            {sidebarTab === 'viewers' && (
              <div className="h-full overflow-y-auto p-4 space-y-3">
                {approvedViewers.length === 0 ? (
                  <p className="text-center text-muted-foreground text-sm py-8">
                    No viewers yet
                  </p>
                ) : (
                  approvedViewers.map((request) => {
                    const viewer = viewers.find(v => v.id === request.viewer_id);
                    return (
                      <ViewerListCard
                        key={request.id}
                        viewer={{
                          id: request.viewer_id,
                          name: request.viewer_name,
                          online: viewer?.online ?? false,
                        }}
                      />
                    );
                  })
                )}
              </div>
            )}

            {sidebarTab === 'chat' && (
              <ChatPanel
                messages={messages}
                currentUserId={hostId}
                onSendMessage={handleSendMessage}
                className="h-full"
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
