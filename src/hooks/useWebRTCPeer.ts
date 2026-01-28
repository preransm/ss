import { useState, useCallback, useRef, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { RealtimeChannel } from '@supabase/supabase-js';

export type PeerConnectionState = 
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'failed';

interface SignalingMessage {
  type: 'offer' | 'answer' | 'ice-candidate';
  payload: any;
  from: string;
  to?: string;
}

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

export interface UseWebRTCPeerReturn {
  connectionState: PeerConnectionState;
  remoteStream: MediaStream | null;
  createOffer: (viewerId: string) => Promise<void>;
  handleOffer: (offer: RTCSessionDescriptionInit, hostId: string) => Promise<void>;
  handleAnswer: (answer: RTCSessionDescriptionInit, viewerId: string) => void;
  handleIceCandidate: (candidate: RTCIceCandidateInit) => void;
  setLocalStream: (stream: MediaStream | null) => void;
  cleanup: () => void;
}

export function useWebRTCPeer(
  roomCode: string,
  peerId: string,
  isHost: boolean
): UseWebRTCPeerReturn {
  const [connectionState, setConnectionState] = useState<PeerConnectionState>('idle');
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const pendingCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());

  const setLocalStream = useCallback((stream: MediaStream | null) => {
    console.log('Setting local stream:', stream ? `${stream.getTracks().length} tracks` : 'null');
    localStreamRef.current = stream;
    
    // Add or update tracks in all existing peer connections
    peerConnectionsRef.current.forEach((pc, remotePeerId) => {
      if (stream) {
        stream.getTracks().forEach(track => {
          const senders = pc.getSenders();
          const existingSender = senders.find(s => s.track?.kind === track.kind);
          if (existingSender) {
            console.log('Replacing track:', track.kind, 'for', remotePeerId);
            existingSender.replaceTrack(track);
          } else {
            console.log('Adding track:', track.kind, 'for', remotePeerId);
            pc.addTrack(track, stream);
          }
        });
      } else {
        // Remove all tracks
        const senders = pc.getSenders();
        senders.forEach(sender => {
          console.log('Removing track:', sender.track?.kind, 'for', remotePeerId);
          pc.removeTrack(sender);
        });
      }
    });
  }, []);

  const createPeerConnection = useCallback((remotePeerId: string): RTCPeerConnection => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    pc.onicecandidate = (event) => {
      if (event.candidate && channelRef.current) {
        channelRef.current.send({
          type: 'broadcast',
          event: 'signaling',
          payload: {
            type: 'ice-candidate',
            payload: event.candidate.toJSON(),
            from: peerId,
            to: remotePeerId,
          } as SignalingMessage,
        });
      }
    };

    pc.onconnectionstatechange = () => {
      switch (pc.connectionState) {
        case 'connecting':
          setConnectionState('connecting');
          break;
        case 'connected':
          setConnectionState('connected');
          break;
        case 'disconnected':
          setConnectionState('disconnected');
          break;
        case 'failed':
          setConnectionState('failed');
          break;
      }
    };

    pc.ontrack = (event) => {
      console.log('Track received:', event.track.kind, 'from remote peer');
      console.log('Streams:', event.streams);
      if (event.streams && event.streams.length > 0) {
        console.log('Setting remote stream with', event.streams[0].getTracks().length, 'tracks');
        setRemoteStream(event.streams[0]);
      }
    };

    pc.onicegatheringstatechange = () => {
      console.log('ICE gathering state:', pc.iceGatheringState);
    };

    // Add local stream tracks if available
    if (localStreamRef.current) {
      console.log('Adding local tracks to peer connection');
      localStreamRef.current.getTracks().forEach(track => {
        console.log('Adding track:', track.kind);
        pc.addTrack(track, localStreamRef.current!);
      });
    } else {
      console.log('No local stream available yet');
    }

    peerConnectionsRef.current.set(remotePeerId, pc);
    return pc;
  }, [peerId]);

  const createOffer = useCallback(async (viewerId: string) => {
    console.log('Creating peer connection for viewer:', viewerId);
    const pc = createPeerConnection(viewerId);
    setConnectionState('connecting');

    try {
      console.log('Creating offer...');
      const offer = await pc.createOffer();
      console.log('Offer created, setting local description');
      await pc.setLocalDescription(offer);
      console.log('Local description set, sending offer via signaling channel');

      if (channelRef.current) {
        channelRef.current.send({
          type: 'broadcast',
          event: 'signaling',
          payload: {
            type: 'offer',
            payload: offer,
            from: peerId,
            to: viewerId,
          } as SignalingMessage,
        });
        console.log('Offer sent to viewer:', viewerId);
      } else {
        console.error('Signaling channel not available');
      }
    } catch (error) {
      console.error('Error creating offer:', error);
      setConnectionState('failed');
    }
  }, [createPeerConnection, peerId]);

  const handleOffer = useCallback(async (offer: RTCSessionDescriptionInit, hostId: string) => {
    const pc = createPeerConnection(hostId);
    setConnectionState('connecting');

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      
      // Process any pending ICE candidates
      const pending = pendingCandidatesRef.current.get(hostId) || [];
      for (const candidate of pending) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      }
      pendingCandidatesRef.current.delete(hostId);

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      if (channelRef.current) {
        channelRef.current.send({
          type: 'broadcast',
          event: 'signaling',
          payload: {
            type: 'answer',
            payload: answer,
            from: peerId,
            to: hostId,
          } as SignalingMessage,
        });
      }
    } catch (error) {
      console.error('Error handling offer:', error);
      setConnectionState('failed');
    }
  }, [createPeerConnection, peerId]);

  const handleAnswer = useCallback((answer: RTCSessionDescriptionInit, viewerId: string) => {
    // Get the connection for this specific viewer
    const pc = peerConnectionsRef.current.get(viewerId);
    if (pc && pc.signalingState === 'have-local-offer') {
      try {
        pc.setRemoteDescription(new RTCSessionDescription(answer));
        console.log('Answer set for viewer:', viewerId);
      } catch (error) {
        console.error('Error setting remote description:', error);
      }
    } else {
      console.warn('No matching connection for answer from viewer:', viewerId, 'state:', pc?.signalingState);
    }
  }, []);

  const handleIceCandidate = useCallback((candidate: RTCIceCandidateInit) => {
    peerConnectionsRef.current.forEach(async (pc) => {
      if (pc.remoteDescription) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (error) {
          console.error('Error adding ICE candidate:', error);
        }
      }
    });
  }, []);

  const cleanup = useCallback(() => {
    peerConnectionsRef.current.forEach((pc) => {
      pc.close();
    });
    peerConnectionsRef.current.clear();
    
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    
    setRemoteStream(null);
    setConnectionState('idle');
    pendingCandidatesRef.current.clear();
  }, []);

  // Set up signaling channel
  useEffect(() => {
    console.log('Setting up signaling channel for room:', roomCode, 'peer:', peerId);
    const channel = supabase.channel(`room:${roomCode}`);

    channel.on('broadcast', { event: 'signaling' }, ({ payload }) => {
      const message = payload as SignalingMessage;
      console.log('Received signaling message:', message.type, 'from:', message.from, 'to:', message.to);
      
      // Ignore messages from self or not meant for us
      if (message.from === peerId) {
        console.log('Ignoring message from self');
        return;
      }
      if (message.to && message.to !== peerId) {
        console.log('Ignoring message not meant for us');
        return;
      }

      switch (message.type) {
        case 'offer':
          console.log('Received offer from:', message.from);
          handleOffer(message.payload, message.from);
          break;
        case 'answer':
          console.log('Received answer from:', message.from);
          handleAnswer(message.payload, message.from);
          break;
        case 'ice-candidate':
          console.log('Received ICE candidate from:', message.from);
          // Store candidate if we don't have a connection yet
          const pc = peerConnectionsRef.current.get(message.from);
          if (pc?.remoteDescription) {
            handleIceCandidate(message.payload);
          } else {
            const pending = pendingCandidatesRef.current.get(message.from) || [];
            pending.push(message.payload);
            pendingCandidatesRef.current.set(message.from, pending);
          }
          break;
      }
    });

    channel.subscribe((status) => {
      console.log('Channel subscription status:', status);
    });
    channelRef.current = channel;

    return () => {
      cleanup();
    };
  }, [roomCode, peerId, handleOffer, handleAnswer, handleIceCandidate, cleanup]);

  return {
    connectionState,
    remoteStream,
    createOffer,
    handleOffer,
    handleAnswer,
    handleIceCandidate,
    setLocalStream,
    cleanup,
  };
}
