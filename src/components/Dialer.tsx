'use client';

import React, { useState, useEffect, useRef } from 'react';
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
  RotateCcw
} from 'lucide-react';
import { audioService } from '@/utils/audio';

interface CallLog {
  id: string;
  number: string;
  type: 'incoming' | 'outgoing' | 'missed';
  timestamp: number;
  duration?: number;
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
    channelCount: 1,
    deviceId: micId ? { exact: micId } : undefined,
  };
};

export default function Dialer() {
  // WebRTC & Connection State
  const [client, setClient] = useState<any>(null);
  const [currentCall, setCurrentCall] = useState<any>(null);
  const [sipState, setSipState] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
  const [callState, setCallState] = useState<'idle' | 'dialing' | 'ringing' | 'active' | 'done'>('idle');
  const [isMuted, setIsMuted] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [telnyxNumber, setTelnyxNumber] = useState<string>('');

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

  // Sound Pad State
  const [soundFiles, setSoundFiles] = useState<(File | null)[]>([null, null, null]);
  const [soundUrls, setSoundUrls] = useState<(string | null)[]>([null, null, null]);
  const [playingStates, setPlayingStates] = useState<boolean[]>([false, false, false]);
  const [soundPadVolume, setSoundPadVolume] = useState(0.5);
  const [isMicEnabled, setIsMicEnabled] = useState(true);
  const [settingsMicVolume, setSettingsMicVolume] = useState(0);

  // Refs
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const durationIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const callStartTimeRef = useRef<number | null>(null);
  const inputVolumeAnalyserRef = useRef<any>(null);
  const outputVolumeAnalyserRef = useRef<any>(null);
  const clientRef = useRef<any>(null);
  const settingsMicStreamRef = useRef<MediaStream | null>(null);
  const settingsMicAnalyserRef = useRef<any>(null);

  // Web Audio Mixer Refs
  const mixerContextRef = useRef<AudioContext | null>(null);
  const mixerDestinationRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const slotAudiosRef = useRef<(HTMLAudioElement | null)[]>([null, null, null]);
  const slotSourcesRef = useRef<any[]>([null, null, null]);
  const slotGainsRef = useRef<any[]>([null, null, null]);
  const micGainNodeRef = useRef<GainNode | null>(null);

  // Helper to format phone number progressively for display
  const formatPhoneNumber = (num: string): string => {
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
      if (!mixerContextRef.current) {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioContextClass) return;

        console.log('[Mixer] Initializing global Web Audio mixer context with interactive latency.');
        const ctx = new AudioContextClass({
          latencyHint: 'interactive'
        });
        mixerContextRef.current = ctx;

        const dest = ctx.createMediaStreamDestination();
        mixerDestinationRef.current = dest;

        // Wire up slot audio elements (prevent duplicate sources for same elements)
        slotAudiosRef.current.forEach((audioEl, index) => {
          if (audioEl && !slotSourcesRef.current[index]) {
            try {
              const sourceNode = ctx.createMediaElementSource(audioEl);
              slotSourcesRef.current[index] = sourceNode;

              const gainNode = ctx.createGain();
              gainNode.gain.value = soundPadVolume;
              slotGainsRef.current[index] = gainNode;

              sourceNode.connect(gainNode);
              gainNode.connect(dest); // Routes to call channel
              gainNode.connect(ctx.destination); // Routes to local speaker output
            } catch (err) {
              console.warn(`[Mixer] Failed to capture audio element for slot ${index}:`, err);
            }
          }
        });
      } else if (mixerContextRef.current.state === 'suspended') {
        mixerContextRef.current.resume();
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
      const dest = mixerDestinationRef.current;
      if (!ctx || !dest) return null;

      console.log('[Mixer] Capturing user mic and merging stream channels...');
      
      // Capture mic stream
      const constraints = {
        audio: getAudioConstraints(selectedMic, enableAEC, enableANS, enableAGC),
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
      
      const micGain = ctx.createGain();
      micGain.gain.value = isMicEnabled ? 1.0 : 0.0;
      micGainNodeRef.current = micGain;

      micSource.connect(micGain);
      micGain.connect(dest);

      return dest.stream;
    } catch (err) {
      console.error('[Mixer] Failed to construct mixed audio stream:', err);
      return null;
    }
  };

  // Cleanup mic capture and resources
  const stopMicCapture = () => {
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
        await navigator.mediaDevices.getUserMedia({ audio: true });
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
    let localClient: any = null;

    const init = async () => {
      try {
        setSipState('connecting');
        
        // Retrieve public caller ID number
        const outboundNumber = process.env.NEXT_PUBLIC_TELNYX_NUMBER || '';
        setTelnyxNumber(outboundNumber);

        // Populate devices list immediately
        loadAudioDevices(false);

        // Fetch JWT or direct SIP credentials from our API route
        const response = await fetch('/api/telnyx/token');
        if (!active) return;

        if (!response.ok) {
          throw new Error(`Failed to fetch credentials: ${response.statusText}`);
        }
        const data = await response.json();
        if (!active) return;

        // Dynamically import WebRTC SDK
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

        console.log('[Dialer] Initializing TelnyxRTC...');
        const rtcClient = new TelnyxRTC(clientOptions);
        localClient = rtcClient;
        clientRef.current = rtcClient;

        rtcClient.on('telnyx.ready', () => {
          if (!active) return;
          console.log('[Dialer] WebRTC signaling ready.');
          setSipState('connected');
          setErrorMessage(null);
        });

        rtcClient.on('telnyx.error', (error: any) => {
          if (!active) return;
          console.error('[Dialer] Telnyx SDK error:', error);
          setSipState('error');
          setErrorMessage(error.message || 'Authentication or connection error.');
        });

        rtcClient.on('telnyx.notification', (notification: any) => {
          if (!active) return;
          console.log('[Dialer] Notification:', notification.type);
          
          if (notification.type === 'callUpdate') {
            const call = notification.call;
            setCurrentCall(call);

            switch (call.state) {
              case 'trying':
              case 'requesting':
                setCallState('dialing');
                audioService.startRingback();
                break;
              case 'ringing':
                setCallState('ringing');
                audioService.startRingtone();
                setPhoneNumber(call.callerNumber || 'Incoming Call');
                break;
              case 'active':
                setCallState('active');
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

                // Apply selected speaker
                if (audioRef.current && call.remoteStream) {
                  audioRef.current.srcObject = call.remoteStream;
                  
                  const savedSpk = localStorage.getItem('telnyx_selected_speaker');
                  if (savedSpk && typeof (audioRef.current as any).setSinkId === 'function') {
                    (audioRef.current as any).setSinkId(savedSpk).catch((e: any) => {
                      console.warn('[Speaker] Failed to set sink ID:', e);
                    });
                  }
                  
                  audioRef.current.play().catch(err => {
                    console.warn('[Audio] Autoplay blocked or failed:', err);
                  });
                }

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
                  number: call.destinationNumber || call.callerNumber || phoneNumber,
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
        setClient(rtcClient);

      } catch (err: any) {
        if (!active) return;
        console.error('[Dialer] Init error:', err);
        setSipState('error');
        setErrorMessage(err.message || 'Failed to initialize dialer.');
      }
    };

    init();

    return () => {
      active = false;
      if (durationIntervalRef.current) clearInterval(durationIntervalRef.current);
      audioService.stopRingback();
      stopMicCapture();
      if (inputVolumeAnalyserRef.current) inputVolumeAnalyserRef.current.stop();
      if (outputVolumeAnalyserRef.current) outputVolumeAnalyserRef.current.stop();

      if (localClient) {
        try {
          console.log('[Dialer] Disconnecting TelnyxRTC client on unmount...');
          localClient.disconnect();
        } catch (e) {
          console.warn('[Dialer] Failed to disconnect local client on unmount:', e);
        }
      }
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
    }
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
      if (callState === 'ringing' || showSettings) return;
      
      const key = e.key.toLowerCase();
      const activeEl = document.activeElement;
      const isInputFocused = activeEl && activeEl.tagName === 'INPUT';

      if (!isInputFocused) {
        if (/[0-9]/.test(key) || key === '*' || key === '#') {
          e.preventDefault();
          handleKeyPress(key);
        } else if (e.key === 'Backspace') {
          e.preventDefault();
          handleBackspace();
        } else if (e.key === 'Enter') {
          e.preventDefault();
          if (callState === 'idle') {
            handleCall();
          }
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
        }
      }
      
      if (e.key === 'Escape') {
        e.preventDefault();
        if (callState !== 'idle') {
          handleHangup();
        }
      }
    };

    const handleGlobalPaste = (e: ClipboardEvent) => {
      if (callState !== 'idle' || showSettings) return;
      
      const activeEl = document.activeElement;
      const isInputFocused = activeEl && activeEl.tagName === 'INPUT';
      
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
      setErrorMessage('Dialer is not connected to Telnyx network.');
      return;
    }
    if (!phoneNumber) return;

    try {
      setErrorMessage(null);
      stopSettingsMicTest(); // Stop tester when making a call
      const cleanNumber = phoneNumber.replace(/[^0-9*#+]/g, '');
      console.log(`[Dialer] Outgoing call to: ${cleanNumber}`);

      // Mix local microphone and sound pad elements
      const mixedStream = await getMixedStream();

      const call = client.newCall({
        destinationNumber: cleanNumber,
        audio: getAudioConstraints(selectedMic, enableAEC, enableANS, enableAGC),
        localStream: mixedStream || undefined,
        callerNumber: telnyxNumber || undefined,
      });

      setCurrentCall(call);
    } catch (err: any) {
      console.error('[Dialer] Failed to place call:', err);
      setErrorMessage(err.message || 'Call failed.');
    }
  };

  const handleHangup = () => {
    console.log('[Dialer] Hangup requested. Call state:', callState, 'Current call:', !!currentCall);
    try {
      if (currentCall) {
        currentCall.hangup();
      }
    } catch (e) {
      console.warn('[Dialer] Error calling currentCall.hangup():', e);
    }
    
    // Force teardown states in case 'done' event isn't received
    setCallState('done');
    audioService.stopRingback();
    audioService.stopRingtone();
    audioService.playCallEnd();
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

    setTimeout(() => {
      setCallState('idle');
      setCurrentCall(null);
      setCallDuration(0);
      callStartTimeRef.current = null;
    }, 800);
  };

  const handleAnswer = async () => {
    if (currentCall && callState === 'ringing') {
      stopSettingsMicTest(); // Stop tester when answering a call
      const mixedStream = await getMixedStream();
      currentCall.answer({
        audio: getAudioConstraints(selectedMic, enableAEC, enableANS, enableAGC),
        localStream: mixedStream || undefined,
      });
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
        audio: getAudioConstraints(micId, enableAEC, enableANS, enableAGC),
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
      
      // Store local file objects and URLs
      const url = URL.createObjectURL(file);
      
      setSoundFiles(prev => {
        const updated = [...prev];
        updated[index] = file;
        return updated;
      });

      setSoundUrls(prev => {
        const updated = [...prev];
        if (updated[index]) URL.revokeObjectURL(updated[index]!); // Revoke previous
        updated[index] = url;
        return updated;
      });

      // Reset playing state
      setPlayingStates(prev => {
        const updated = [...prev];
        updated[index] = false;
        return updated;
      });
    }
  };

  // Play/Pause sound pad clip
  const togglePlaySound = (index: number) => {
    ensureMixerContext();
    const audioEl = slotAudiosRef.current[index];
    if (!audioEl) return;

    if (playingStates[index]) {
      audioEl.pause();
      setPlayingStates(prev => {
        const updated = [...prev];
        updated[index] = false;
        return updated;
      });
    } else {
      // Pause any other playing clips to keep sound simple and clean
      slotAudiosRef.current.forEach((el, idx) => {
        if (el && idx !== index) {
          el.pause();
          el.currentTime = 0;
        }
      });
      setPlayingStates(prev => prev.map((_, i) => i === index ? false : _));

      audioEl.play()
        .then(() => {
          setPlayingStates(prev => {
            const updated = [...prev];
            updated[index] = true;
            return updated;
          });
        })
        .catch(err => console.error('[Sound Pad] Playback blocked or failed:', err));
    }
  };

  // Remove sound pad file from slot
  const removeSound = (index: number) => {
    const audioEl = slotAudiosRef.current[index];
    if (audioEl) {
      audioEl.pause();
      audioEl.src = '';
    }

    setSoundFiles(prev => {
      const updated = [...prev];
      updated[index] = null;
      return updated;
    });

    setSoundUrls(prev => {
      const updated = [...prev];
      if (updated[index]) URL.revokeObjectURL(updated[index]!);
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
    <div className="grid grid-cols-1 lg:grid-cols-[20rem_22rem_20rem] items-stretch justify-center gap-6 max-w-6xl w-full mx-auto p-4 z-10">
      
      {/* CALL HISTORY PANEL (LEFT) */}
      <div className="w-full bg-zinc-950/80 backdrop-blur-xl border border-zinc-900 shadow-2xl rounded-[2rem] p-6 flex flex-col min-h-[480px]">
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
      <div className="w-full bg-zinc-950/80 backdrop-blur-xl border border-zinc-900 shadow-2xl rounded-[2rem] p-8 flex flex-col relative overflow-hidden min-h-[480px]">
        
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
              {/* Outbound tag */}
              {callState === 'idle' && (
                <div className="text-[10px] font-semibold tracking-wider text-zinc-600 uppercase mb-1">
                  Outbound Caller: {telnyxNumber || 'Not configured'}
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

              {/* Interactive display field */}
              <div className="relative w-full flex items-center justify-center px-2">
                <input
                  type="text"
                  value={formatPhoneNumber(phoneNumber)}
                  onChange={handleInputChange}
                  onPaste={handlePaste}
                  placeholder="Enter number"
                  disabled={callState !== 'idle'}
                  className="w-full bg-transparent border-none outline-none text-center text-2xl font-bold font-mono text-zinc-100 placeholder-zinc-800 tracking-wide select-all focus:ring-0 focus:outline-none"
                />
              </div>

              {/* Mute indicator banner */}
              {isMuted && callState === 'active' && (
                <span className="text-[9px] text-red-400 tracking-wider uppercase font-bold mt-1">
                  Microphone Muted
                </span>
              )}
            </div>

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
            <div className="grid grid-cols-3 gap-y-3.5 gap-x-5 justify-items-center py-2">
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
              </div>
            </div>

          </div>
        )}
      </div>

      {/* SOUND PAD PANEL (RIGHT) */}
      <div className="w-full bg-zinc-950/80 backdrop-blur-xl border border-zinc-900 shadow-2xl rounded-[2rem] p-6 flex flex-col min-h-[480px]">
        <div className="flex items-center justify-between mb-4 pb-2 border-b border-zinc-900">
          <div className="flex items-center gap-2">
            <Volume2 size={14} className="text-zinc-500" />
            <h2 className="text-xs font-bold tracking-wider uppercase text-zinc-400 select-none">Sound Pad</h2>
          </div>

          {/* Microphone Toggle on Soundboard */}
          <button 
            onClick={toggleSoundPadMic}
            className={`flex items-center gap-1 px-2.5 py-1.5 rounded-full border text-[9px] font-bold uppercase tracking-wider transition-all duration-200 active:scale-95 select-none ${
              isMicEnabled 
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20' 
                : 'bg-zinc-900 border-zinc-800 text-zinc-500 hover:bg-zinc-850 hover:text-zinc-400'
            }`}
            title={isMicEnabled ? "Mute mic channel" : "Unmute mic channel"}
          >
            {isMicEnabled ? <Mic size={10} /> : <MicOff size={10} />}
            <span>{isMicEnabled ? "Mic ON" : "Mic OFF"}</span>
          </button>
        </div>

        {/* Master volume slider */}
        <div className="mb-5 bg-zinc-900/20 border border-zinc-900 p-3.5 rounded-2xl flex flex-col gap-1.5 select-none">
          <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-zinc-500">
            <span>Pad Volume</span>
            <span>{Math.round(soundPadVolume * 100)}%</span>
          </div>
          <div className="flex items-center gap-2">
            {soundPadVolume === 0 ? <VolumeX size={13} className="text-zinc-600" /> : <Volume2 size={13} className="text-zinc-400" />}
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={soundPadVolume}
              onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
              className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-emerald-500 focus:outline-none"
            />
          </div>
        </div>

        {/* Sound Pad Slots */}
        <div className="flex-grow space-y-4 max-h-[350px] overflow-y-auto scrollbar-none">
          {[0, 1, 2].map((index) => (
            <div 
              key={index}
              className="p-3.5 rounded-2xl bg-zinc-900/10 border border-zinc-900/50 hover:border-zinc-800/40 transition-all flex flex-col gap-2 relative overflow-hidden"
            >
              {/* Invisible native audio tags for live call mixing */}
              <audio 
                ref={(el) => { slotAudiosRef.current[index] = el; }} 
                src={soundUrls[index] || undefined} 
                onEnded={() => {
                  setPlayingStates(prev => {
                    const updated = [...prev];
                    updated[index] = false;
                    return updated;
                  });
                }}
                className="hidden" 
              />

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 select-none">Slot {index + 1}</span>
                  <span className="text-[8px] font-bold px-1 py-0.5 rounded bg-zinc-950 border border-zinc-900 text-zinc-600 select-none">
                    {index === 0 ? 'Q' : index === 1 ? 'W' : 'E'}
                  </span>
                </div>
                {soundFiles[index] && (
                  <button 
                    onClick={() => removeSound(index)}
                    className="text-zinc-600 hover:text-red-400 transition-colors"
                    title="Unload file"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>

              {soundFiles[index] ? (
                /* FILE LOADED STATE */
                <div className="flex items-center justify-between gap-2.5">
                  <div className="text-left flex-grow min-w-0">
                    <p className="text-xs font-semibold text-zinc-300 truncate select-none">{soundFiles[index]?.name}</p>
                    <span className="text-[9px] text-zinc-600 select-none">
                      {soundFiles[index]?.size ? `${(soundFiles[index]!.size / (1024 * 1024)).toFixed(2)} MB` : 'Audio Clip'}
                    </span>
                  </div>
                  
                  <button 
                    onClick={() => togglePlaySound(index)}
                    className={`w-9 h-9 rounded-full flex items-center justify-center transition-all ${
                      playingStates[index] 
                        ? 'bg-emerald-500 text-black scale-105 shadow-md shadow-emerald-500/20' 
                        : 'bg-zinc-900 border border-zinc-850 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200'
                    }`}
                    title={playingStates[index] ? 'Pause' : 'Play'}
                  >
                    {playingStates[index] ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" className="ml-0.5" />}
                  </button>
                </div>
              ) : (
                /* EMPTY SLOT - UPLOAD TRIGGERS */
                <div className="flex items-center justify-center">
                  <label 
                    htmlFor={`sound-file-${index}`}
                    className="w-full border border-dashed border-zinc-900 hover:border-zinc-800 hover:bg-zinc-900/10 transition-all rounded-xl p-3.5 flex flex-col items-center gap-1.5 cursor-pointer text-zinc-500 hover:text-zinc-400 select-none"
                  >
                    <Upload size={14} className="animate-pulse" />
                    <span className="text-[10px] font-bold uppercase tracking-wider">Upload Sound</span>
                    <input 
                      id={`sound-file-${index}`}
                      type="file" 
                      accept="audio/*" 
                      onChange={(e) => handleSoundUpload(index, e)}
                      className="hidden" 
                    />
                  </label>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Dynamic native audio output for remote voice */}
      <audio ref={audioRef} id="remote-audio" autoPlay className="hidden" />

    </div>
  );
}
