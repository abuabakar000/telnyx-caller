'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Phone, 
  PhoneOff, 
  Mic, 
  MicOff, 
  Delete, 
  Trash2, 
  ArrowUpRight, 
  ArrowDownLeft, 
  PhoneCall, 
  X, 
  Clock,
  Settings,
  Volume2,
  VolumeX,
  Play,
  Pause,
  Upload,
  RotateCcw,
  Voicemail,
  FileText,
  Building2,
  Send,
  MessageSquare,
  Loader2,
  Shield,
  ShieldCheck,
  ShieldAlert
} from 'lucide-react';
import { audioService } from '@/utils/audio';
import { sendSMS, getMessagesByPhone } from '@/app/actions/sms';
import { getTemplates } from '@/app/actions/templates';
import { pusherClient } from '@/utils/pusher-client';

interface CallLog {
  id: string;
  number: string;
  type: 'incoming' | 'outgoing' | 'missed';
  timestamp: number;
  duration?: number;
}

// Helper to modify SDP for higher Opus quality constraints
const modifySdp = (sdp: string): string => {
  if (!sdp || !sdp.includes('opus/48000')) return sdp;

  // Modify the Opus payload type format parameters dynamically
  return sdp.replace(/a=fmtp:(\d+)\s+([^\r\n]+)/g, (match, pt, params) => {
    if (sdp.includes(`rtpmap:${pt} opus/48000`)) {
      const paramMap = new Map<string, string>();
      params.split(';').forEach((p: string) => {
        const parts = p.trim().split('=');
        if (parts[0]) {
          paramMap.set(parts[0].trim(), parts[1] ? parts[1].trim() : '');
        }
      });

      // Override with optimal WebRTC performance values
      paramMap.set('stereo', '0');                 // Force mono for call voice efficiency
      paramMap.set('useinbandfec', '1');          // Enable Forward Error Correction for packet loss protection
      paramMap.set('maxaveragebitrate', '40000'); // Elevate average voice bitrate to 40kbps
      paramMap.set('maxplaybackrate', '48000');   // Target 48kHz audio capture/playback
      paramMap.set('usedtx', '1');                // Enable silence suppression (Discontinuous Transmission)

      const newParams = Array.from(paramMap.entries())
        .map(([k, v]) => v ? `${k}=${v}` : k)
        .join('; ');

      return `a=fmtp:${pt} ${newParams}`;
    }
    return match;
  });
};

// Shared active mixed stream reference for getUserMedia hook
let activeMixedStream: MediaStream | null = null;

// Global WebRTC monkey patch for SDP capture
if (typeof window !== 'undefined') {
  try {
    // Monkey patch getUserMedia to redirect SDK media capture requests to our mixed stream
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async function (constraints) {
        if (constraints && typeof constraints.audio === 'object' && constraints.audio !== null && (constraints.audio as any)._isMixerSource) {
          const cleanConstraints = { ...constraints };
          cleanConstraints.audio = { ...((constraints as any).audio) };
          delete (cleanConstraints.audio as any)._isMixerSource;
          return originalGetUserMedia(cleanConstraints);
        }
        if (constraints && (constraints as any)._isMixerSource) {
          const cleanConstraints = { ...constraints };
          delete (cleanConstraints as any)._isMixerSource;
          return originalGetUserMedia(cleanConstraints);
        }
        if (activeMixedStream) {
          console.log('[getUserMedia Hook] Redirecting media capture to active mixed stream:', activeMixedStream.id, 'Tracks:', activeMixedStream.getAudioTracks().map(t => ({ id: t.id, label: t.label, enabled: t.enabled, readyState: t.readyState })));
          return activeMixedStream;
        }
        return originalGetUserMedia(constraints);
      };
      console.log('[getUserMedia Hook] navigator.mediaDevices.getUserMedia monkey patch installed.');
    }

    const pcProto = RTCPeerConnection.prototype as any;

    const originalCreateOffer = pcProto.createOffer;
    pcProto.createOffer = function () {
      const successCb = arguments[0];
      const failureCb = arguments[1];
      const options = arguments[2];

      // Support legacy callback-based createOffer
      if (typeof successCb === 'function') {
        const wrappedSuccessCb = function (offer: any) {
          if (offer && offer.sdp) {
            offer.sdp = modifySdp(offer.sdp);
          }
          successCb(offer);
        };
        return originalCreateOffer.call(this, wrappedSuccessCb, failureCb, options);
      }

      // Support modern Promise-based createOffer
      const promise = originalCreateOffer.apply(this, arguments as any);
      return promise.then((offer: any) => {
        if (offer && offer.sdp) {
          offer.sdp = modifySdp(offer.sdp);
        }
        return offer;
      });
    };

    const originalCreateAnswer = pcProto.createAnswer;
    pcProto.createAnswer = function () {
      const successCb = arguments[0];
      const failureCb = arguments[1];
      const options = arguments[2];

      // Support legacy callback-based createAnswer
      if (typeof successCb === 'function') {
        const wrappedSuccessCb = function (answer: any) {
          if (answer && answer.sdp) {
            answer.sdp = modifySdp(answer.sdp);
          }
          successCb(answer);
        };
        return originalCreateAnswer.call(this, wrappedSuccessCb, failureCb, options);
      }

      // Support modern Promise-based createAnswer
      const promise = originalCreateAnswer.apply(this, arguments as any);
      return promise.then((answer: any) => {
        if (answer && answer.sdp) {
          answer.sdp = modifySdp(answer.sdp);
        }
        return answer;
      });
    };

    const originalSetLocalDescription = pcProto.setLocalDescription;
    pcProto.setLocalDescription = function (desc?: any) {
      if (desc && desc.sdp) {
        desc.sdp = modifySdp(desc.sdp);
      }
      return originalSetLocalDescription.apply(this, arguments as any);
    };
    
    console.log('[WebRTC Quality Hook] RTCPeerConnection SDP munger installed successfully.');
  } catch (e) {
    console.warn('[WebRTC Quality Hook] Failed to monkey patch PeerConnection methods:', e);
  }
}

// Volume Spinner Component for real-time visual feedback
const VolumeSpinner = ({ volume, icon: Icon, active, color = 'stroke-emerald-500' }: { 
  volume: number; 
  icon: any; 
  active: boolean;
  color?: string;
}) => {
  const radius = 18;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = active 
    ? circumference - (volume / 100) * circumference 
    : circumference;

  return (
    <div className="relative w-12 h-12 flex items-center justify-center bg-zinc-950 border border-zinc-900 rounded-full shadow-inner">
      <svg className="absolute w-full h-full -rotate-90">
        <circle
          cx="24"
          cy="24"
          r={radius}
          stroke="#18181b"
          strokeWidth="3"
          fill="transparent"
        />
        {active && (
          <circle
            cx="24"
            cy="24"
            r={radius}
            strokeWidth="3"
            fill="transparent"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            className={`transition-all duration-75 ease-out ${color}`}
          />
        )}
      </svg>
      <Icon className={`w-4 h-4 z-10 transition-colors duration-200 ${active ? 'text-zinc-200' : 'text-zinc-600'}`} />
    </div>
  );
};

const getAudioConstraints = (micId?: string, aec = true, ans = true, agc = true) => {
  return {
    echoCancellation: aec,
    noiseSuppression: ans,
    autoGainControl: agc,
    sampleRate: 48000,
    sampleSize: 16,
    channelCount: 1, // Mono is optimal for VoIP voice
    latency: 0.01,   // Request low latency (10ms)
    deviceId: micId ? { exact: micId } : undefined,
  };
};

// Active lead info passed in from parent power dialer
export interface ActiveLead {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  company?: string | null;
}

