"use client";

import { useState, useCallback, useRef } from "react";

const STORAGE_KEY = "lottery-sound-enabled";

/**
 * Hook for playing notification sounds using Web Audio API
 *
 * Features:
 * - Generates tones programmatically (no external audio files)
 * - Persists mute preference to localStorage
 * - WCAG compliant - sounds supplement visual feedback, never replace it
 * - Handles browser autoplay policies gracefully
 *
 * @returns Object with playSuccess, playError, isMuted, and toggleMute
 */
export function useNotificationSound() {
  // Initialize muted state from localStorage (default: not muted = sounds enabled)
  const [isMuted, setIsMuted] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    const stored = localStorage.getItem(STORAGE_KEY);
    // If stored value is "false", user disabled sounds (isMuted = true)
    // If no preference or "true", sounds are enabled (isMuted = false)
    return stored === "false";
  });

  // Keep a ref to AudioContext to reuse it
  const audioContextRef = useRef<AudioContext | null>(null);

  /**
   * Get or create AudioContext
   * Lazy initialization to comply with browser autoplay policies
   */
  const getAudioContext = useCallback((): AudioContext | null => {
    if (typeof window === "undefined") return null;

    if (!audioContextRef.current) {
      try {
        audioContextRef.current = new (
          window.AudioContext ||
          (
            window as typeof window & {
              webkitAudioContext?: typeof AudioContext;
            }
          ).webkitAudioContext
        )();
      } catch {
        console.warn("Web Audio API not supported");
        return null;
      }
    }

    // Resume if suspended (browser autoplay policy)
    if (audioContextRef.current.state === "suspended") {
      audioContextRef.current.resume();
    }

    return audioContextRef.current;
  }, []);

  /**
   * Play a tone with specified frequency and duration
   * Uses sine wave with envelope for smooth sound
   */
  const playTone = useCallback(
    (frequency: number, duration: number, type: OscillatorType = "sine") => {
      if (isMuted) return;

      const audioContext = getAudioContext();
      if (!audioContext) return;

      try {
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        oscillator.type = type;
        oscillator.frequency.setValueAtTime(
          frequency,
          audioContext.currentTime,
        );

        // Envelope for smooth attack and release (prevents clicking)
        const now = audioContext.currentTime;
        gainNode.gain.setValueAtTime(0, now);
        gainNode.gain.linearRampToValueAtTime(0.3, now + 0.01); // Quick attack
        gainNode.gain.exponentialRampToValueAtTime(0.01, now + duration); // Smooth decay

        oscillator.start(now);
        oscillator.stop(now + duration);
      } catch (error) {
        console.warn("Failed to play notification sound:", error);
      }
    },
    [isMuted, getAudioContext],
  );

  /**
   * Play success sound - higher pitch, pleasant chord
   * Used for successful bin scans and day close
   */
  const playSuccess = useCallback(() => {
    // Play two tones together as a chord for a rich "ding" sound
    playTone(880, 0.12, "sine"); // A5
    playTone(1100, 0.12, "sine"); // C#6 - plays simultaneously
  }, [playTone]);

  /**
   * Play error sound - dissonant chord for clear error signal
   * Used for validation errors, invalid serials, etc.
   */
  const playError = useCallback(() => {
    // Play two tones together - slight dissonance signals "wrong"
    playTone(300, 0.15, "square"); // Lower tone
    playTone(350, 0.15, "square"); // Slightly higher - creates buzzy dissonance
  }, [playTone]);

  /**
   * Toggle mute state and persist to localStorage
   * STORAGE_KEY stores "enabled" state, so we invert when saving
   */
  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const newMuted = !prev;
      if (typeof window !== "undefined") {
        // Store enabled state (opposite of muted)
        localStorage.setItem(STORAGE_KEY, newMuted ? "false" : "true");
      }
      return newMuted;
    });
  }, []);

  /**
   * Set mute state directly and persist to localStorage
   */
  const setMuted = useCallback((muted: boolean) => {
    setIsMuted(muted);
    if (typeof window !== "undefined") {
      // Store enabled state (opposite of muted)
      localStorage.setItem(STORAGE_KEY, muted ? "false" : "true");
    }
  }, []);

  return {
    playSuccess,
    playError,
    isMuted,
    toggleMute,
    setMuted,
  };
}
