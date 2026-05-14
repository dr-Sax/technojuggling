/**
 * MidiController - Web MIDI API connection + raw message parsing.
 *
 * Connects to all available MIDI input devices, parses status bytes,
 * and forwards events to:
 *   - MidiState (for expression scope variables)
 *   - MidiEditorBridge (for joystick/CC/pad → editor actions)
 *
 * No driver install, no Python bridge — Chrome/Edge ship with Web MIDI.
 * Firefox needs flag (about:config → dom.webmidi.enabled).
 */

// MIDI status byte masks
const NOTE_OFF        = 0x80;
const NOTE_ON         = 0x90;
const POLY_AFTERTOUCH = 0xA0;
const CONTROL_CHANGE  = 0xB0;
const PROGRAM_CHANGE  = 0xC0;
const CHANNEL_PRESS   = 0xD0;
const PITCH_BEND      = 0xE0;

export class MidiController {
  /**
   * @param {MidiState} midiState - State store for expression scope
   * @param {MidiEditorBridge} [editorBridge] - Optional: routes events to editor actions
   */
  constructor(midiState, editorBridge = null) {
    this.midiState = midiState;
    this.editorBridge = editorBridge;
    this.access = null;
    this.inputs = new Map();   // input.id -> MIDIInput
    this.connected = false;
    this.lastEventLog = 0;     // throttle "unknown CC" logging
  }

  async initialize() {
    if (!navigator.requestMIDIAccess) {
      console.warn('Web MIDI API not available. Use Chrome/Edge or enable in Firefox about:config.');
      return false;
    }

    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
      this.connected = true;

      // Connect to all current inputs
      for (const input of this.access.inputs.values()) {
        this._attachInput(input);
      }

      // Watch for hotplug
      this.access.onstatechange = (e) => {
        if (e.port.type === 'input') {
          if (e.port.state === 'connected') {
            this._attachInput(e.port);
          } else if (e.port.state === 'disconnected') {
            this.inputs.delete(e.port.id);
            console.log(`MIDI input disconnected: ${e.port.name}`);
          }
        }
      };

      console.log(`✓ MIDI controller initialized — ${this.inputs.size} input(s) attached`);
      return true;
    } catch (error) {
      console.error('Failed to initialize MIDI:', error);
      return false;
    }
  }

  _attachInput(input) {
    if (this.inputs.has(input.id)) return;
    input.onmidimessage = (msg) => this._onMessage(msg);
    this.inputs.set(input.id, input);
    console.log(`✓ MIDI input attached: ${input.name} (${input.manufacturer || 'unknown'})`);
  }

  _onMessage(msg) {
    const [status, data1, data2] = msg.data;
    const command = status & 0xF0;
    const channel = status & 0x0F;

    switch (command) {
      case NOTE_ON: {
        // velocity 0 on Note On = Note Off (running status convention)
        if (data2 === 0) {
          this.midiState.setNoteOff(data1);
          this.editorBridge?.onNoteOff(data1, channel);
        } else {
          this.midiState.setNoteOn(data1, data2);
          this.editorBridge?.onNoteOn(data1, data2, channel);
        }
        break;
      }
      case NOTE_OFF: {
        this.midiState.setNoteOff(data1);
        this.editorBridge?.onNoteOff(data1, channel);
        break;
      }
      case CONTROL_CHANGE: {
        this.midiState.setCC(data1, data2);
        this.editorBridge?.onCC(data1, data2, channel);
        break;
      }
      case PITCH_BEND: {
        const value14 = (data2 << 7) | data1;
        this.midiState.setPitchBend(value14);
        this.editorBridge?.onPitchBend(this.midiState.pitchBend, channel);
        break;
      }
      case CHANNEL_PRESS: {
        this.midiState.setChannelPressure(data1);
        break;
      }
      case PROGRAM_CHANGE: {
        this.editorBridge?.onProgramChange(data1, channel);
        break;
      }
      // POLY_AFTERTOUCH and others: ignored for now
    }
  }

  /** Returns array of attached input names — useful for UI/debugging */
  getInputNames() {
    return Array.from(this.inputs.values()).map(i => i.name);
  }
}