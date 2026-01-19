/**
 * Sequence Manager - Handles sequence-based video playback
 */
import { SequenceConfig } from './sequence-config.js';
import { SequencePlayer } from './sequence-player.js';
import { MediaPool } from './media-pool.js';
import { ParameterManager } from './parameter-manager.js';

export class SequenceManager {
  constructor(sceneManager, handManager, ballManager, parameterAnimator) {
    this.sceneManager = sceneManager;
    this.handManager = handManager;
    this.ballManager = ballManager;
    this.parameterAnimator = parameterAnimator;
    
    this.sequenceConfig = null;
    this.sequencePlayer = null;
    this.mediaPool = new MediaPool();
    this.parameterManager = new ParameterManager();
    this.isActive = false;
  }
  
  async loadSequence(config) {
    console.log('Loading sequence configuration...');
    
    this.sequenceConfig = new SequenceConfig();
    this.sequenceConfig.loadFromObject(config);
    
    this.sequencePlayer = new SequencePlayer(this.sequenceConfig);
    
    this.sequencePlayer.on('clipChange', async (event) => {
      await this.handleClipChange(event);
    });
    
    const objectIds = Object.keys(this.sequenceConfig.routing);
    this.parameterAnimator.registerSequence(this.sequenceConfig, objectIds);
    
    this.sequencePlayer.triggerInitialClips();
    
    this.isActive = true;
  }
  
  async handleClipChange(event) {
    const { objectId, clipData, nextClip } = event;
    
    const currentClipId = this.mediaPool.getAssignment(objectId);
    const newClipId = clipData.clipName;
    
    if (currentClipId === newClipId) return;
    
    const media = await this.mediaPool.assignClipToObject(objectId, newClipId, clipData.url);
    
    const objectType = objectId.includes('hand') ? 'hand' : 'ball';
    const objectName = objectId.replace('right_hand', 'right')
                              .replace('left_hand', 'left')
                              .replace('ball_', '');
    
    const manager = objectType === 'hand' ? this.handManager : this.ballManager;
    const timeOffset = clipData.startTime - clipData.videoStart;
    
    // Always dispose old object before creating new one
    // This ensures clean transitions between video <-> image
    if (objectType === 'ball') {
      manager.clearBall(objectName);
    } else {
      // For hands, would need a clearHand method
      console.warn('Hand clearing not implemented');
    }
    
    // Create new media object (auto-detects type from URL)
    if (objectType === 'ball') {
      const config = {
        startTime: clipData.videoStart,
        endTime: clipData.videoEnd,
        locked: false,
        zIndex: clipData.effects.zIndex || 0.1,
        scale: 1.0,  // Base scale - actual scale applied via applyParameters below
        timeOffset: timeOffset
      };
      
      // Unified method handles both images and videos
      await manager.displayBallMedia(objectName, media.src, config);
      
    } else if (objectType === 'hand') {
      // Hands still use old method (can be unified later)
      if (media.type === 'image') {
        console.warn(`Images not supported for hands yet`);
        return;
      }
      
      manager.displayHandVideo(
        objectName,
        media.src,
        clipData.videoStart,
        clipData.videoEnd,
        clipData.effects.zIndex || 0.1,
        timeOffset
      );
    }
    
    const mergedParams = { ...clipData.effects };
    
    // Set complete parameter set in ParameterManager
    this.parameterManager.setParameters(objectId, mergedParams);
    
    // Apply parameters immediately (for non-expression values and initial state)
    manager.applyParameters(objectName, mergedParams);
    
    if (nextClip) {
      this.mediaPool.preloadNext(objectId, nextClip);
    }
  }
  
  updateDynamicParameters() {
    if (!this.isActive || !this.parameterManager.hasExpressions()) return;
    
    this.sequencePlayer.update();
    
    const time = this.sequencePlayer.getCurrentTime();
    const updates = this.parameterManager.getAllUpdates(time);
    
    for (const update of updates) {
      const objectType = update.objectId.includes('hand') ? 'hand' : 'ball';
      const objectName = update.objectId.replace('right_hand', 'right')
                                      .replace('left_hand', 'left')
                                      .replace('ball_', '');
      
      const manager = objectType === 'hand' ? this.handManager : this.ballManager;
      
      // ParameterManager already returns COMPLETE parameter sets with evaluated expressions
      manager.applyParameters(objectName, update.params);
    }
  }
  
  updateParameters(config) {
    if (!this.isActive) return;
    
    console.log('[SequenceMgr] Updating parameters from new config');
    
    // Update the sequence config - this updates the presets that StreamPlayer references
    this.sequenceConfig.loadFromObject(config);
    
    // Get current playback position to determine which clip is active for each object
    const currentTime = this.sequencePlayer.getCurrentTime();
    
    // Get all object IDs from ParameterManager
    const objectIds = Object.keys(this.parameterManager.parameters);
    
    // Update parameters with new effects from the updated config
    for (const objectId of objectIds) {
      const assignment = this.sequencePlayer.objectAssignments.get(objectId);
      if (!assignment) continue;
      
      // getClipAtTime now resolves effects using current config presets
      const currentClip = assignment.streamPlayer.getClipAtTime(currentTime);
      if (!currentClip) continue;
      
      // Update ParameterManager with new effects
      this.parameterManager.setParameters(objectId, currentClip.effects);
    }
    
    // Apply the updated parameters
    for (const objectId of objectIds) {
      const objectType = objectId.includes('hand') ? 'hand' : 'ball';
      const objectName = objectId.replace('right_hand', 'right')
                                .replace('left_hand', 'left')
                                .replace('ball_', '');
      
      const manager = objectType === 'hand' ? this.handManager : this.ballManager;
      const params = this.parameterManager.getRawParameters(objectId);
      
      manager.applyParameters(objectName, params);
    }
    
    console.log('[SequenceMgr] Parameters updated successfully');
  }
  
  clear() {
    this.mediaPool.clear();
    this.parameterManager.clearAll();
    this.isActive = false;
    this.sequenceConfig = null;
    this.sequencePlayer = null;
  }
}