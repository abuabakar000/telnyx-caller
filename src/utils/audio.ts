// DTMF dual-frequency mapping according to ITU-T standard
const DTMF_MAP: { [key: string]: [number, number] } = {
  '1': [697, 1209],
  '2': [697, 1336],
  '3': [697, 1477],
  '4': [770, 1209],
  '5': [770, 1336],
  '6': [770, 1477],
  '7': [852, 1209],
  '8': [852, 1336],
  '9': [852, 1477],
  '*': [941, 1209],
  '0': [941, 1336],
  '#': [941, 1477],
};

class AudioService {
  private ctx: AudioContext | null = null;
  private ringInterval: any = null;
  private currentRingOscillators: { osc1: OscillatorNode; osc2: OscillatorNode; gain: GainNode }[] = [];

  private initCtx() {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass) {
        this.ctx = new AudioContextClass();
      }
    }
    // Resume context if suspended (browser security autoplays)
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  // Play standard DTMF tone
  playDTMF(key: string, durationMs: number = 120) {
    const ctx = this.initCtx();
    if (!ctx) return;

    const freqs = DTMF_MAP[key];
    if (!freqs) return;

    try {
      const now = ctx.currentTime;
      const gainNode = ctx.createGain();
      gainNode.gain.setValueAtTime(0, now);
      gainNode.gain.linearRampToValueAtTime(0.08, now + 0.01); // smooth fade in
      gainNode.gain.setValueAtTime(0.08, now + (durationMs - 20) / 1000);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000); // fade out
      gainNode.connect(ctx.destination);

      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();

      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(freqs[0], now);
      osc1.connect(gainNode);

      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(freqs[1], now);
      osc2.connect(gainNode);

      osc1.start(now);
      osc2.start(now);

      osc1.stop(now + durationMs / 1000);
      osc2.stop(now + durationMs / 1000);
    } catch (e) {
      console.warn('Audio DTMF failed to play:', e);
    }
  }

  // Start double-beep ringback tone ("too too" standard telephone beep, repeats every 3.5s)
  startRingback() {
    this.stopRingback(); // Ensure no duplicates
    const ctx = this.initCtx();
    if (!ctx) return;

    const playRingCycle = () => {
      try {
        const now = ctx.currentTime;
        const gainNode = ctx.createGain();
        
        // Define gain envelope for "too too" double pulse
        gainNode.gain.setValueAtTime(0, now);
        
        // First beep (0.0s to 0.4s)
        gainNode.gain.linearRampToValueAtTime(0.06, now + 0.05);
        gainNode.gain.setValueAtTime(0.06, now + 0.35);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
        
        // Second beep (0.6s to 1.0s)
        gainNode.gain.setValueAtTime(0, now + 0.55);
        gainNode.gain.linearRampToValueAtTime(0.06, now + 0.6);
        gainNode.gain.setValueAtTime(0.06, now + 0.95);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 1.0);
        
        gainNode.connect(ctx.destination);

        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();

        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(400, now);
        osc1.connect(gainNode);

        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(450, now);
        osc2.connect(gainNode);

        // Start and stop both oscillators to match the double beep envelope
        osc1.start(now);
        osc2.start(now);

        osc1.stop(now + 1.0);
        osc2.stop(now + 1.0);

        this.currentRingOscillators.push({ osc1, osc2, gain: gainNode });
      } catch (e) {
        console.warn('Ringback cycle failed:', e);
      }
    };

    // Play immediately, then every 3.5 seconds
    playRingCycle();
    this.ringInterval = setInterval(playRingCycle, 3500);
  }

  stopRingback() {
    if (this.ringInterval) {
      clearInterval(this.ringInterval);
      this.ringInterval = null;
    }
    // Instantly disconnect any active ringing oscillators
    this.currentRingOscillators.forEach(({ osc1, osc2, gain }) => {
      try {
        osc1.stop();
        osc2.stop();
        gain.disconnect();
      } catch (e) {}
    });
    this.currentRingOscillators = [];
  }

  // Start electronic ringtone for inbound calls ("ring-ring" chime)
  startRingtone() {
    this.stopRingback(); // shares same interval & osc list
    const ctx = this.initCtx();
    if (!ctx) return;

    const playRingtoneCycle = () => {
      try {
        const now = ctx.currentTime;
        
        const playPulse = (startDelay: number) => {
          const t = now + startDelay;
          const gainNode = ctx.createGain();
          gainNode.gain.setValueAtTime(0, t);
          gainNode.gain.linearRampToValueAtTime(0.08, t + 0.05);
          gainNode.gain.setValueAtTime(0.08, t + 0.35);
          gainNode.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
          gainNode.connect(ctx.destination);

          const osc1 = ctx.createOscillator();
          const osc2 = ctx.createOscillator();

          osc1.type = 'triangle';
          osc1.frequency.setValueAtTime(600, t);
          osc1.connect(gainNode);

          osc2.type = 'sine';
          osc2.frequency.setValueAtTime(800, t);
          osc2.connect(gainNode);

          osc1.start(t);
          osc2.start(t);

          osc1.stop(t + 0.4);
          osc2.stop(t + 0.4);
          
          this.currentRingOscillators.push({ osc1, osc2, gain: gainNode });
        };

        // Ring-ring double chime
        playPulse(0);
        playPulse(0.5);
      } catch (e) {
        console.warn('Ringtone cycle failed:', e);
      }
    };

    playRingtoneCycle();
    this.ringInterval = setInterval(playRingtoneCycle, 3000);
  }

  stopRingtone() {
    this.stopRingback();
  }

  // Play connection successful chirp
  playCallSuccess() {
    const ctx = this.initCtx();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const gainNode = ctx.createGain();
      gainNode.gain.setValueAtTime(0, now);
      gainNode.gain.linearRampToValueAtTime(0.06, now + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
      gainNode.connect(ctx.destination);

      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(600, now);
      osc.frequency.exponentialRampToValueAtTime(1000, now + 0.15);
      osc.connect(gainNode);

      osc.start(now);
      osc.stop(now + 0.4);
    } catch (e) {}
  }

  // Play Call End triple tone (fast sequence)
  playCallEnd() {
    const ctx = this.initCtx();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      
      const playTone = (freq: number, startDelay: number, duration: number) => {
        const t = now + startDelay;
        const gainNode = ctx.createGain();
        gainNode.gain.setValueAtTime(0, t);
        gainNode.gain.linearRampToValueAtTime(0.06, t + 0.01);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, t + duration);
        gainNode.connect(ctx.destination);

        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, t);
        osc.connect(gainNode);

        osc.start(t);
        osc.stop(t + duration);
      };

      // Disconnect tones
      playTone(400, 0, 0.15);
      playTone(350, 0.15, 0.15);
      playTone(300, 0.3, 0.2);
    } catch (e) {}
  }

  // Play subtle SMS message chime (gentle ascending two-tone)
  playSmsChime() {
    const ctx = this.initCtx();
    if (!ctx) return;

    try {
      const now = ctx.currentTime;
      const playChimeNote = (freq: number, startDelay: number, duration: number) => {
        const t = now + startDelay;
        const gainNode = ctx.createGain();
        gainNode.gain.setValueAtTime(0, t);
        gainNode.gain.linearRampToValueAtTime(0.09, t + 0.015);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, t + duration);
        gainNode.connect(ctx.destination);

        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, t);
        osc.connect(gainNode);

        osc.start(t);
        osc.stop(t + duration);
      };

      // Gentle modern messenger two-tone (587.33Hz D5 -> 880Hz A5)
      playChimeNote(587.33, 0, 0.18);
      playChimeNote(880.00, 0.12, 0.28);
    } catch (e) {
      console.warn('SMS chime failed to play:', e);
    }
  }
}

export const audioService = new AudioService();
