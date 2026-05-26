/**
 * Effects index — registers all effects with the registry.
 * To add a new effect: import it here and add it to the map.
 */

import { effectRegistry } from '../effect-registry.js';
import { Trails } from './trails.js';
import { Connections } from './connections.js';
import { Spacetime } from './spacetime.js';
import { SincWaves } from './sincwaves.js';
import { Captions } from './captions.js';
import { Glow }        from './glow.js'; 

const EFFECTS = {
  trails: Trails,
  connections: Connections,
  spacetime: Spacetime,
  sincwaves: SincWaves,
  captions: Captions,
  glow: Glow
};

for (const [name, cls] of Object.entries(EFFECTS)) {
  effectRegistry.register(name, cls);
}

export { effectRegistry };