export default function Dialer({
  activeLead,
  onCallEnded,
  onScriptToggle,
  scriptOpen,
}: {
  activeLead?: ActiveLead | null;
  onCallEnded?: (duration: number) => void;
  onScriptToggle?: () => void;
  scriptOpen?: boolean;
}) {
  // WebRTC & Connection State
  const [client, setClient] = useState<any>(null);
  const [currentCall, setCurrentCall] = useState<any>(null);
  const [sipState, setSipState] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
  const [callState, setCallState] = useState<'idle' | 'dialing' | 'ringing' | 'active' | 'done'>('idle');
  const [isMuted, setIsMuted] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [telnyxNumber, setTelnyxNumber] = useState<string>('');
  const [telnyxSmsNumber, setTelnyxSmsNumber] = useState<string>('');

  // Audio Device Selection
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);
  const [speakers, setSpeakers] = useState<MediaDeviceInfo[]>([]);
  const [selectedMic, setSelectedMic] = useState<string>('');
  const [selectedSpeaker, setSelectedSpeaker] = useState<string>('');
  const [showSettings, setShowSettings] = useState(false);
  const [devicePermissionGranted, setDevicePermissionGranted] = useState(false);

  // Voice processing preferences
  const [enableAEC, setEnableAEC] = useState(true);
  const [enableANS, setEnableANS] = useState(true);
  const [enableAGC, setEnableAGC] = useState(true);

  // Real-time volume levels
  const [inputVolume, setInputVolume] = useState(0);
  const [outputVolume, setOutputVolume] = useState(0);

  // UI State
  const [phoneNumber, setPhoneNumber] = useState('');
  const [callHistory, setCallHistory] = useState<CallLog[]>([]);
  const [callDuration, setCallDuration] = useState(0);

  // Sound Pad State — 4 slots (0-2 regular, 3 = VM Drop)
  const [soundFiles, setSoundFiles] = useState<(File | null)[]>([null, null, null, null]);
  const [playingStates, setPlayingStates] = useState<boolean[]>([false, false, false, false]);
  const [soundPadVolume, setSoundPadVolume] = useState(0.5);
  const [isMicEnabled, setIsMicEnabled] = useState(true);
  const [settingsMicVolume, setSettingsMicVolume] = useState(0);
  const [vmDropping, setVmDropping] = useState(false);

  // Quick SMS State
  const [smsMessages, setSmsMessages] = useState<any[]>([]);
  const [smsInput, setSmsInput] = useState('');
  const [isSendingSms, setIsSendingSms] = useState(false);
  const [smsTemplates, setSmsTemplates] = useState<any[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const messageEndRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Account status and health
  const [balance, setBalance] = useState<string>('0.00');
  const [numberHealth, setNumberHealth] = useState<string>('unknown');
  const [fetchingStatus, setFetchingStatus] = useState<boolean>(false);

  // 4-Ring Rule / Free Dials Guard State
  const [autoDropEnabled, setAutoDropEnabled] = useState(true);
  const [autoDropMaxRings, setAutoDropMaxRings] = useState(4);
  const [ringingSeconds, setRingingSeconds] = useState(0);
  const [freeDialNotice, setFreeDialNotice] = useState<string | null>(null);

  const ringStartTimeRef = useRef<number | null>(null);
  const ringIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const autoDropEnabledRef = useRef(true);
  const autoDropMaxRingsRef = useRef(4);

  useEffect(() => {
    autoDropEnabledRef.current = autoDropEnabled;
  }, [autoDropEnabled]);

  useEffect(() => {
    autoDropMaxRingsRef.current = autoDropMaxRings;
  }, [autoDropMaxRings]);

  // Refs to avoid stale closures in event listeners & timeouts
  const phoneNumberRef = useRef('');
  const currentCallRef = useRef<any>(null);

  useEffect(() => {
    phoneNumberRef.current = phoneNumber;
  }, [phoneNumber]);

  useEffect(() => {
    currentCallRef.current = currentCall;
  }, [currentCall]);

  // Refs
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const durationIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const callStartTimeRef = useRef<number | null>(null);
  const inputVolumeAnalyserRef = useRef<any>(null);
  const outputVolumeAnalyserRef = useRef<any>(null);
  const clientRef = useRef<any>(null);
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const settingsMicStreamRef = useRef<MediaStream | null>(null);
  const settingsMicAnalyserRef = useRef<any>(null);

  // Web Audio Mixer Refs
  const mixerContextRef = useRef<AudioContext | null>(null);
  const mixerDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const soundBuffersRef = useRef<(AudioBuffer | null)[]>([null, null, null, null]);
  const activeSourcesRef = useRef<(AudioBufferSourceNode | null)[]>([null, null, null, null]);
  const slotGainsRef = useRef<any[]>([null, null, null, null]);
  const micGainNodeRef = useRef<GainNode | null>(null);
  const handleHangupRef = useRef<() => void>(() => {});

  // Ring timer helpers for 4-Ring Rule / Free Dials Guard
  const stopRingTimer = useCallback(() => {
    if (ringIntervalRef.current) {
      clearInterval(ringIntervalRef.current);
      ringIntervalRef.current = null;
    }
    ringStartTimeRef.current = null;
    setRingingSeconds(0);
  }, []);

  const startRingTimer = useCallback(() => {
    if (ringIntervalRef.current) clearInterval(ringIntervalRef.current);
    ringStartTimeRef.current = Date.now();
    setRingingSeconds(0);

    ringIntervalRef.current = setInterval(() => {
      if (!ringStartTimeRef.current) return;
      const elapsed = (Date.now() - ringStartTimeRef.current) / 1000;
      setRingingSeconds(elapsed);

      // Auto-hangup when reaching the ring limit (each ring is ~4.5s)
      const maxSeconds = autoDropMaxRingsRef.current * 4.5;
      if (autoDropEnabledRef.current && elapsed >= maxSeconds) {
        console.log(`[4-Ring Auto-Guard] Reached ${autoDropMaxRingsRef.current} rings (${elapsed.toFixed(1)}s). Auto-hanging up before voicemail connects ($0.00 Free Dial)...`);
        if (ringIntervalRef.current) {
          clearInterval(ringIntervalRef.current);
          ringIntervalRef.current = null;
        }
        ringStartTimeRef.current = null;
        setFreeDialNotice(`🛡️ 4-Ring Rule: Auto-dropped at ${autoDropMaxRingsRef.current} rings ($0.00 Free Dial)`);
        if (handleHangupRef.current) {
          handleHangupRef.current();
        }
      }
    }, 100);
  }, []);

  // Helper to format phone number progressively for display
  const formatPhoneNumber = (num: string): string => {
    if (/[a-zA-Z]/.test(num)) {
      return num;
    }
    const cleaned = num.replace(/[^0-9*#+]/g, '');
    
    // Format US/Canada and international numbers (+1 or 1)
    if (cleaned.startsWith('+1')) {
      const rest = cleaned.slice(2);
      if (rest.length === 0) return '+1';
      if (rest.length <= 3) return `+1 (${rest}`;
      if (rest.length <= 6) return `+1 (${rest.slice(0, 3)}) ${rest.slice(3)}`;
      return `+1 (${rest.slice(0, 3)}) ${rest.slice(3, 6)}-${rest.slice(6, 10)}`;
    } else if (cleaned.startsWith('1')) {
      const rest = cleaned.slice(1);
      if (rest.length === 0) return '+1';
      if (rest.length <= 3) return `+1 (${rest}`;
      if (rest.length <= 6) return `+1 (${rest.slice(0, 3)}) ${rest.slice(3)}`;
      return `+1 (${rest.slice(0, 3)}) ${rest.slice(3, 6)}-${rest.slice(6, 10)}`;
    } else if (cleaned.length > 0 && !cleaned.startsWith('+') && !cleaned.startsWith('*') && !cleaned.startsWith('#')) {
      if (cleaned.length <= 3) return cleaned;
      if (cleaned.length <= 6) return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3)}`;
      return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6, 10)}`;
    }
    
    return cleaned;
  };

  // Handle number input from user typing / copy-pasting (automatically strips spaces and hyphens)
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (callState !== 'idle') return;
    const val = e.target.value;
    // Strip everything except digits, +, *, and #
    const cleaned = val.replace(/[^0-9*#+]/g, '');
    setPhoneNumber(cleaned);
  };

  // Dedicated paste handler to strip spaces and other formatting instantly
  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    if (callState !== 'idle') return;
    e.preventDefault();
    const pastedText = e.clipboardData.getData('text');
    const cleaned = pastedText.replace(/[^0-9*#+]/g, '');
    setPhoneNumber(cleaned);
  };

  // Helper to start real-time Audio Level analysis (returns controller)
  const startVolumeAnalysis = (stream: MediaStream, onVolumeChange: (vol: number) => void) => {
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return null;
      
      const ctx = new AudioContextClass();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 32;
      
      source.connect(analyser);
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      let active = true;
      
      const checkVolume = () => {
        if (!active) return;
        analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const avg = sum / dataArray.length;
        const pct = Math.min(100, Math.round((avg / 128) * 100));
        onVolumeChange(pct);
        requestAnimationFrame(checkVolume);
      };
      
      checkVolume();
      return {
        stop: () => {
          active = false;
          try {
            source.disconnect();
            analyser.disconnect();
            ctx.close();
          } catch (e) {}
        }
      };
    } catch (err) {
      console.warn('[Volume Analysis] Failed to start:', err);
      return null;
    }
  };

  // Initialize Web Audio graph for mixing sound pad files
  const ensureMixerContext = () => {
    if (typeof window === 'undefined') return;
    try {
      let ctx = mixerContextRef.current;
      let dest = mixerDestinationRef.current;

      if (!ctx) {
        console.log('[Mixer] Initializing global Web Audio mixer context with interactive latency.');
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioContextClass) return;
        ctx = new AudioContextClass({
          latencyHint: 'interactive'
        });
        mixerContextRef.current = ctx;

        dest = ctx.createMediaStreamDestination();
        mixerDestinationRef.current = dest;
      }

      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      // Sync AudioContext speaker routing if supported
      if (typeof (ctx as any).setSinkId === 'function' && selectedSpeaker) {
        (ctx as any).setSinkId(selectedSpeaker).catch((e: any) => {
          console.warn('[Mixer Speaker] Failed to set sink ID on AudioContext:', e);
        });
      }

      // Ensure slot gain nodes are set up and connected to output destinations
      if (dest) {
        for (let i = 0; i < 4; i++) {
          if (!slotGainsRef.current[i]) {
            const gainNode = ctx.createGain();
            gainNode.gain.value = soundPadVolume;
            slotGainsRef.current[i] = gainNode;
            gainNode.connect(dest);
            gainNode.connect(ctx.destination);
          }
        }
      }
    } catch (e) {
      console.error('[Mixer] Context initialization failed:', e);
    }
  };

  // Creates mixed local stream containing microphone and sound pad
  const getMixedStream = async () => {
    try {
      ensureMixerContext();
      
      const ctx = mixerContextRef.current;
      if (!ctx) return null;

      // Re-create the MediaStreamAudioDestinationNode to ensure a fresh, active audio track for this call.
      // This prevents the "ended track" issue when the SDK stops the track of the previous call's stream.
      const dest = ctx.createMediaStreamDestination();
      mixerDestinationRef.current = dest;

      // Ensure slot gain nodes are set up and connected to the new destination
      for (let i = 0; i < 4; i++) {
        let gainNode = slotGainsRef.current[i];
        if (!gainNode) {
          gainNode = ctx.createGain();
          gainNode.gain.value = soundPadVolume;
          slotGainsRef.current[i] = gainNode;
        } else {
          try {
            gainNode.disconnect();
          } catch (e) {}
        }
        gainNode.connect(dest);
        gainNode.connect(ctx.destination);
      }

      console.log('[Mixer] Capturing user mic and merging stream channels...');
      
      // Capture mic stream
      const constraints = {
        audio: {
          ...getAudioConstraints(selectedMic, enableAEC, enableANS, enableAGC),
          _isMixerSource: true
        } as any,
        video: false
      };
      const micStream = await navigator.mediaDevices.getUserMedia(constraints);
      micStreamRef.current = micStream;

      if (micSourceRef.current) {
        try { micSourceRef.current.disconnect(); } catch (e) {}
      }

      // Add mic source node to Web Audio destination node
      const micSource = ctx.createMediaStreamSource(micStream);
      micSourceRef.current = micSource;

      // Web Audio processing nodes pipeline (HPF -> Presence Peaking -> Compressor)
      const hpf = ctx.createBiquadFilter();
      hpf.type = 'highpass';
      hpf.frequency.setValueAtTime(80, ctx.currentTime);

      const presence = ctx.createBiquadFilter();
      presence.type = 'peaking';
      presence.frequency.setValueAtTime(3000, ctx.currentTime);
      presence.gain.setValueAtTime(3, ctx.currentTime);
      presence.Q.setValueAtTime(1, ctx.currentTime);

      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.setValueAtTime(-24, ctx.currentTime);
      compressor.knee.setValueAtTime(30, ctx.currentTime);
      compressor.ratio.setValueAtTime(12, ctx.currentTime);
      compressor.attack.setValueAtTime(0.003, ctx.currentTime);
      compressor.release.setValueAtTime(0.25, ctx.currentTime);
      
      const micGain = ctx.createGain();
      micGain.gain.value = isMicEnabled ? 1.0 : 0.0;
      micGainNodeRef.current = micGain;

      // Connect nodes: Mic -> HPF -> Presence -> Compressor -> Mic Gain -> Destination
      micSource.connect(hpf);
      hpf.connect(presence);
      presence.connect(compressor);
      compressor.connect(micGain);
      micGain.connect(dest);

      activeMixedStream = dest.stream;
      return dest.stream;
    } catch (err) {
      console.error('[Mixer] Failed to construct mixed audio stream:', err);
      return null;
    }
  };

  // Cleanup mic capture and resources
  const stopMicCapture = () => {
    activeMixedStream = null;
    if (micGainNodeRef.current) {
      try {
        micGainNodeRef.current.disconnect();
      } catch (e) {}
      micGainNodeRef.current = null;
    }
    if (micSourceRef.current) {
      try {
        micSourceRef.current.disconnect();
        micSourceRef.current = null;
      } catch (e) {}
    }
    if (micStreamRef.current) {
      try {
        micStreamRef.current.getTracks().forEach(track => track.stop());
        micStreamRef.current = null;
      } catch (e) {}
    }
  };

  // Request media devices list
  const loadAudioDevices = async (requestPermissions = false) => {
    try {
      if (typeof window === 'undefined') return;
      
      if (requestPermissions) {
        await navigator.mediaDevices.getUserMedia({ audio: { _isMixerSource: true } as any });
        setDevicePermissionGranted(true);
      }

      const devices = await navigator.mediaDevices.enumerateDevices();
      const mics = devices.filter(d => d.kind === 'audioinput');
      const spks = devices.filter(d => d.kind === 'audiooutput');

      setMicrophones(mics);
      setSpeakers(spks);

      // Select default microphone
      const savedMic = localStorage.getItem('telnyx_selected_mic');
      if (savedMic && mics.some(m => m.deviceId === savedMic)) {
        setSelectedMic(savedMic);
      } else if (mics.length > 0) {
        setSelectedMic(mics[0].deviceId);
      }

      // Select default speaker
      const savedSpk = localStorage.getItem('telnyx_selected_speaker');
      if (savedSpk && spks.some(s => s.deviceId === savedSpk)) {
        setSelectedSpeaker(savedSpk);
      } else if (spks.length > 0) {
        setSelectedSpeaker(spks[0].deviceId);
      }
    } catch (err) {
      console.warn('[Devices] Failed to list devices:', err);
    }
  };

  // Fetch credentials & initialize TelnyxRTC (Client side only)
  useEffect(() => {
    let active = true;
    const reconnectAttemptsRef = { current: 0 };
    const reconnectTimeoutRef = { current: null as any };
    const isReconnectingRef = { current: false };

    // Retrieve public caller ID number
    const outboundNumber = process.env.NEXT_PUBLIC_TELNYX_NUMBER || '';
    setTelnyxNumber(outboundNumber);

    // Populate devices list immediately
    loadAudioDevices(false);

    const scheduleReconnect = () => {
      if (!active) return;
      if (isReconnectingRef.current) return;
      isReconnectingRef.current = true;
      setSipState('connecting');

      const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
      console.log(`[Dialer] WebRTC socket closed/failed. Scheduling reconnect attempt #${reconnectAttemptsRef.current + 1} in ${delay}ms...`);
      
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = setTimeout(async () => {
        reconnectAttemptsRef.current += 1;
        isReconnectingRef.current = false;
        await establishConnection();
      }, delay);
    };

    const establishConnection = async () => {
      if (!active) return;
      
      try {
        setSipState('connecting');
        
        // Clean up previous client if it exists
        if (clientRef.current) {
          console.log('[Dialer] Cleaning up previous client before reconnecting...');
          const oldClient = clientRef.current;
          clientRef.current = null;
          setClient(null);
          if (pingIntervalRef.current) {
            clearInterval(pingIntervalRef.current);
            pingIntervalRef.current = null;
          }
          try {
            oldClient.disconnect();
          } catch (e) {}
        }

        const response = await fetch('/api/telnyx/token');
        if (!active) return;

        if (!response.ok) {
          throw new Error(`Failed to fetch credentials: ${response.statusText}`);
        }
        const data = await response.json();
        if (!active) return;

        const { TelnyxRTC } = await import('@telnyx/webrtc');
        if (!active) return;

        const clientOptions: any = {};
        if (data.token) {
          clientOptions.login_token = data.token;
        } else if (data.login && data.password) {
          clientOptions.login = data.login;
          clientOptions.password = data.password;
        } else {
          throw new Error('No valid authentication credentials returned from server.');
        }

        // Configure SDK-level keep-alive and reconnection capabilities
        clientOptions.autoReconnect = true;
        clientOptions.keepConnectionAliveOnSocketClose = true;
        clientOptions.maxReconnectAttempts = 20;

        console.log('[Dialer] Initializing TelnyxRTC with parameters:', {
          autoReconnect: clientOptions.autoReconnect,
          keepConnectionAliveOnSocketClose: clientOptions.keepConnectionAliveOnSocketClose
        });
        const rtcClient = new TelnyxRTC(clientOptions);
        clientRef.current = rtcClient;
        setClient(rtcClient);

        rtcClient.on('telnyx.ready', () => {
          if (!active) return;
          console.log('[Dialer] WebRTC signaling ready.');
          setSipState('connected');
          setErrorMessage(null);
          reconnectAttemptsRef.current = 0;

          // Start signaling health monitor if available in SDK
          if (typeof rtcClient.startSignalingHealthMonitor === 'function') {
            try {
              rtcClient.startSignalingHealthMonitor();
              console.log('[Dialer] SDK Signaling Health Monitor started.');
            } catch (e) {
              console.warn('[Dialer] Failed to start SDK Signaling Health Monitor:', e);
            }
          }

        });

        rtcClient.on('telnyx.socket.close', () => {
          if (!active) return;
          console.warn('[Dialer] WebRTC socket closed.');
          setSipState('connecting');
          scheduleReconnect();
        });

        rtcClient.on('telnyx.socket.error', (err: any) => {
          if (!active) return;
          console.error('[Dialer] WebRTC socket error:', err);
          setSipState('connecting');
          scheduleReconnect();
        });

        rtcClient.on('telnyx.error', (error: any) => {
          if (!active) return;
          console.error('[Dialer] Telnyx SDK error:', error);
          
          const msg = (error?.message || '').toLowerCase();
          const isNonFatal = 
            msg.includes('normal clearing') || 
            msg.includes('user hung up') || 
            msg.includes('call rejected') ||
            msg.includes('cancelled') ||
            msg.includes('dialog_error') ||
            msg.includes('invalidstateerror') ||
            msg.includes('peer connection') ||
            msg.includes('webrtc') ||
            msg.includes('ice') ||
            msg.includes('media') ||
            msg.includes('track') ||
            msg.includes('stream') ||
            msg.includes('close') ||
            msg.includes('bye');

          if (isNonFatal) {
            console.log('[Dialer] Ignored non-fatal SDK error event:', error);
            return;
          }

          setErrorMessage(error.message || 'Authentication or connection error.');
        });

        rtcClient.on('telnyx.notification', (notification: any) => {
          if (!active) return;
          console.log('[Dialer] Notification:', notification.type);
          
          if (notification.type === 'callUpdate') {
            const call = notification.call;
            setCurrentCall(call);

            const isOutbound = call.direction === 'outbound';

            // Helper to attach remote audio stream whenever available (early media, ringing, or active)
            const attachRemoteStream = () => {
              if (audioRef.current && call.remoteStream) {
                if (audioRef.current.srcObject !== call.remoteStream) {
                  audioRef.current.srcObject = call.remoteStream;
                  
                  const savedSpk = localStorage.getItem('telnyx_selected_speaker');
                  if (savedSpk && typeof (audioRef.current as any).setSinkId === 'function') {
                    (audioRef.current as any).setSinkId(savedSpk).catch((e: any) => {
                      console.warn('[Speaker] Failed to set sink ID:', e);
                    });
                  }
                  
                  audioRef.current.play().catch(err => {
                    console.warn('[Audio] Remote play failed:', err);
                  });
                }
              }
            };

            switch (call.state) {
              case 'trying':
              case 'requesting':
                setCallState('dialing');
                if (isOutbound) {
                  audioService.startRingback();
                  if (!ringStartTimeRef.current) startRingTimer();
                }
                break;

              case 'early':
                // Carrier early media (SIP 183 - carrier ringback, busy tones, operator messages)
                setCallState(isOutbound ? 'dialing' : 'ringing');
                attachRemoteStream();
                if (isOutbound && !ringStartTimeRef.current) startRingTimer();
                if (call.remoteStream && call.remoteStream.getAudioTracks().length > 0) {
                  audioService.stopRingback();
                }
                break;

              case 'ringing':
                setCallState('ringing');
                if (isOutbound) {
                  attachRemoteStream();
                  if (!ringStartTimeRef.current) startRingTimer();
                } else {
                  audioService.startRingtone();
                  const incomingNumber = notification.displayNumber || 
                                         call.options?.remoteCallerNumber || 
                                         call.options?.callerIdNumber ||
                                         call.options?.callerNumber ||
                                         call.callerNumber || 
                                         notification.displayName ||
                                         'Incoming Call';
                  setPhoneNumber(incomingNumber);
                }
                break;

              case 'active':
                setCallState('active');
                stopRingTimer();
                audioService.stopRingback();
                audioService.stopRingtone();
                audioService.playCallSuccess();
                setIsMuted(false);
                
                // Start call timer
                callStartTimeRef.current = Date.now();
                setCallDuration(0);
                if (durationIntervalRef.current) clearInterval(durationIntervalRef.current);
                durationIntervalRef.current = setInterval(() => {
                  if (callStartTimeRef.current) {
                    setCallDuration(Math.floor((Date.now() - callStartTimeRef.current) / 1000));
                  }
                }, 1000);

                // Apply selected speaker & stream
                attachRemoteStream();

                // Start Volume Spinners analysis
                if (call.localStream) {
                  inputVolumeAnalyserRef.current = startVolumeAnalysis(call.localStream, setInputVolume);
                }
                if (call.remoteStream) {
                  outputVolumeAnalyserRef.current = startVolumeAnalysis(call.remoteStream, setOutputVolume);
                }
                break;

              case 'done':
                setCallState('done');
                console.log('[Dialer] Call ended. Cause:', call.cause, 'Cause Code:', call.causeCode, 'Direction:', call.direction);
                stopRingTimer();
                audioService.stopRingback();
                audioService.stopRingtone();
                audioService.playCallEnd();
                stopMicCapture();
                
                // Stop Volume spinners
                if (inputVolumeAnalyserRef.current) {
                  inputVolumeAnalyserRef.current.stop();
                  inputVolumeAnalyserRef.current = null;
                }
                if (outputVolumeAnalyserRef.current) {
                  outputVolumeAnalyserRef.current.stop();
                  outputVolumeAnalyserRef.current = null;
                }
                setInputVolume(0);
                setOutputVolume(0);

                // Clean up timer
                if (durationIntervalRef.current) {
                  clearInterval(durationIntervalRef.current);
                  durationIntervalRef.current = null;
                }

                // Add to history log
                const duration = callStartTimeRef.current 
                  ? Math.floor((Date.now() - callStartTimeRef.current) / 1000)
                  : undefined;
                  
                const isIncoming = call.direction === 'inbound';
                const logType = isIncoming 
                  ? (duration && duration > 0 ? 'incoming' : 'missed') 
                  : 'outgoing';

                const newLog: CallLog = {
                  id: Math.random().toString(36).substr(2, 9),
                  number: call.destinationNumber || call.callerNumber || phoneNumberRef.current,
                  type: logType,
                  timestamp: Date.now(),
                  duration,
                };

                setCallHistory(prev => {
                  const updated = [newLog, ...prev];
                  console.log('[Dialer Log] Saving call history item. New list length:', updated.length);
                  localStorage.setItem('call_dialer_history', JSON.stringify(updated));
                  return updated;
                });

                // Notify parent power dialer of call end
                if (onCallEnded) {
                  onCallEnded(duration || 0);
                }

                // Clear call states
                setTimeout(() => {
                  setCallState('idle');
                  setCurrentCall(null);
                  setCallDuration(0);
                  callStartTimeRef.current = null;
                }, 1000);
                break;
            }
          }
        });

        rtcClient.connect();

      } catch (err: any) {
        if (!active) return;
        console.error('[Dialer] Init error:', err);
        setSipState('error');
        setErrorMessage(err.message || 'Failed to initialize dialer.');
        scheduleReconnect();
      }
    };

    establishConnection();

    return () => {
      active = false;
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (durationIntervalRef.current) clearInterval(durationIntervalRef.current);
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }
      audioService.stopRingback();
      stopRingTimer();
      stopMicCapture();
      if (inputVolumeAnalyserRef.current) inputVolumeAnalyserRef.current.stop();
      if (outputVolumeAnalyserRef.current) outputVolumeAnalyserRef.current.stop();

      if (clientRef.current) {
        try {
          console.log('[Dialer] Disconnecting clientRef on unmount...');
          clientRef.current.disconnect();
          clientRef.current = null;
        } catch (e) {
          console.warn('[Dialer] Failed to disconnect clientRef on unmount:', e);
        }
      }
    };
  }, []);

  // Load history from localStorage on client-side mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedHistory = localStorage.getItem('call_dialer_history');
      console.log('[Dialer Log] Loading history from localStorage:', savedHistory);
      if (savedHistory) {
        try {
          const parsed = JSON.parse(savedHistory);
          if (Array.isArray(parsed)) {
            setCallHistory(parsed);
            console.log('[Dialer Log] History logs loaded successfully. Count:', parsed.length);
          }
        } catch (e) {
          console.error('Error loading history:', e);
        }
      }

      // Load audio quality settings
      setEnableAEC(localStorage.getItem('telnyx_aec') !== 'false');
      setEnableANS(localStorage.getItem('telnyx_ans') !== 'false');
      setEnableAGC(localStorage.getItem('telnyx_agc') !== 'false');

      // Load 4-Ring Rule Free Dial Guard settings
      const savedAutoDrop = localStorage.getItem('telnyx_auto_4_ring');
      if (savedAutoDrop !== null) {
        setAutoDropEnabled(savedAutoDrop !== 'false');
      }
      const savedLimit = localStorage.getItem('telnyx_ring_limit');
      if (savedLimit) {
        const parsedLimit = parseInt(savedLimit, 10);
        if ([3, 4, 5].includes(parsedLimit)) {
          setAutoDropMaxRings(parsedLimit);
        }
      }
    }
  }, []);

  // load SMS history helper
  const loadSmsHistory = useCallback(async (phoneToLoad: string) => {
    if (!phoneToLoad) return;
    const cleaned = phoneToLoad.replace(/[^0-9+]/g, '');
    if (cleaned.length < 10) return;
    try {
      const res = await getMessagesByPhone(cleaned);
      if (res.success && res.messages) {
        setSmsMessages(res.messages);
      }
    } catch (err) {
      console.warn('[Dialer SMS] Failed to load messages:', err);
    }
  }, []);

  // Load templates on mount
  useEffect(() => {
    getTemplates().then((res: any) => {
      if (res.success && res.templates) {
        setSmsTemplates(res.templates);
      }
    });
  }, []);

  // Fetch SMS history when activeLead or typed phone number changes
  useEffect(() => {
    const activeNum = activeLead?.phone || phoneNumber;
    if (activeNum && activeNum.replace(/[^0-9+]/g, '').length >= 10) {
      loadSmsHistory(activeNum);
    } else {
      setSmsMessages([]);
    }
  }, [activeLead, phoneNumber, loadSmsHistory]);

  // Sync real-time messages via Pusher
  useEffect(() => {
    if (!pusherClient) return;
    const channel = pusherClient.subscribe('sms-channel');

    const handleNewMessage = (data: any) => {
      const activeNum = activeLead?.phone || phoneNumber;
      if (!activeNum) return;
      const cleanedActive = activeNum.replace(/[^0-9+]/g, '');
      const cleanedMsgRecipient = (data.recipient || '').replace(/[^0-9+]/g, '');
      const cleanedMsgSender = (data.sender || '').replace(/[^0-9+]/g, '');

      if (cleanedMsgRecipient.includes(cleanedActive) || cleanedMsgSender.includes(cleanedActive)) {
        setSmsMessages(prev => {
          if (prev.some(m => m.id === data.id || (m.telnyxMessageId && m.telnyxMessageId === data.telnyxMessageId))) {
            return prev;
          }
          return [...prev, data];
        });
      }
    };

    const handleStatusUpdate = (data: any) => {
      const activeNum = activeLead?.phone || phoneNumber;
      if (!activeNum) return;
      const cleanedActive = activeNum.replace(/[^0-9+]/g, '');
      const cleanedMsgRecipient = (data.recipient || '').replace(/[^0-9+]/g, '');
      const cleanedMsgSender = (data.sender || '').replace(/[^0-9+]/g, '');

      if (cleanedMsgRecipient.includes(cleanedActive) || cleanedMsgSender.includes(cleanedActive)) {
        setSmsMessages(prev => prev.map(m => m.id === data.id ? { ...m, ...data } : m));
      }
    };

    channel.bind('new-message', handleNewMessage);
    channel.bind('message-status-update', handleStatusUpdate);

    return () => {
      channel.unbind('new-message', handleNewMessage);
      channel.unbind('message-status-update', handleStatusUpdate);
    };
  }, [activeLead, phoneNumber]);

  // Scroll to bottom of message thread
  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [smsMessages]);

  // Auto-resize SMS input textarea as user types
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
    }
  }, [smsInput]);

  const handleTemplateChange = (templateId: string) => {
    setSelectedTemplateId(templateId);
    if (!templateId) return;

    const template = smsTemplates.find(t => t.id === templateId);
    if (template) {
      let content = template.content;
      if (activeLead) {
        content = content
          .replace(/\{firstName\}/g, activeLead.firstName || '')
          .replace(/\{companyName\}/g, activeLead.company || '');
      }
      setSmsInput(content);
    }
  };

  const handleSendSms = async (e: React.FormEvent) => {
    e.preventDefault();
    const activeNum = activeLead?.phone || phoneNumber;
    if (!activeNum || !smsInput.trim()) return;

    const cleaned = activeNum.replace(/[^0-9+]/g, '');
    if (cleaned.length < 10) return;

    setIsSendingSms(true);
    const res = await sendSMS(cleaned, smsInput.trim());
    setIsSendingSms(false);

    if (res.success) {
      setSmsInput('');
      setSelectedTemplateId('');
      loadSmsHistory(cleaned);
    } else {
      alert(res.error || 'Failed to send SMS');
    }
  };


  // Load status and balance from backend API route
  useEffect(() => {
    let active = true;
    const fetchStatus = async () => {
      try {
        setFetchingStatus(true);
        const response = await fetch('/api/telnyx/status');
        if (!response.ok) {
          throw new Error('Failed to fetch status');
        }
        const data = await response.json();
        if (active) {
          setBalance(data.balance || '0.00');
          setNumberHealth(data.numberHealth || 'unknown');
          if (data.number) {
            setTelnyxNumber(data.number);
          }
          if (data.smsNumber) {
            setTelnyxSmsNumber(data.smsNumber);
          }
        }
      } catch (err) {
        console.error('[Dialer] Error fetching status:', err);
      } finally {
        if (active) {
          setFetchingStatus(false);
        }
      }
    };

    fetchStatus();

    // Refresh status and balance every 30 seconds
    const intervalId = setInterval(fetchStatus, 30000);

    return () => {
      active = false;
      clearInterval(intervalId);
    };
  }, []);

  // Update browser tab title dynamically based on call state
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    
    const originalTitle = 'Office Dialer';
    
    if (callState === 'idle') {
      document.title = originalTitle;
    } else if (callState === 'dialing') {
      document.title = `📞 Dialing... | ${originalTitle}`;
    } else if (callState === 'ringing') {
      document.title = `⚡ Incoming Call | ${originalTitle}`;
    } else if (callState === 'active') {
      document.title = `🟢 In Call [${formatDuration(callDuration)}] | ${originalTitle}`;
    } else if (callState === 'done') {
      document.title = `✖ Call Ended | ${originalTitle}`;
    }
  }, [callState, callDuration]);

  // Physical keyboard support for numeric typing and soundboard hotkeys (when settings is closed)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Global Escape Hotkey — drop call instantly at any time to guarantee $0.00 Free Dial
      if (e.key === 'Escape') {
        if (callState !== 'idle') {
          e.preventDefault();
          console.log('[Dialer] ESC key pressed — Instant Hangup requested (Free Dial Guard)');
          if (callState === 'dialing' || callState === 'ringing') {
            setFreeDialNotice('🛡️ Dropped via [ESC] before voicemail ($0.00 Free Dial)');
          }
          handleHangup();
          return;
        }
      }

      if (callState === 'ringing' || showSettings) return;
      
      // Global Enter Key — dial when Enter is pressed (unless typing in SMS textarea)
      if (e.key === 'Enter') {
        const activeEl = document.activeElement;
        const isTextarea = activeEl && activeEl.tagName === 'TEXTAREA';
        if (!isTextarea && callState === 'idle' && phoneNumber.trim()) {
          e.preventDefault();
          console.log('[Dialer] Enter key pressed — Placing call to:', phoneNumber);
          handleCall();
          return;
        }
      }

      const key = e.key.toLowerCase();
      const activeEl = document.activeElement;
      const isInputFocused = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA');

      if (!isInputFocused) {
        if (/[0-9]/.test(key) || key === '*' || key === '#') {
          e.preventDefault();
          handleKeyPress(key);
        } else if (e.key === 'Backspace') {
          e.preventDefault();
          handleBackspace();
        }

        // Sound Pad Hotkeys Q, W, E
        if (key === 'q') {
          e.preventDefault();
          togglePlaySound(0);
        } else if (key === 'w') {
          e.preventDefault();
          togglePlaySound(1);
        } else if (key === 'e') {
          e.preventDefault();
          togglePlaySound(2);
        } else if (key === 'v') {
          e.preventDefault();
          if (callState === 'active' && !vmDropping) {
            if (soundFiles[3]) {
              setVmDropping(true);
              togglePlaySound(3);
            } else {
              setErrorMessage('⚠️ No Voicemail Audio uploaded! Open Settings (⚙️) to upload your VM .mp3 message.');
            }
          }
        }
      }
    };

    const handleGlobalPaste = (e: ClipboardEvent) => {
      if (callState !== 'idle' || showSettings) return;
      
      const activeEl = document.activeElement;
      const isInputFocused = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA');
      
      if (!isInputFocused) {
        const pastedText = e.clipboardData?.getData('text') || '';
        const cleaned = pastedText.replace(/[^0-9*#+]/g, '');
        if (cleaned) {
          e.preventDefault();
          setPhoneNumber(cleaned);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('paste', handleGlobalPaste);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('paste', handleGlobalPaste);
    };
  }, [phoneNumber, callState, client, currentCall, showSettings, playingStates]);

  const handleKeyPress = (digit: string) => {
    audioService.playDTMF(digit);
    
    if (callState === 'active' && currentCall) {
      currentCall.dtmf(digit);
    } else {
      setPhoneNumber(prev => prev + digit);
    }
  };

  const handleBackspace = () => {
    if (callState === 'idle') {
      setPhoneNumber(prev => prev.slice(0, -1));
    }
  };

  const handleClear = () => {
    if (callState === 'idle') {
      setPhoneNumber('');
    }
  };

  const handleCall = async () => {
    if (!client || sipState !== 'connected') {
      setErrorMessage('Dialer is not connected to network.');
      return;
    }
    if (!phoneNumber) return;

    try {
      setErrorMessage(null);
      let cleanNumber = phoneNumber.replace(/[^0-9*#+]/g, '');
      if (!cleanNumber.startsWith('+') && !cleanNumber.includes('*') && !cleanNumber.includes('#')) {
        const onlyDigits = cleanNumber.replace(/[^0-9]/g, '');
        if (onlyDigits.length === 10) {
          cleanNumber = '+1' + onlyDigits;
        } else if (onlyDigits.length === 11 && onlyDigits.startsWith('1')) {
          cleanNumber = '+' + onlyDigits;
        } else if (onlyDigits.length > 0) {
          cleanNumber = '+' + onlyDigits;
        }
      }
      console.log(`[Dialer] Outgoing call to: ${cleanNumber}`);

      setCallState('dialing');
      audioService.startRingback();
      startRingTimer();

      // Mix local microphone and sound pad elements
      const mixedStream = await getMixedStream();

      const call = client.newCall({
        destinationNumber: cleanNumber,
        audio: mixedStream 
          ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false } 
          : getAudioConstraints(selectedMic, enableAEC, enableANS, enableAGC),
        localStream: mixedStream || undefined,
        callerNumber: telnyxNumber || undefined,
      });

      setCurrentCall(call);
    } catch (err: any) {
      console.error('[Dialer] Failed to place call:', err);
      stopRingTimer();
      setCallState('idle');
      audioService.stopRingback();
      setErrorMessage(err.message || 'Call failed.');
    }
  };

  const handleHangup = () => {
    console.log('[Dialer] Hangup requested. Call state:', callState, 'Current call:', !!currentCall);
    stopRingTimer();
    try {
      if (currentCall) {
        currentCall.hangup();
      }
    } catch (e) {
      console.warn('[Dialer] Error calling currentCall.hangup():', e);
    }
    
    // Set UI state to 'done' immediately for visual feedback
    setCallState('done');
    audioService.stopRingback();
    audioService.stopRingtone();
    audioService.playCallEnd();

    // Fallback: in case the SDK fails to send the 'done' event within 4 seconds,
    // force clean up to prevent the UI from locking up.
    setTimeout(() => {
      if (currentCallRef.current) {
        console.log('[Dialer] Done event not received in 4s, forcing cleanup...');
        stopMicCapture();
        if (inputVolumeAnalyserRef.current) {
          inputVolumeAnalyserRef.current.stop();
          inputVolumeAnalyserRef.current = null;
        }
        if (outputVolumeAnalyserRef.current) {
          outputVolumeAnalyserRef.current.stop();
          outputVolumeAnalyserRef.current = null;
        }
        setInputVolume(0);
        setOutputVolume(0);
        if (durationIntervalRef.current) {
          clearInterval(durationIntervalRef.current);
          durationIntervalRef.current = null;
        }
        
        // Log to history using fallback values
        const duration = callStartTimeRef.current 
          ? Math.floor((Date.now() - callStartTimeRef.current) / 1000)
          : undefined;

        const isIncoming = currentCallRef.current.direction === 'inbound';
        const logType = isIncoming 
          ? (duration && duration > 0 ? 'incoming' : 'missed') 
          : 'outgoing';

        const newLog: CallLog = {
          id: Math.random().toString(36).substr(2, 9),
          number: currentCallRef.current.destinationNumber || currentCallRef.current.callerNumber || phoneNumberRef.current || 'Unknown',
          type: logType,
          timestamp: Date.now(),
          duration,
        };

        setCallHistory(prev => {
          const updated = [newLog, ...prev];
          localStorage.setItem('call_dialer_history', JSON.stringify(updated));
          return updated;
        });

        // Notify parent
        if (onCallEnded) {
          onCallEnded(duration || 0);
        }

        setCallState('idle');
        setCurrentCall(null);
        setCallDuration(0);
        callStartTimeRef.current = null;
      }
    }, 4000);
  };

  handleHangupRef.current = handleHangup;

  const handleAnswer = async () => {
    if (currentCall && callState === 'ringing') {
      stopSettingsMicTest(); // Stop tester when answering a call
      const mixedStream = await getMixedStream();
      
      // Explicitly set the localStream and audio constraints on currentCall.options
      // since answer() ignores these arguments and retrieves them from the call options object.
      if (mixedStream) {
        currentCall.options.localStream = mixedStream;
        currentCall.options.audio = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
      } else {
        currentCall.options.audio = getAudioConstraints(selectedMic, enableAEC, enableANS, enableAGC);
      }

      currentCall.answer();
    }
  };

  const handleReject = () => {
    if (currentCall && callState === 'ringing') {
      currentCall.hangup();
      audioService.stopRingtone();
    }
  };

  // Toggle Settings view and microphone local loopback test
  const toggleSettings = async () => {
    const nextState = !showSettings;
    setShowSettings(nextState);
    if (nextState) {
      await loadAudioDevices(true);
      const savedMic = localStorage.getItem('telnyx_selected_mic') || '';
      startSettingsMicTest(savedMic);
    } else {
      stopSettingsMicTest();
    }
  };

  const startSettingsMicTest = async (micId: string) => {
    stopSettingsMicTest();
    try {
      const constraints = {
        audio: {
          ...getAudioConstraints(micId, enableAEC, enableANS, enableAGC),
          _isMixerSource: true
        } as any,
        video: false
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      settingsMicStreamRef.current = stream;
      settingsMicAnalyserRef.current = startVolumeAnalysis(stream, setSettingsMicVolume);
    } catch (e) {
      console.warn('[Mic Test] Failed to capture microphone for test:', e);
    }
  };

  const stopSettingsMicTest = () => {
    if (settingsMicAnalyserRef.current) {
      settingsMicAnalyserRef.current.stop();
      settingsMicAnalyserRef.current = null;
    }
    if (settingsMicStreamRef.current) {
      try {
        settingsMicStreamRef.current.getTracks().forEach(track => track.stop());
      } catch (e) {}
      settingsMicStreamRef.current = null;
    }
    setSettingsMicVolume(0);
  };

  const toggleMute = async () => {
    if (currentCall && callState === 'active') {
      try {
        await currentCall.toggleAudioMute();
        setIsMuted(!isMuted);
      } catch (e) {
        console.error('Mute failed:', e);
      }
    }
  };

  const changeMicrophone = async (deviceId: string) => {
    setSelectedMic(deviceId);
    localStorage.setItem('telnyx_selected_mic', deviceId);
    
    if (showSettings) {
      startSettingsMicTest(deviceId);
    }
    
    if (currentCall && typeof currentCall.setAudioInDevice === 'function') {
      try {
        await currentCall.setAudioInDevice(deviceId);
        console.log('[Microphone] Active input device updated.');
      } catch (e) {
        console.error('Failed to change mic mid-call:', e);
      }
    }
  };

  const changeSpeaker = async (deviceId: string) => {
    setSelectedSpeaker(deviceId);
    localStorage.setItem('telnyx_selected_speaker', deviceId);
    
    if (audioRef.current && typeof (audioRef.current as any).setSinkId === 'function') {
      try {
        await (audioRef.current as any).setSinkId(deviceId);
        console.log('[Speaker] Audio output element sink ID updated.');
      } catch (e) {
        console.error('Failed to change speaker on audio element:', e);
      }
    }

    if (mixerContextRef.current && typeof (mixerContextRef.current as any).setSinkId === 'function') {
      try {
        await (mixerContextRef.current as any).setSinkId(deviceId);
        console.log('[Mixer Speaker] AudioContext sink ID updated.');
      } catch (e) {
        console.error('Failed to change speaker on AudioContext:', e);
      }
    }

    if (currentCall && typeof currentCall.setAudioOutDevice === 'function') {
      try {
        await currentCall.setAudioOutDevice(deviceId);
        console.log('[Speaker] Active call output device updated.');
      } catch (e) {
        console.error('Failed to change speaker mid-call:', e);
      }
    }
  };

  // Play test sound on output speaker
  const playTestSpeakerSound = () => {
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;
      const ctx = new AudioContextClass();
      
      const now = ctx.currentTime;
      const gainNode = ctx.createGain();
      gainNode.gain.setValueAtTime(0, now);
      gainNode.gain.linearRampToValueAtTime(0.06, now + 0.05);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
      
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(500, now);
      osc.connect(gainNode);

      gainNode.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.6);
    } catch (e) {
      console.warn('Test audio error:', e);
    }
  };

  // Sound Pad Audio File Upload
  const handleSoundUpload = (index: number, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      ensureMixerContext();
      
      // Store filename metadata
      setSoundFiles(prev => {
        const updated = [...prev];
        updated[index] = file;
        return updated;
      });

      // Reset playing state
      setPlayingStates(prev => {
        const updated = [...prev];
        updated[index] = false;
        return updated;
      });

      // Read file as ArrayBuffer and decode to AudioBuffer
      const reader = new FileReader();
      reader.onload = async (event) => {
        const arrayBuffer = event.target?.result as ArrayBuffer;
        if (arrayBuffer) {
          try {
            const ctx = mixerContextRef.current;
            if (ctx) {
              const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
              soundBuffersRef.current[index] = audioBuffer;
              console.log(`[Sound Pad] Decoded file for slot ${index + 1} successfully.`);
            }
          } catch (err) {
            console.error('[Sound Pad] Error decoding audio file:', err);
          }
        }
      };
      reader.readAsArrayBuffer(file);
    }
  };

  // Play/Pause sound pad clip
  const togglePlaySound = (index: number) => {
    console.log(`[Sound Pad Debug] Slot ${index + 1} clicked. CallState: ${callState}`);
    ensureMixerContext();
    const buffer = soundBuffersRef.current[index];
    if (!buffer) {
      console.warn(`[Sound Pad Debug] No audio buffer found for Slot ${index + 1}. Make sure a file is uploaded.`);
      return;
    }

    if (playingStates[index]) {
      console.log(`[Sound Pad Debug] Stopping play for Slot ${index + 1}`);
      // Stop active sound source
      const source = activeSourcesRef.current[index];
      if (source) {
        try { source.stop(); } catch (e) {}
        activeSourcesRef.current[index] = null;
      }
      setPlayingStates(prev => {
        const updated = [...prev];
        updated[index] = false;
        return updated;
      });
    } else {
      console.log(`[Sound Pad Debug] Initiating play for Slot ${index + 1}`);
      // Pause any other playing clips to keep sound simple and clean
      for (let i = 0; i < 3; i++) {
        if (activeSourcesRef.current[i]) {
          try { activeSourcesRef.current[i]!.stop(); } catch (e) {}
          activeSourcesRef.current[i] = null;
        }
      }
      setPlayingStates(prev => prev.map((_, idx) => idx === index ? false : _));

      const ctx = mixerContextRef.current;
      const dest = mixerDestinationRef.current;
      const gainNode = slotGainsRef.current[index];
      
      console.log(`[Sound Pad Debug] Web Audio Status: ctxState=${ctx?.state}, destStreamExists=${!!dest?.stream}, gainNodeExists=${!!gainNode}`);
      
      if (!ctx || !dest || !gainNode) {
        console.error(`[Sound Pad Debug] Web Audio nodes are not initialized! ctx=${!!ctx}, dest=${!!dest}, gainNode=${!!gainNode}`);
        return;
      }

      // Resume context if needed
      if (ctx.state === 'suspended') {
        ctx.resume().then(() => {
          console.log('[Sound Pad Debug] AudioContext resumed successfully.');
        });
      }

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      activeSourcesRef.current[index] = source;

      source.connect(gainNode);

      source.onended = () => {
        console.log(`[Sound Pad Debug] Slot ${index + 1} playback ended natively.`);
        if (activeSourcesRef.current[index] === source) {
          activeSourcesRef.current[index] = null;
          setPlayingStates(prev => {
            const updated = [...prev];
            updated[index] = false;
            return updated;
          });
        }
        // VM Drop slot (index 3): restore mic and auto-hangup after playback ends
        if (index === 3) {
          console.log('[VM Drop] Playback ended — auto-hanging up call.');
          if (micGainNodeRef.current) {
            micGainNodeRef.current.gain.value = isMicEnabled ? 1.0 : 0.0;
          }
          setVmDropping(false);
          handleHangup();
        }
      };

      // If dropping voicemail, temporarily mute local mic so the message is crystal clear
      if (index === 3 && micGainNodeRef.current) {
        micGainNodeRef.current.gain.value = 0.0;
      }

      source.start(0);
      console.log(`[Sound Pad Debug] Slot ${index + 1} playback started successfully.`);
      setPlayingStates(prev => {
        const updated = [...prev];
        updated[index] = true;
        return updated;
      });
    }
  };

  // Remove sound pad file from slot
  const removeSound = (index: number) => {
    const source = activeSourcesRef.current[index];
    if (source) {
      try { source.stop(); } catch (e) {}
      activeSourcesRef.current[index] = null;
    }
    soundBuffersRef.current[index] = null;

    setSoundFiles(prev => {
      const updated = [...prev];
      updated[index] = null;
      return updated;
    });

    setPlayingStates(prev => {
      const updated = [...prev];
      updated[index] = false;
      return updated;
    });
  };

  // Handle master Volume changes for all sound pad slots
  const handleVolumeChange = (vol: number) => {
    setSoundPadVolume(vol);
    slotGainsRef.current.forEach((gainNode) => {
      if (gainNode) gainNode.gain.value = vol;
    });
  };

  // Toggle Microphone state from the Sound Pad card
  const toggleSoundPadMic = () => {
    const nextState = !isMicEnabled;
    setIsMicEnabled(nextState);
    
    if (micGainNodeRef.current) {
      micGainNodeRef.current.gain.value = nextState ? 1.0 : 0.0;
    }
  };

  const clearHistory = () => {
    setCallHistory([]);
    localStorage.removeItem('call_dialer_history');
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const formatTime = (ts: number) => {
    const date = new Date(ts);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatDate = (ts: number) => {
    const date = new Date(ts);
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[20rem_22rem_20rem] items-stretch justify-center gap-6 max-w-6xl w-full mx-auto p-2 sm:p-4 z-10">
      {/* CALL HISTORY PANEL (LEFT) */}
      <div className="w-full bg-zinc-950/80 backdrop-blur-xl border border-zinc-900 shadow-2xl rounded-[2rem] p-4 sm:p-6 flex flex-col min-h-[480px]">
        <div className="flex items-center justify-between mb-4 pb-2 border-b border-zinc-900">
          <div className="flex items-center gap-2">
            <Clock size={14} className="text-zinc-500" />
            <h2 className="text-xs font-bold tracking-wider uppercase text-zinc-400 select-none">Recent Calls</h2>
          </div>
          {callHistory.length > 0 && (
            <button 
              onClick={clearHistory}
              className="flex items-center gap-1 text-[10px] text-zinc-600 hover:text-red-400 transition-colors uppercase font-semibold"
            >
              <Trash2 size={11} /> Clear
            </button>
          )}
        </div>

        <div className="flex-grow overflow-y-auto pr-1 space-y-2.5 max-h-[380px] scrollbar-thin scrollbar-thumb-zinc-800 scrollbar-track-transparent text-zinc-300">
          {callHistory.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-24 text-zinc-700">
              <PhoneCall size={32} className="opacity-10 mb-3" />
              <p className="text-xs">No call logs available</p>
            </div>
          ) : (
            callHistory.map((log) => (
              <div 
                key={log.id} 
                className="flex items-center justify-between p-3 rounded-2xl bg-zinc-900/10 border border-zinc-900/50 hover:bg-zinc-900/40 hover:border-zinc-800/40 transition-all duration-200 group"
              >
                <div className="flex items-center gap-2.5">
                  <div className={`p-1.5 rounded-lg ${
                    log.type === 'outgoing' ? 'bg-zinc-900/60 text-zinc-500' :
                    log.type === 'incoming' ? 'bg-emerald-950/20 text-emerald-400' :
                    'bg-red-950/20 text-red-400'
                  }`}>
                    {log.type === 'outgoing' ? <ArrowUpRight size={13} /> : <ArrowDownLeft size={13} />}
                  </div>
                  <div className="text-left">
                    <p className="text-xs font-semibold text-zinc-300 group-hover:text-white transition-colors">{log.number}</p>
                    <div className="flex items-center gap-1 mt-0.5 text-[9px] text-zinc-500">
                      <span>{formatDate(log.timestamp)}</span>
                      <span>•</span>
                      <span>{formatTime(log.timestamp)}</span>
                      {log.duration !== undefined && (
                        <>
                          <span>•</span>
                          <span>{formatDuration(log.duration)}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                
                <button 
                  onClick={() => {
                    if (callState === 'idle') {
                      setPhoneNumber(log.number);
                    }
                  }}
                  className="p-1.5 rounded-lg bg-zinc-950 text-zinc-500 hover:bg-emerald-500 hover:text-black hover:scale-105 active:scale-95 transition-all duration-200 border border-zinc-900"
                  title="Copy to dialer"
                  disabled={callState !== 'idle'}
                >
                  <Phone size={10} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* DIALER PANEL (MIDDLE) */}
      <div className="w-full bg-zinc-950/80 backdrop-blur-xl border border-zinc-900 shadow-2xl rounded-[2rem] p-4 sm:p-8 flex flex-col relative overflow-hidden min-h-[480px]">
        
        {/* Background light glow */}
        <div className="absolute top-[-20%] left-[-20%] w-[140%] h-[140%] bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-zinc-800/5 via-transparent to-transparent pointer-events-none" />

        {/* Dialer Header */}
        <div className="flex items-center justify-between mb-6 pb-2 border-b border-zinc-900 z-10">
          <div className="flex items-center gap-1.5">
            <span className={`relative flex h-1.5 w-1.5 rounded-full`}>
              {sipState === 'connected' && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              )}
              <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${
                sipState === 'connected' ? 'bg-emerald-500' :
                sipState === 'connecting' ? 'bg-amber-500' :
                sipState === 'error' ? 'bg-red-500' : 'bg-zinc-600'
              }`}></span>
            </span>
            <span className="text-[10px] font-bold tracking-wider text-zinc-500 uppercase select-none">
              {sipState === 'connected' ? 'Line Connected' : sipState === 'connecting' ? 'Connecting...' : 'Offline'}
            </span>
          </div>

          {/* Header Icons Container */}
          <div className="flex items-center gap-2">
            {/* 4-Ring Guard Quick Toggle */}
            <button
              onClick={() => {
                const nextVal = !autoDropEnabled;
                setAutoDropEnabled(nextVal);
                localStorage.setItem('telnyx_auto_4_ring', String(nextVal));
              }}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[9px] font-bold uppercase tracking-wider transition-all duration-200 select-none ${
                autoDropEnabled
                  ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.15)]'
                  : 'bg-zinc-900/40 border-zinc-900/80 text-zinc-500 hover:text-zinc-300'
              }`}
              title={autoDropEnabled ? `4-Ring Free Guard: Active (${autoDropMaxRings} rings / ${autoDropMaxRings * 4.5}s max)` : '4-Ring Free Guard: Disabled'}
            >
              <Shield size={11} className={autoDropEnabled ? 'text-emerald-400' : 'text-zinc-500'} />
              <span>4-Ring Guard {autoDropEnabled ? 'ON' : 'OFF'}</span>
            </button>

            {/* Call Script Toggle */}
            {onScriptToggle && (
              <button
                onClick={onScriptToggle}
                className={`p-1.5 rounded-full border transition-all duration-200 ${
                  scriptOpen
                    ? 'bg-zinc-800 border-zinc-700 text-zinc-100'
                    : 'bg-zinc-900/40 border-zinc-900/80 text-zinc-500 hover:text-zinc-300'
                }`}
                title="Call Script"
              >
                <FileText size={14} />
              </button>
            )}
            {/* Toggle Settings Icon */}
            <button 
              onClick={toggleSettings}
              className={`p-1.5 rounded-full border transition-all duration-200 ${
                showSettings 
                  ? 'bg-zinc-800 border-zinc-700 text-zinc-100' 
                  : 'bg-zinc-900/40 border-zinc-900/80 text-zinc-500 hover:text-zinc-300'
              }`}
              title="Audio Settings"
            >
              <Settings size={14} />
            </button>
          </div>
        </div>

        {/* Status & Balance widgets */}
        <div className="grid grid-cols-2 gap-3 mb-5 z-10 select-none">
          {/* Balance Widget */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between px-3.5 py-2 sm:py-2.5 bg-zinc-900/30 border border-zinc-900/80 rounded-2xl gap-1 sm:gap-0">
            <span className="text-[9px] uppercase font-bold text-zinc-500 tracking-wider">Balance</span>
            <span className="text-xs font-bold font-mono text-zinc-300">
              {fetchingStatus && balance === '0.00' ? '...' : `$${Number(balance).toFixed(2)}`}
            </span>
          </div>

          {/* Number Health Widget */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between px-3.5 py-2 sm:py-2.5 bg-zinc-900/30 border border-zinc-900/80 rounded-2xl gap-1 sm:gap-0">
            <span className="text-[9px] uppercase font-bold text-zinc-500 tracking-wider">Number</span>
            <div className="flex items-center gap-1.5">
              <span className={`relative flex h-1.5 w-1.5 rounded-full`}>
                {numberHealth === 'healthy' && (
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                )}
                {numberHealth === 'unconfigured' && (
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                )}
                {numberHealth === 'inactive' && (
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                )}
                <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${
                  numberHealth === 'healthy' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' :
                  numberHealth === 'unconfigured' ? 'bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]' :
                  numberHealth === 'inactive' || numberHealth === 'not_found' ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]' :
                  'bg-zinc-600'
                }`}></span>
              </span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-300">
                {numberHealth}
              </span>
            </div>
          </div>
        </div>

        {/* Toggle Settings Panel vs Keypad */}
        {showSettings ? (
          /* AUDIO SETTINGS VIEW */
          <div className="flex-grow flex flex-col justify-between py-2 text-zinc-300 z-10">
            <div className="space-y-5 text-left">
              <div className="flex items-center gap-2 mb-2">
                <Settings size={16} className="text-zinc-400" />
                <h3 className="text-sm font-bold tracking-wide uppercase text-zinc-200">Audio Devices</h3>
              </div>
              
              {/* Input Device Selection */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Microphone Input</label>
                <select
                  value={selectedMic}
                  onChange={(e) => changeMicrophone(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-900 rounded-xl px-3 py-2 text-xs text-zinc-300 focus:outline-none focus:border-zinc-800 transition-colors"
                >
                  {microphones.length === 0 ? (
                    <option value="">No microphones found (Check Permissions)</option>
                  ) : (
                    microphones.map((mic) => (
                      <option key={mic.deviceId} value={mic.deviceId}>
                        {mic.label || `Microphone ${mic.deviceId.slice(0, 5)}`}
                      </option>
                    ))
                  )}
                </select>
                
                {/* Live Mic Test Meter */}
                {devicePermissionGranted && (
                  <div className="space-y-1 pt-1.5">
                    <div className="flex justify-between items-center text-[9px] uppercase font-bold text-zinc-500 tracking-wider select-none">
                      <span>Mic Level Test</span>
                      <span className="font-mono">{settingsMicVolume}%</span>
                    </div>
                    <div className="w-full h-1.5 bg-zinc-900 rounded-full overflow-hidden border border-zinc-950/40">
                      <div 
                        className="h-full bg-emerald-500 rounded-full transition-all duration-75 ease-out shadow-[0_0_8px_rgba(16,185,129,0.4)]"
                        style={{ width: `${settingsMicVolume}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Output Device Selection */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Speaker Output</label>
                <div className="flex gap-2">
                  <select
                    value={selectedSpeaker}
                    onChange={(e) => changeSpeaker(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-900 rounded-xl px-3 py-2 text-xs text-zinc-300 focus:outline-none focus:border-zinc-800 transition-colors"
                  >
                    {speakers.length === 0 ? (
                      <option value="">No speakers found</option>
                    ) : (
                      speakers.map((spk) => (
                        <option key={spk.deviceId} value={spk.deviceId}>
                          {spk.label || `Speaker ${spk.deviceId.slice(0, 5)}`}
                        </option>
                      ))
                    )}
                  </select>
                  <button 
                    onClick={playTestSpeakerSound}
                    disabled={speakers.length === 0}
                    className="px-3 rounded-xl bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-all active:scale-95 disabled:opacity-50"
                    title="Test Speaker"
                  >
                    <Play size={12} fill="currentColor" />
                  </button>
                </div>
              </div>

              {/* Information / Caller ID info */}
              <div className="p-3.5 bg-zinc-900/30 border border-zinc-900 rounded-xl space-y-1">
                <div className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider">SIP Caller ID Info</div>
                <div className="text-xs text-zinc-400 break-all">Caller ID Number: {telnyxNumber || 'None'}</div>
              </div>

              {/* Voice Processing toggles (AEC, ANS, AGC) */}
              <div className="space-y-2 pt-2 border-t border-zinc-900">
                <div className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider mb-1 select-none">Voice Processing</div>
                
                <div className="flex items-center justify-between p-2.5 rounded-xl bg-zinc-900/20 border border-zinc-900/60 select-none">
                  <span className="text-xs font-semibold text-zinc-300">Echo Cancellation (AEC)</span>
                  <input
                    type="checkbox"
                    checked={enableAEC}
                    onChange={(e) => {
                      setEnableAEC(e.target.checked);
                      localStorage.setItem('telnyx_aec', String(e.target.checked));
                      if (selectedMic) startSettingsMicTest(selectedMic);
                    }}
                    className="w-4 h-4 rounded border-zinc-900 text-emerald-500 focus:ring-0 focus:ring-offset-0 bg-zinc-950 accent-emerald-500 cursor-pointer"
                  />
                </div>

                <div className="flex items-center justify-between p-2.5 rounded-xl bg-zinc-900/20 border border-zinc-900/60 select-none">
                  <span className="text-xs font-semibold text-zinc-300">Noise Suppression (ANS)</span>
                  <input
                    type="checkbox"
                    checked={enableANS}
                    onChange={(e) => {
                      setEnableANS(e.target.checked);
                      localStorage.setItem('telnyx_ans', String(e.target.checked));
                      if (selectedMic) startSettingsMicTest(selectedMic);
                    }}
                    className="w-4 h-4 rounded border-zinc-900 text-emerald-500 focus:ring-0 focus:ring-offset-0 bg-zinc-950 accent-emerald-500 cursor-pointer"
                  />
                </div>

                <div className="flex items-center justify-between p-2.5 rounded-xl bg-zinc-900/20 border border-zinc-900/60 select-none">
                  <span className="text-xs font-semibold text-zinc-300">Auto Gain Control (AGC)</span>
                  <input
                    type="checkbox"
                    checked={enableAGC}
                    onChange={(e) => {
                      setEnableAGC(e.target.checked);
                      localStorage.setItem('telnyx_agc', String(e.target.checked));
                      if (selectedMic) startSettingsMicTest(selectedMic);
                    }}
                    className="w-4 h-4 rounded border-zinc-900 text-emerald-500 focus:ring-0 focus:ring-offset-0 bg-zinc-950 accent-emerald-500 cursor-pointer"
                  />
                </div>
              </div>

              {/* Voicemail Drop Configuration */}
              <div className="space-y-2 pt-3 border-t border-zinc-900">
                <div className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider mb-1 select-none">Voicemail Drop Audio</div>
                
                {soundFiles[3] ? (
                  <div className="p-3 rounded-xl bg-zinc-900/40 border border-zinc-900 flex items-center justify-between gap-2">
                    <div className="flex-grow min-w-0">
                      <p className="text-xs font-semibold text-amber-400 truncate">{soundFiles[3].name}</p>
                      <span className="text-[9px] text-zinc-500 block mt-0.5">Ready to drop (Hotkey V during calls)</span>
                    </div>
                    <button
                      onClick={() => removeSound(3)}
                      className="p-1 rounded bg-zinc-900 border border-zinc-800 text-zinc-500 hover:text-red-400 transition-colors"
                      title="Remove file"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ) : (
                  <label className="flex flex-col items-center justify-center p-4 rounded-xl border border-dashed border-zinc-800 bg-zinc-950/40 hover:bg-zinc-950/70 hover:border-zinc-700 cursor-pointer transition-all">
                    <Voicemail size={16} className="text-zinc-500 mb-1" />
                    <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wide">Upload VM Audio (.mp3)</span>
                    <input
                      type="file"
                      accept="audio/*"
                      onChange={(e) => handleSoundUpload(3, e)}
                      className="hidden"
                    />
                  </label>
                )}
              </div>

              {/* 4-Ring Rule ($0.00 Free Dials) Configuration */}
              <div className="space-y-2.5 pt-3 border-t border-zinc-900 select-none">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Shield size={13} className="text-emerald-400" />
                    <span className="text-[10px] uppercase font-bold text-zinc-300 tracking-wider">4-Ring Rule ($0.00 Free Dials)</span>
                  </div>
                  <span className="text-[9px] font-mono font-bold text-emerald-400 bg-emerald-950/60 border border-emerald-800/50 px-1.5 py-0.5 rounded-md">
                    Zero-Cost Guard
                  </span>
                </div>
                
                <p className="text-[10px] text-zinc-500 leading-relaxed">
                  Telnyx charges $0.00 while ringing. Automatically hangs up before voicemail picks up to make 100% free unanswered dials.
                </p>

                <div className="flex items-center justify-between p-2.5 rounded-xl bg-zinc-900/20 border border-zinc-900/60">
                  <span className="text-xs font-semibold text-zinc-300">Auto-Hangup on Ring Limit</span>
                  <input
                    type="checkbox"
                    checked={autoDropEnabled}
                    onChange={(e) => {
                      setAutoDropEnabled(e.target.checked);
                      localStorage.setItem('telnyx_auto_4_ring', String(e.target.checked));
                    }}
                    className="w-4 h-4 rounded border-zinc-900 text-emerald-500 focus:ring-0 bg-zinc-950 accent-emerald-500 cursor-pointer"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Ring Limit Duration</label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { rings: 3, secs: '13.5s', label: '3 Rings' },
                      { rings: 4, secs: '18.0s', label: '4 Rings (Rec.)' },
                      { rings: 5, secs: '22.5s', label: '5 Rings' },
                    ].map(item => (
                      <button
                        key={item.rings}
                        type="button"
                        onClick={() => {
                          setAutoDropMaxRings(item.rings);
                          localStorage.setItem('telnyx_ring_limit', String(item.rings));
                        }}
                        className={`px-2 py-1.5 rounded-xl border text-[10px] font-bold transition-all flex flex-col items-center ${
                          autoDropMaxRings === item.rings
                            ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300 shadow-[0_0_8px_rgba(16,185,129,0.2)]'
                            : 'bg-zinc-950 border-zinc-900 text-zinc-500 hover:text-zinc-300'
                        }`}
                      >
                        <span>{item.label}</span>
                        <span className="text-[8px] font-mono text-zinc-500 mt-0.5">{item.secs}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Back Button */}
            <button 
              onClick={() => setShowSettings(false)}
              className="w-full py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 hover:bg-zinc-800 hover:text-white transition-all text-xs font-semibold text-zinc-400 mt-4 active:scale-[0.98]"
            >
              Back to Dialer
            </button>
          </div>
        ) : (
          /* DIALER PAD VIEW */
          <div className="flex-grow flex flex-col justify-between z-10">
            
            {/* Number Input & Status displays */}
            <div className="text-center flex flex-col justify-center items-center py-4 min-h-[110px] select-none">
              {/* Active Lead HUD */}
              {activeLead && callState !== 'idle' && (
                <div className="mb-2 px-3 py-2 bg-[#00c896]/5 border border-[#00c896]/20 rounded-2xl text-center">
                  <div className="flex items-center justify-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-[#00c896]/20 text-[#00c896] text-[9px] font-bold flex items-center justify-center">
                      {[activeLead.firstName[0], activeLead.lastName[0]].filter(Boolean).join('').toUpperCase() || '#'}
                    </div>
                    <div className="text-left">
                      <p className="text-[11px] font-bold text-[#00c896]">{activeLead.firstName} {activeLead.lastName}</p>
                      {activeLead.company && (
                        <p className="text-[9px] text-zinc-500 flex items-center gap-0.5">
                          <Building2 size={8} /> {activeLead.company}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Outbound tag */}
              {callState === 'idle' && (
                <div className="text-[10px] font-semibold tracking-wider text-zinc-600 uppercase mb-1">
                  {activeLead
                    ? <span className="text-[#00c896]/60">Next: {activeLead.firstName} {activeLead.lastName}</span>
                    : `Outbound Caller: ${telnyxNumber || 'Not configured'}`
                  }
                </div>
              )}

              {/* Dynamic Status message */}
              {callState !== 'idle' && (
                <div className="text-[10px] font-bold tracking-widest text-emerald-400 uppercase mb-1.5 animate-pulse">
                  {callState === 'dialing' && 'Connecting...'}
                  {callState === 'ringing' && 'Ringing...'}
                  {callState === 'active' && 'Connected'}
                  {callState === 'done' && 'Call Ended'}
                </div>
              )}

              {/* Ticking call timer */}
              {callState === 'active' && (
                <div className="text-xs font-semibold font-mono text-zinc-400 mb-1">
                  {formatDuration(callDuration)}
                </div>
              )}

              {/* Real-time WebRTC Audio Spinners (Input and Output) */}
              {callState === 'active' && (
                <div className="flex items-center gap-6 my-2.5">
                  <div className="flex flex-col items-center gap-1 select-none">
                    <VolumeSpinner volume={inputVolume} icon={Mic} active={!isMuted} color="stroke-emerald-500" />
                    <span className="text-[8px] font-bold uppercase tracking-wider text-zinc-500">Mic (In)</span>
                  </div>
                  <div className="flex flex-col items-center gap-1 select-none">
                    <VolumeSpinner volume={outputVolume} icon={Volume2} active={true} color="stroke-cyan-500" />
                    <span className="text-[8px] font-bold uppercase tracking-wider text-zinc-500">Speaker (Out)</span>
                  </div>
                </div>
              )}

              {/* 4-Ring Rule Live Cadence & Progress Bar (Outbound Dialing / Ringing) */}
              {(callState === 'dialing' || callState === 'ringing') && currentCall?.direction !== 'inbound' && (
                <div className="w-full max-w-[280px] flex flex-col items-center gap-2 my-2.5 px-3 py-2.5 bg-zinc-900/40 border border-zinc-850 rounded-2xl">
                  <div className="flex items-center justify-between w-full text-[10px] font-mono select-none">
                    <div className="flex items-center gap-1.5 text-emerald-400 font-bold">
                      <Shield size={12} className="text-emerald-400 animate-pulse shrink-0" />
                      <span>{autoDropEnabled ? '4-Ring Auto-Guard' : 'Ring Tracker'}:</span>
                      <span className="text-zinc-200">
                        Ring {Math.min(autoDropMaxRings, Math.max(1, Math.floor(ringingSeconds / 4.5) + 1))} of {autoDropMaxRings}
                      </span>
                    </div>
                    <span className="text-zinc-400 font-bold font-mono">{ringingSeconds.toFixed(1)}s</span>
                  </div>

                  {/* Visual Ring Pips */}
                  <div className="grid grid-cols-4 gap-1.5 w-full">
                    {Array.from({ length: autoDropMaxRings }).map((_, idx) => {
                      const ringNum = idx + 1;
                      const currentRing = Math.floor(ringingSeconds / 4.5) + 1;
                      const isPast = currentRing > ringNum;
                      const isCurrent = currentRing === ringNum;
                      const isLastRing = ringNum === autoDropMaxRings;
                      
                      return (
                        <div key={idx} className="flex flex-col items-center gap-1">
                          <div className={`h-1.5 w-full rounded-full transition-all duration-200 ${
                            isPast 
                              ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]' 
                              : isCurrent 
                                ? isLastRing 
                                  ? 'bg-amber-400 animate-pulse shadow-[0_0_8px_rgba(251,191,36,0.6)]' 
                                  : 'bg-emerald-400 animate-pulse shadow-[0_0_6px_rgba(16,185,129,0.4)]'
                                : 'bg-zinc-800'
                          }`} />
                          <span className={`text-[8px] font-mono uppercase ${
                            isPast || isCurrent 
                              ? (isLastRing ? 'text-amber-400 font-bold' : 'text-emerald-400 font-bold') 
                              : 'text-zinc-600'
                          }`}>
                            R{ringNum}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {/* Free Dial Notice & Escape Hint */}
                  <div className="flex items-center justify-between w-full pt-1 border-t border-zinc-850/80 text-[9px] select-none">
                    <span className="text-emerald-400 font-semibold flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block animate-ping" />
                      $0.00 Free Dial
                    </span>
                    <span className="text-zinc-400 flex items-center gap-1">
                      Press <kbd className="px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-200 font-mono font-bold text-[8px]">ESC</kbd> to Drop Free
                    </span>
                  </div>
                </div>
              )}

              {/* Interactive display field */}
              <div className="relative w-full flex items-center justify-center px-2">
                <input
                  type="text"
                  value={formatPhoneNumber(phoneNumber)}
                  onChange={handleInputChange}
                  onPaste={handlePaste}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (callState === 'idle' && phoneNumber.trim() && sipState === 'connected') {
                        handleCall();
                      }
                    }
                  }}
                  placeholder="Enter number"
                  disabled={callState !== 'idle'}
                  className="w-full bg-transparent border-none outline-none text-center text-2xl font-bold font-mono text-zinc-100 placeholder-zinc-800 tracking-wide select-all focus:ring-0 focus:outline-none"
                />
              </div>

              {/* VM Dropping Banner */}
              {vmDropping && callState === 'active' && (
                <div className="flex items-center gap-1.5 px-3 py-1 bg-amber-950/40 border border-amber-850 rounded-full text-amber-300 text-[10px] font-bold animate-pulse my-1 select-none">
                  <Voicemail size={13} className="text-amber-400 shrink-0" />
                  <span>Dropping Voicemail... (Auto-hangup when finished)</span>
                </div>
              )}

              {/* Mute indicator banner */}
              {isMuted && callState === 'active' && !vmDropping && (
                <span className="text-[9px] text-red-400 tracking-wider uppercase font-bold mt-1">
                  Microphone Muted
                </span>
              )}

              {/* Voicemail Hotkey cue */}
              {!vmDropping && callState === 'active' && soundFiles[3] && (
                <span className="text-[9px] text-zinc-500 font-mono mt-1 flex items-center gap-1 select-none">
                  Press <kbd className="px-1 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-amber-400 font-bold text-[8px]">V</kbd> to Drop Voicemail
                </span>
              )}
            </div>

            {/* Free Dial Success / Auto-drop Banner */}
            {freeDialNotice && (
              <div className="mx-2 mb-2 p-2.5 rounded-xl bg-emerald-950/30 border border-emerald-800/50 text-emerald-300 text-[10px] text-center select-text relative flex items-center justify-between gap-1 shadow-[0_0_15px_rgba(16,185,129,0.1)]">
                <div className="flex items-center gap-1.5 mx-auto">
                  <ShieldCheck size={13} className="text-emerald-400 shrink-0" />
                  <span className="font-semibold">{freeDialNotice}</span>
                </div>
                <button onClick={() => setFreeDialNotice(null)} className="text-emerald-400 hover:text-emerald-200">
                  <X size={12} />
                </button>
              </div>
            )}

            {/* Error logs */}
            {errorMessage && (
              <div className="mx-2 mb-2 p-2.5 rounded-xl bg-red-950/20 border border-red-900/35 text-red-400 text-[10px] text-center select-text relative flex items-center gap-1 justify-center">
                <span>{errorMessage}</span>
                <button onClick={() => setErrorMessage(null)} className="text-red-500 hover:text-red-300">
                  <X size={10} />
                </button>
              </div>
            )}

            {/* Dialer Keypad 3x4 Grid */}
            <div className="grid grid-cols-3 gap-y-3 gap-x-3 sm:gap-x-5 justify-items-center py-2">
              {[
                { digit: '1', letters: ' ' },
                { digit: '2', letters: 'A B C' },
                { digit: '3', letters: 'D E F' },
                { digit: '4', letters: 'G H I' },
                { digit: '5', letters: 'J K L' },
                { digit: '6', letters: 'M N O' },
                { digit: '7', letters: 'P R S' },
                { digit: '8', letters: 'T U V' },
                { digit: '9', letters: 'W X Y' },
                { digit: '*', letters: '' },
                { digit: '0', letters: '+' },
                { digit: '#', letters: '' },
              ].map((item) => (
                <button
                  key={item.digit}
                  onClick={() => handleKeyPress(item.digit)}
                  className="w-[3.8rem] h-[3.8rem] rounded-full flex flex-col items-center justify-center bg-zinc-950 border border-zinc-900 text-zinc-100 hover:bg-zinc-900 hover:border-zinc-800 active:scale-90 active:bg-zinc-800 transition-all duration-100 select-none group"
                  disabled={callState === 'ringing' || callState === 'done'}
                >
                  <span className="text-lg font-bold font-mono group-active:text-emerald-400 transition-colors">{item.digit}</span>
                  {item.letters && (
                    <span className="text-[7px] font-bold tracking-widest text-zinc-600 uppercase scale-90 mt-0.5">
                      {item.letters}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Call / Action Controls Bar */}
            <div className="flex items-center justify-between px-4 pt-4 pb-1">
              <div className="w-12 h-12 flex items-center justify-center">
                {callState === 'active' ? (
                  <button 
                    onClick={toggleMute}
                    className={`w-10 h-10 rounded-full border flex items-center justify-center transition-all active:scale-90 ${
                      isMuted 
                        ? 'bg-red-950/30 border-red-900/50 text-red-400 hover:bg-red-900/20' 
                        : 'bg-zinc-900 border-zinc-850 text-zinc-400 hover:bg-zinc-850 hover:text-zinc-200'
                    }`}
                    title={isMuted ? 'Unmute Mic' : 'Mute Mic'}
                  >
                    {isMuted ? <MicOff size={15} /> : <Mic size={15} />}
                  </button>
                ) : (
                  callState === 'idle' && phoneNumber && (
                    <button 
                      onClick={handleClear}
                      className="w-10 h-10 rounded-full bg-zinc-950 hover:bg-zinc-900 border border-zinc-900 flex items-center justify-center text-zinc-650 hover:text-zinc-400 transition-all"
                      title="Clear display"
                    >
                      <RotateCcw size={13} />
                    </button>
                  )
                )}
              </div>

              <div>
                {callState === 'idle' && (
                  <button
                    onClick={handleCall}
                    disabled={!phoneNumber || sipState !== 'connected'}
                    className="w-14 h-14 rounded-full flex items-center justify-center bg-emerald-500 text-black hover:bg-emerald-400 active:scale-95 transition-all duration-200 shadow-[0_4px_15px_rgba(16,185,129,0.2)] hover:shadow-[0_4px_20px_rgba(16,185,129,0.35)] disabled:bg-zinc-900 disabled:text-zinc-700 disabled:shadow-none disabled:cursor-not-allowed select-none border border-transparent"
                    title="Call"
                  >
                    <Phone size={20} fill="currentColor" />
                  </button>
                )}

                {callState === 'ringing' && (
                  currentCall?.direction === 'inbound' ? (
                    <div className="flex gap-3 items-center">
                      <button
                        onClick={handleReject}
                        className="w-12 h-12 rounded-full flex items-center justify-center bg-red-500 text-white hover:bg-red-400 active:scale-95 transition-all duration-200 shadow-md"
                        title="Decline"
                      >
                        <PhoneOff size={18} />
                      </button>
                      <button
                        onClick={handleAnswer}
                        className="w-12 h-12 rounded-full flex items-center justify-center bg-emerald-500 text-black hover:bg-emerald-400 active:scale-95 transition-all duration-200 shadow-md animate-bounce"
                        title="Accept"
                      >
                        <Phone size={18} fill="currentColor" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={handleHangup}
                      className="w-14 h-14 rounded-full flex items-center justify-center bg-red-500 text-white hover:bg-red-400 active:scale-95 transition-all duration-200 shadow-[0_4px_15px_rgba(239,68,68,0.25)]"
                      title="Hang Up"
                    >
                      <PhoneOff size={20} />
                    </button>
                  )
                )}

                {(callState === 'dialing' || callState === 'active') && (
                  <button
                    onClick={handleHangup}
                    className="w-14 h-14 rounded-full flex items-center justify-center bg-red-500 text-white hover:bg-red-400 active:scale-95 transition-all duration-200 shadow-[0_4px_15px_rgba(239,68,68,0.25)]"
                    title="Hang Up"
                  >
                    <PhoneOff size={20} />
                  </button>
                )}
                
                {callState === 'done' && (
                  <button
                    disabled
                    className="w-14 h-14 rounded-full flex items-center justify-center bg-zinc-900 text-zinc-650 cursor-not-allowed"
                  >
                    <PhoneOff size={20} />
                  </button>
                )}
              </div>

              <div className="w-12 h-12 flex items-center justify-center">
                {callState === 'idle' && phoneNumber && (
                  <button
                    onClick={handleBackspace}
                    className="w-10 h-10 rounded-full bg-zinc-950 hover:bg-zinc-900 border border-zinc-900 flex items-center justify-center text-zinc-500 hover:text-zinc-300 transition-all active:scale-90"
                    title="Backspace"
                  >
                    <Delete size={14} />
                  </button>
                )}
                {callState === 'active' && (
                  <button
                    onClick={() => {
                      if (!soundFiles[3] || vmDropping) return;
                      setVmDropping(true);
                      togglePlaySound(3);
                    }}
                    disabled={!soundFiles[3] || vmDropping}
                    className={`w-10 h-10 rounded-full border flex items-center justify-center transition-all active:scale-90 ${
                      vmDropping
                        ? 'bg-amber-500 text-black animate-pulse border-amber-400'
                        : soundFiles[3]
                          ? 'bg-amber-950/30 border-amber-900/50 text-amber-400 hover:bg-amber-900/20'
                          : 'bg-zinc-950 border-zinc-900 text-zinc-700 cursor-not-allowed'
                    }`}
                    title={soundFiles[3] ? 'Drop Voicemail (V)' : 'Upload VM Audio file in Settings first'}
                  >
                    <Voicemail size={15} />
                  </button>
                )}
              </div>
            </div>

          </div>
        )}
      </div>

      {/* QUICK SMS PANEL (RIGHT) */}
      <div className="w-full bg-zinc-950/80 backdrop-blur-xl border border-zinc-900 shadow-2xl rounded-[2rem] p-4 sm:p-6 flex flex-col min-h-[480px] h-full justify-between overflow-hidden">
        <div className="flex flex-col h-full flex-grow min-h-0">
          {/* Header */}
          <div className="flex items-center justify-between mb-1 pb-1 select-none">
            <div className="flex items-center gap-2">
              <MessageSquare size={14} className="text-emerald-400" />
              <h2 className="text-xs font-bold tracking-wider uppercase text-zinc-400">Quick SMS</h2>
            </div>
            
            {/* Active Phone Indicator */}
            {(activeLead?.phone || phoneNumber) ? (
              <span className="text-[10px] font-mono text-zinc-500 bg-zinc-900 px-2 py-0.5 rounded-full border border-zinc-800">
                {activeLead?.phone || phoneNumber}
              </span>
            ) : (
              <span className="text-[9px] font-bold text-zinc-600 bg-zinc-900/30 px-2 py-0.5 rounded-full uppercase tracking-wider">
                Idle
              </span>
            )}
          </div>

          {/* Sender SMS Number */}
          {telnyxSmsNumber && (
            <div className="text-[9px] font-semibold text-zinc-600 mb-2 pb-1 border-b border-zinc-900/60 select-none flex items-center justify-between">
              <span>Sending from:</span>
              <span className="font-mono text-zinc-500">{telnyxSmsNumber}</span>
            </div>
          )}

          {/* Target number block check */}
          {!(activeLead?.phone || phoneNumber) ? (
            /* NO NUMBER IN QUEUE STATE */
            <div className="flex-grow flex flex-col items-center justify-center text-center p-6 select-none my-auto">
              <div className="w-12 h-12 rounded-full bg-zinc-900 border border-zinc-850 flex items-center justify-center mb-3 text-zinc-650">
                <MessageSquare size={20} />
              </div>
              <p className="text-xs font-bold text-zinc-400 uppercase tracking-wide">No Active Number</p>
              <p className="text-[10px] text-zinc-600 max-w-[15rem] mt-1.5 leading-relaxed">
                Select a lead from your queue or enter a number in the dialpad to start texting.
              </p>
            </div>
          ) : (
            /* SMS WORKSPACE STATE */
            <div className="flex flex-col flex-grow min-h-0 h-full">
              {/* Message Feed */}
              <div className="flex-grow overflow-y-auto space-y-3 pr-1 pb-4 scrollbar-thin scrollbar-thumb-zinc-900 scrollbar-track-transparent min-h-[220px] max-h-[300px]">
                {smsMessages.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center p-4 select-none my-auto">
                    <p className="text-[10px] font-bold text-zinc-600 uppercase tracking-wider">No message history</p>
                    <p className="text-[9px] text-zinc-700 mt-1 max-w-[12rem] leading-relaxed">
                      Type below to send your first message to this contact.
                    </p>
                  </div>
                ) : (
                  smsMessages.map((msg) => {
                    const isOutbound = msg.direction === 'outbound';
                    return (
                      <div
                        key={msg.id}
                        className={`flex flex-col ${isOutbound ? 'items-end' : 'items-start'}`}
                      >
                        <div
                          className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-xs leading-relaxed select-text ${
                            isOutbound
                              ? 'bg-emerald-500/10 border border-emerald-500/25 text-emerald-100 rounded-tr-none'
                              : 'bg-zinc-900 border border-zinc-800 text-zinc-200 rounded-tl-none'
                          }`}
                        >
                          {msg.text}
                        </div>
                        <div className="flex items-center gap-1.5 mt-1 px-1.5 text-[8px] font-bold text-zinc-650 select-none uppercase tracking-wider">
                          <span>
                            {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          {isOutbound && (
                            <>
                              <span>•</span>
                              <span className={
                                msg.status === 'delivered' ? 'text-emerald-500' :
                                msg.status === 'failed' ? 'text-red-500' : 'text-zinc-550'
                              }>
                                {msg.status}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messageEndRef} />
              </div>

              {/* Input Form & Template Selector */}
              <form onSubmit={handleSendSms} className="pt-2 border-t border-zinc-900 mt-auto select-none">
                {/* Template Selector dropdown */}
                {smsTemplates.length > 0 && (
                  <div className="mb-2">
                    <select
                      value={selectedTemplateId}
                      onChange={(e) => handleTemplateChange(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-900 rounded-xl px-2.5 py-1.5 text-[10px] font-bold text-zinc-400 focus:outline-none focus:border-zinc-800 transition-colors uppercase tracking-wider cursor-pointer"
                    >
                      <option value="">-- Use a template --</option>
                      {smsTemplates.map(t => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Input text + send button */}
                <div className="flex gap-2 items-center bg-zinc-950 border border-zinc-900 rounded-2xl p-1.5 focus-within:border-zinc-800 transition-colors">
                  <textarea
                    ref={textareaRef}
                    rows={1}
                    value={smsInput}
                    onChange={(e) => setSmsInput(e.target.value)}
                    placeholder="Type a message..."
                    className="flex-grow bg-transparent border-0 resize-none px-2 py-1 text-xs text-zinc-200 placeholder-zinc-600 focus:ring-0 focus:outline-none scrollbar-none max-h-[120px]"
                    style={{ height: 'auto', minHeight: '24px' }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendSms(e as any);
                      }
                    }}
                  />
                  <button
                    type="submit"
                    disabled={isSendingSms || !smsInput.trim()}
                    className="w-8 h-8 rounded-xl bg-emerald-500 text-black hover:bg-emerald-400 active:scale-95 disabled:bg-zinc-900 disabled:text-zinc-700 transition-all flex items-center justify-center flex-shrink-0 cursor-pointer"
                  >
                    {isSendingSms ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Send size={13} fill="currentColor" />
                    )}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>

      {/* Dynamic native audio output for remote voice */}
      <audio ref={audioRef} id="remote-audio" autoPlay className="hidden" />

    </div>
  );
}
