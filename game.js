import { Player } from './player.js';
import { Platform } from './platform.js';
import { InputHandler } from './input.js';

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

canvas.width = 800;
canvas.height = 600;

const GRAVITY = 0.5;
const FRICTION = 0.8;

class Game {
    constructor() {
        this.player = new Player(100, 400);
        
        /* ...existing code... */
        this.gridSize = 32; 
        // true when this script is running with injected INITIAL_LEVEL_DATA (exported runtime)
        this.isExported = !!window.INITIAL_LEVEL_DATA; 
        this.isEditing = !window.INITIAL_LEVEL_DATA;
        this.currentTool = 'block'; 
        this.mouse = { x: 0, y: 0, isDown: false };
        this.won = false; // new: win state
        this.attempts = 0; // track number of deaths/attempts

        this.snapToGrid = true;
        this.updateGridOffsets();

        // Default spawn aligned to grid (will be overridden by INITIAL_LEVEL_DATA if present)
        const defaultSpawn = this.getGridCoords(100, 400);
        this.spawn = window.INITIAL_LEVEL_DATA && window.INITIAL_SPAWN
            ? { x: window.INITIAL_SPAWN.x, y: window.INITIAL_SPAWN.y }
            : { x: defaultSpawn.x, y: defaultSpawn.y };

        // Ensure ground aligns to grid: place default ground at canvas.height - gridSize
        const initialPlatforms = window.INITIAL_LEVEL_DATA
            ? window.INITIAL_LEVEL_DATA.map(p => new Platform(p.x, p.y, p.width, p.height, p.type, p.vx || 0, p.vy || 0, typeof p.collidable === 'undefined' ? true : p.collidable))
            : [new Platform(0, canvas.height - this.gridSize, canvas.width, this.gridSize)];
        // Room system: store rooms as array of { platforms, spawn }
        this.rooms = [];
        const initialSpawn = window.INITIAL_SPAWN ? { x: window.INITIAL_SPAWN.x, y: window.INITIAL_SPAWN.y } : defaultSpawn;
        this.rooms.push({ platforms: initialPlatforms, spawn: initialSpawn });
        this.currentRoom = 0;
        // active references used by existing logic
        this.platforms = this.rooms[this.currentRoom].platforms;
        this.spawn = this.rooms[this.currentRoom].spawn;
        
        // place player at spawn
        this.resetPlayerToSpawn();
        
        this.input = new InputHandler(); 
        this.keys = {};
        
        // History for undo/redo
        this.history = [];
        this.redoStack = [];
        // push initial state
        this.pushHistory();

        // particle system for death effect
        this.particles = [];

        // UI toggle states for placing moving blocks
        this.placeMoving = false;
        this.movingSpeed = 1;
        this.placeCollidable = true;
        this.collectedCount = 0;
        this.showCoinCounter = false;
        this.winCondition = 'flag'; // 'flag' | 'coins' | 'none'
        this.coinGoal = 1; // new: number of coins required to win
        this.switchOn = false; // shared switch state across all switches

        // Transition state for room changes (door)
        this.transitioning = false;
        this.transitionAlpha = 0;
        this.transitionTimer = 0;
        this.transitionDuration = 30; // frames for full fade-out then in
        this.transitionTargetRoom = null;

        // Hook UI buttons
        window.addEventListener('DOMContentLoaded', () => {
            const undoBtn = document.getElementById('undoBtn');
            const redoBtn = document.getElementById('redoBtn');
            const clearBtn = document.getElementById('clearBtn');
            const prevRoomBtn = document.getElementById('prevRoomBtn');
            const nextRoomBtn = document.getElementById('nextRoomBtn');
            const newRoomBtn = document.getElementById('newRoomBtn');
            const deleteRoomBtn = document.getElementById('deleteRoomBtn');
            const roomLabel = document.getElementById('roomLabel');
            const movingToggle = document.getElementById('movingToggle');
            const moveInc = document.getElementById('moveInc');
            const moveDec = document.getElementById('moveDec');
            const moveSpeedDisplay = document.getElementById('moveSpeed');
            const toolButtons = document.querySelectorAll('.tool-btn');
            const updateRoomLabel = () => {
                if (roomLabel) roomLabel.textContent = `Room ${this.currentRoom + 1} / ${this.rooms.length}`;
            };
            updateRoomLabel();
            if (prevRoomBtn) prevRoomBtn.addEventListener('click', () => { this.switchRoom(this.currentRoom - 1); updateRoomLabel(); });
            if (nextRoomBtn) nextRoomBtn.addEventListener('click', () => { this.switchRoom(this.currentRoom + 1); updateRoomLabel(); });
            if (newRoomBtn) newRoomBtn.addEventListener('click', () => { this.createRoom(); updateRoomLabel(); });
            if (deleteRoomBtn) deleteRoomBtn.addEventListener('click', () => { this.deleteRoom(); updateRoomLabel(); });
            toolButtons.forEach(b => b.addEventListener('click', (ev) => {
                this.currentTool = ev.currentTarget.getAttribute('data-tool') || 'block';
            }));
            if (undoBtn) undoBtn.addEventListener('click', () => this.undo());
            if (redoBtn) redoBtn.addEventListener('click', () => this.redo());
            if (clearBtn) clearBtn.addEventListener('click', () => this.clearLevel());
            if (movingToggle) movingToggle.addEventListener('change', (e) => {
                this.placeMoving = !!e.currentTarget.checked;
            });
            const movingCollidable = document.getElementById('movingCollidable');
            if (movingCollidable) movingCollidable.addEventListener('change', (e) => {
                this.placeCollidable = !!e.currentTarget.checked;
            });
            const showCoinCounter = document.getElementById('showCoinCounter');
            if (showCoinCounter) showCoinCounter.addEventListener('change', (e) => {
                this.showCoinCounter = !!e.currentTarget.checked;
            });
            if (winConditionSelect) {
                winConditionSelect.value = this.winCondition;
                winConditionSelect.addEventListener('change', (e) => {
                    this.winCondition = e.currentTarget.value || 'flag';
                    // show/hide coin goal input
                    const coinGoalInput = document.getElementById('coinGoalInput');
                    if (coinGoalInput) coinGoalInput.style.display = (this.winCondition === 'coins' || this.winCondition === 'both') ? 'inline-block' : 'none';
                });
            }
            if (moveInc) moveInc.addEventListener('click', () => { this.movingSpeed = Math.min(6, this.movingSpeed + 1); moveSpeedDisplay.textContent = this.movingSpeed; });
            if (moveDec) moveDec.addEventListener('click', () => { this.movingSpeed = Math.max(0, this.movingSpeed - 1); moveSpeedDisplay.textContent = this.movingSpeed; });
            const coinGoalInput = document.getElementById('coinGoalInput');
            if (coinGoalInput) {
                coinGoalInput.value = this.coinGoal;
                coinGoalInput.addEventListener('change', (e) => {
                    const v = parseInt(e.currentTarget.value) || 1;
                    this.coinGoal = Math.max(1, v);
                });
            }
            this.updateButtons();
        });

        this.setupEventListeners();
        this.gameLoop();
    }
    
    setupEventListeners() {
        window.addEventListener('keydown', (e) => {
            const key = e.key.toLowerCase();
            this.keys[key] = true;
            
            if (this.isEditing) {
                if (key === '1') this.currentTool = 'block';
                if (key === '2') this.currentTool = 'spike';
                if (key === '3') this.currentTool = 'jumppad';
                if (key === '4') this.currentTool = 'flag';
                if (key === '5') this.currentTool = 'collectible';
                if (key === '7') this.currentTool = 'switch';
                if (key === '8') this.currentTool = 'switchblock';
                if (key === '6') this.currentTool = 'door';
                if (key === 'e') this.currentTool = 'eraser';
                if (key === 'g') this.togglePlayMode(); // Toggle G for Game/Editor mode
                if (key === 'x') this.exportLevel(); // Export level
                if (key === 'z') { // <-- new: toggle snapping
                    this.snapToGrid = !this.snapToGrid;
                }
                if (key === 'p') { // set spawn at current cursor/grid location
                    const coords = this.getGridCoords(this.mouse.x, this.mouse.y);
                    // store spawn per-room so each room can have its own spawn point
                    if (this.rooms && this.rooms[this.currentRoom]) {
                        this.rooms[this.currentRoom].spawn = { x: coords.x, y: coords.y };
                        this.spawn = this.rooms[this.currentRoom].spawn;
                        this.pushHistory();
                    }
                 }
            } else {
                if (key === 'g') this.togglePlayMode(); // Toggle G for Game/Editor mode
            }
        });
        
        window.addEventListener('keyup', (e) => {
            this.keys[e.key.toLowerCase()] = false;
        });

        canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        canvas.addEventListener('mouseup', (e) => this.handleMouseUp(e));
    }

    handleMouseMove(e) {
        const rect = canvas.getBoundingClientRect();
        this.mouse.x = e.clientX - rect.left;
        this.mouse.y = e.clientY - rect.top;
    }

    handleMouseDown(e) {
        this.mouse.isDown = true;
        if (this.isEditing) {
            this.placeOrRemoveObject();
        }
    }

    handleMouseUp(e) {
        this.mouse.isDown = false;
    }

    updateGridOffsets() {
        // Compute offsets so the grid aligns to the canvas borders (last cell fits exactly)
        this.gridOffset = {
            x: canvas.width % this.gridSize ? canvas.width % this.gridSize : 0,
            y: canvas.height % this.gridSize ? canvas.height % this.gridSize : 0
        };
    }
    
    getGridCoords(x, y) {
        if (!this.snapToGrid) {
            // Free placement: anchor top-left to mouse (clamped to canvas bounds)
            const gx = Math.max(0, Math.min(canvas.width - this.gridSize, Math.round(x)));
            const gy = Math.max(0, Math.min(canvas.height - this.gridSize, Math.round(y)));
            return { x: gx, y: gy };
        }
        // Snap placement using offsets so grid aligns with borders
        const ox = this.gridOffset.x;
        const oy = this.gridOffset.y;
        const gx = Math.floor((x - ox) / this.gridSize) * this.gridSize + ox;
        const gy = Math.floor((y - oy) / this.gridSize) * this.gridSize + oy;
        return { x: gx, y: gy };
    }
    
    placeOrRemoveObject() {
        // When snapping is off, we already return top-left as mouse rounded; when on, grid coords used.
        const { x, y } = this.getGridCoords(this.mouse.x, this.mouse.y);
        const w = this.gridSize;
        const h = this.gridSize;
        
        // Ensure we are inside the canvas bounds
        if (x < 0 || y < 0 || x + w > canvas.width || y + h > canvas.height) return;

        // If eraser and snapping is OFF, remove any platform under the actual mouse position (free placement)
        if (this.currentTool === 'eraser' && !this.snapToGrid) {
            const mx = this.mouse.x, my = this.mouse.y;
            const idx = this.platforms.findIndex(p =>
                mx >= p.x && mx <= p.x + p.width &&
                my >= p.y && my <= p.y + p.height
            );
            if (idx !== -1) {
                this.platforms.splice(idx, 1);
                this.pushHistory();
            }
            return;
        }

        // Check if an object already exists at this location
        const existingIndex = this.platforms.findIndex(p => 
            p.x === x && p.y === y && p.width === w && p.height === h
        );

        if (this.currentTool === 'eraser') {
            if (existingIndex !== -1) {
                this.platforms.splice(existingIndex, 1);
                this.pushHistory();
            }
        } else {
            // If placing a new object, remove the existing one first if found
            if (existingIndex !== -1) {
                 if (this.platforms[existingIndex].type === this.currentTool) return;
                 this.platforms.splice(existingIndex, 1);
            }
            
            // Add new object
            // if placing moving is enabled, give initial horizontal velocity regardless of object type
            let vx = 0, vy = 0;
            if (this.placeMoving) vx = this.movingSpeed;
            this.platforms.push(new Platform(x, y, w, h, this.currentTool, vx, vy, !!this.placeCollidable));
            // If placing a switch, initialize it as ON and ensure global switch state reflects that
            if (this.currentTool === 'switch') {
                this.switchOn = true;
                const last = this.platforms[this.platforms.length - 1];
                if (last) last.on = true;
                for (let r of this.rooms) for (let sp of r.platforms) if (sp.type === 'switch') sp.on = true;
            }
            this.pushHistory();
        }
    }

    pushHistory() {
        // Serialize full rooms state (platforms + spawn) and current room index
        const snap = {
            rooms: this.rooms.map(r => ({
                platforms: r.platforms.map(p => ({ x: p.x, y: p.y, width: p.width, height: p.height, type: p.type, vx: p.vx || 0, vy: p.vy || 0, collidable: typeof p.collidable === 'undefined' ? true : p.collidable })),
                spawn: { x: r.spawn.x, y: r.spawn.y }
            })),
            currentRoom: this.currentRoom
        };
        this.history.push(snap);
        // cap history to avoid memory blowup
        if (this.history.length > 100) this.history.shift();
        // clear redo stack on new action
        this.redoStack = [];
        this.updateButtons();
    }

    undo() {
        if (this.history.length <= 1) return;
        const current = this.history.pop();
        this.redoStack.push(current);
        const prev = this.history[this.history.length - 1];
        // restore rooms and current room index
        this.rooms = prev.rooms.map(r => ({
            platforms: r.platforms.map(p => new Platform(p.x, p.y, p.width, p.height, p.type, p.vx || 0, p.vy || 0, typeof p.collidable === 'undefined' ? true : p.collidable)),
            spawn: { x: r.spawn.x, y: r.spawn.y }
        }));
        this.currentRoom = typeof prev.currentRoom === 'number' ? prev.currentRoom : 0;
        this.platforms = this.rooms[this.currentRoom].platforms;
        this.spawn = this.rooms[this.currentRoom].spawn;
        this.resetPlayerToSpawn();
        this.updateButtons();
    }

    redo() {
        if (this.redoStack.length === 0) return;
        const next = this.redoStack.pop();
        this.history.push(next);
        this.rooms = next.rooms.map(r => ({
            platforms: r.platforms.map(p => new Platform(p.x, p.y, p.width, p.height, p.type, p.vx || 0, p.vy || 0, typeof p.collidable === 'undefined' ? true : p.collidable)),
            spawn: { x: r.spawn.x, y: r.spawn.y }
        }));
        this.currentRoom = typeof next.currentRoom === 'number' ? next.currentRoom : 0;
        this.platforms = this.rooms[this.currentRoom].platforms;
        this.spawn = this.rooms[this.currentRoom].spawn;
        this.resetPlayerToSpawn();
        this.updateButtons();
    }

    clearLevel() {
        if (this.platforms.length === 0 && (!this.spawn || (this.spawn.x === 0 && this.spawn.y === 0))) return;
        // reset platforms but keep spawn at current grid origin
        // clear the current room's platforms only
        this.rooms[this.currentRoom].platforms = [];
        this.platforms = this.rooms[this.currentRoom].platforms;
        this.pushHistory();
    }

    updateButtons() {
        const undoBtn = document.getElementById('undoBtn');
        const redoBtn = document.getElementById('redoBtn');
        if (undoBtn) undoBtn.disabled = this.history.length <= 1;
        if (redoBtn) redoBtn.disabled = this.redoStack.length === 0;
    }

    togglePlayMode() {
        this.isEditing = !this.isEditing;
        
        // Reset player state when toggling modes
        this.resetPlayerToSpawn();
        // Reset all platforms back to their original placed positions when toggling modes
        for (let r of this.rooms) {
            for (let p of r.platforms) {
                if (typeof p.initialX !== 'undefined') {
                    p.x = p.initialX;
                    p.y = p.initialY;
                    // restore original movement direction/speed
                    if (typeof p.initialVx !== 'undefined') p.vx = p.initialVx;
                    if (typeof p.initialVy !== 'undefined') p.vy = p.initialVy;
                    // restore collected state on mode toggle (put collectibles back)
                    if (p.type === 'collectible') p.collected = false;
                }
            }
        }
        // Ensure shared switch state defaults to ON after playtesting/toggling and propagate to all switches
        this.switchOn = true;
        for (let r of this.rooms) {
            for (let sp of r.platforms) {
                if (sp.type === 'switch') sp.on = true;
            }
        }
    }
    
    createRoom() {
        // new empty room copies the grid-aligned spawn from current room
        const newSpawn = { x: this.spawn.x, y: this.spawn.y };
        const newPlatforms = [];
        this.rooms.push({ platforms: newPlatforms, spawn: newSpawn });
        this.switchRoom(this.rooms.length - 1);
        this.pushHistory();
    }

    deleteRoom() {
        if (this.rooms.length <= 1) return;
        this.rooms.splice(this.currentRoom, 1);
        const newIndex = Math.max(0, this.currentRoom - 1);
        this.switchRoom(newIndex);
        this.pushHistory();
    }

    switchRoom(index) {
        if (index < 0 || index >= this.rooms.length) return;
        this.currentRoom = index;
        // switch active references to preserve all existing logic
        this.platforms = this.rooms[this.currentRoom].platforms;
        this.spawn = this.rooms[this.currentRoom].spawn;
        this.resetPlayerToSpawn();
    }
    
    // initiate a fade transition to another room index
    startRoomTransition(targetIndex) {
        if (this.transitioning) return;
        this.transitioning = true;
        this.transitionTimer = 0;
        this.transitionAlpha = 0;
        this.transitionTargetRoom = targetIndex;
    }
    
    // internal helper to step transition each frame (called in update)
    stepTransition() {
        if (!this.transitioning) return;
        this.transitionTimer++;
        // first half fade out, second half fade in
        const half = Math.floor(this.transitionDuration / 2);
        if (this.transitionTimer <= half) {
            this.transitionAlpha = this.transitionTimer / half;
        } else {
            this.transitionAlpha = 1 - ((this.transitionTimer - half) / (this.transitionDuration - half));
        }
        // at halfway point perform the actual room switch once
        if (this.transitionTimer === half && typeof this.transitionTargetRoom === 'number') {
            this.switchRoom(this.transitionTargetRoom);
            // ensure player placed at spawn of new room
            this.resetPlayerToSpawn();
        }
        if (this.transitionTimer >= this.transitionDuration) {
            this.transitioning = false;
            this.transitionAlpha = 0;
            this.transitionTimer = 0;
            this.transitionTargetRoom = null;
        }
    }
    
    update() {
        if (this.isEditing) {
            // Continuous placement/erasure if mouse is held down
            if (this.mouse.isDown) {
                 this.placeOrRemoveObject();
            }
            // update particles in editor too (so they animate if spawned)
            this.updateParticles();
            // allow transition stepping while in editor (playtesting door transitions)
            this.stepTransition();
            return; 
        }
        
        // if a transition is active in play mode, step it (and while transitioning, freeze most updates)
        if (this.transitioning) {
            this.stepTransition();
            // while fading out/in we still want particles to update for polish
            this.updateParticles();
            // but otherwise pause gameplay physics while transition runs
            if (this.transitioning) return;
        }

        if (this.won) return; // stop updates after win

        // Handle input
        if (this.keys['arrowleft'] || this.keys['a']) {
            this.player.velocityX -= this.player.speed;
        }
        if (this.keys['arrowright'] || this.keys['d']) {
            this.player.velocityX += this.player.speed;
        }
        if ((this.keys[' '] || this.keys['arrowup'] || this.keys['w']) && this.player.onGround) {
            this.player.velocityY = -this.player.jumpPower;
            this.player.onGround = false;
        }
        
        // Apply physics
        this.player.velocityY += GRAVITY;
        this.player.velocityX *= FRICTION;
        
        // Update position
        this.player.x += this.player.velocityX;
        this.player.y += this.player.velocityY;
        
        // Check platform collisions
        this.player.onGround = false;
        
        // Move platforms that have velocities (simple horizontal bounce on canvas edges)
        for (let i = 0; i < this.platforms.length; i++) {
            const p = this.platforms[i];
            if ((p.vx && p.vx !== 0) || (p.vy && p.vy !== 0)) {
                const oldX = p.x, oldY = p.y;
                p.x += p.vx;
                p.y += p.vy;
                // bounce off canvas edges
                if (p.x < 0) { p.x = 0; p.vx *= -1; }
                if (p.x + p.width > canvas.width) { p.x = canvas.width - p.width; p.vx *= -1; }
                if (p.y < 0) { p.y = 0; p.vy *= -1; }
                if (p.y + p.height > canvas.height) { p.y = canvas.height - p.height; p.vy *= -1; }
                // collision with other platforms: if overlapping any non-self platform, revert and reverse velocity
                let collided = false;
                for (let j = 0; j < this.platforms.length; j++) {
                    if (i === j) continue;
                    const q = this.platforms[j];
                    // skip non-collidable platforms (explicit flag)
                    if (!q.collidable) continue;
                    // skip switchblocks/blueswitchblocks when they are currently non-collidable due to shared switch state
                    if ((q.type === 'switchblock' && !this.switchOn) || (q.type === 'blueswitchblock' && this.switchOn)) continue;
                    if (p.x < q.x + q.width && p.x + p.width > q.x &&
                        p.y < q.y + q.height && p.y + p.height > q.y) {
                        collided = true;
                        break;
                    }
                }
                if (collided) {
                    p.x = oldX;
                    p.y = oldY;
                    p.vx *= -1;
                    p.vy *= -1;
                }
            }
        }
        
        // Save previous Y position approximation
        const prevY = this.player.y - this.player.velocityY; 

        for (let platform of this.platforms) {
            // switchblock behavior: only act as collidable when shared switch state is ON
            // Red switchblock: collidable when switchOn === true
            // Blue switchblock: collidable when switchOn === false (i.e. skip collision when switchOn)
            if ((platform.type === 'switchblock' && !this.switchOn) || (platform.type === 'blueswitchblock' && this.switchOn)) continue;
            
            if (!platform.collidable) continue;
            if (this.checkCollision(this.player, platform)) {
                
                if (platform.type === 'spike') {
                    // Death condition -> spawn particles then respawn at grid-aligned spawn
                    this.spawnDeathParticles(this.player.x + this.player.width/2, this.player.y + this.player.height/2);
                    this.resetPlayerToSpawn(true);
                    return; 
                }
                
                // Win condition
                if (platform.type === 'flag') {
                    // Only trigger win for exported runtime; in the editor/play-testing inside the editor
                    // touching a flag should not end the editor session.
                    if (this.isExported) {
                        // exported runtime: touching the flag wins if configured for 'flag',
                        // or for 'both' only when required coins have been collected as well.
                        const winCfg = window.INITIAL_WIN_CONDITION || this.winCondition;
                        const coinGoal = (typeof window.INITIAL_COIN_GOAL === 'number') ? window.INITIAL_COIN_GOAL : (parseInt(window.INITIAL_COIN_GOAL) || this.coinGoal || 1);
                        const collected = this.platforms.filter(p => p.type === 'collectible' && p.collected).length;
                        if (winCfg === 'flag' || (winCfg === 'both' && collected >= coinGoal)) {
                            this.won = true;
                            this.player.x = platform.x;
                            this.player.y = platform.y - this.player.height;
                            this.player.velocityX = 0;
                            this.player.velocityY = 0;
                            return;
                        } else {
                            // flag is decorative unless conditions met
                            continue;
                        }
                    } else {
                        // In editor/playtesting runtime, allow win on touching the flag when editor is set to 'flag'
                        // or when set to 'both' AND the required coinGoal has been collected.
                        const collected = this.platforms.filter(p => p.type === 'collectible' && p.collected).length;
                        if (this.winCondition === 'flag' || (this.winCondition === 'both' && collected >= (this.coinGoal || 1))) {
                            this.won = true;
                            this.player.x = platform.x;
                            this.player.y = platform.y - this.player.height;
                            this.player.velocityX = 0;
                            this.player.velocityY = 0;
                            return;
                        } else {
                            // treat as decorative until conditions met
                            continue;
                        }
                    }
                    
                    // use aggregated collectible count across all rooms (editor or exported runtime)
                    // fallthrough continues if win triggered above
                }                
                
                // Door: move player to next room's spawn (editor/playtesting)
                if (platform.type === 'door') {
                    // only switch if there is another room
                    const nextIndex = Math.min(this.rooms.length - 1, this.currentRoom + 1);
                    if (nextIndex !== this.currentRoom && this.rooms[nextIndex]) {
                        // start a transition instead of instant switch
                        this.startRoomTransition(nextIndex);
                        return;
                    }
                    // if no next room, do nothing
                    continue;
                }
                
                // Collectible: pick up and remove immediately (only in play mode)
                if (platform.type === 'collectible') {
                    // mark as collected (do not remove) so we can restore on death/reset
                    if (!platform.collected) {
                        this.spawnDeathParticles(platform.x + platform.width/2, platform.y + platform.height/2, 10);
                        this.collectedCount = (this.collectedCount || 0) + 1;
                        platform.collected = true;
                    }
                    // ignore for collision resolution when collected
                    continue;
                }
                
                // If it's a solid object (block or jumppad) use robust AABB penetration resolution
                if (platform.type === 'block' || platform.type === 'jumppad' || platform.type === 'semisolid' || platform.type === 'switchblock' || platform.type === 'blueswitchblock') {
                    const overlapX1 = (this.player.x + this.player.width) - platform.x;
                    const overlapX2 = (platform.x + platform.width) - this.player.x;
                    const overlapY1 = (this.player.y + this.player.height) - platform.y;
                    const overlapY2 = (platform.y + platform.height) - this.player.y;
                    const overlapX = Math.min(overlapX1, overlapX2);
                    const overlapY = Math.min(overlapY1, overlapY2);
                    
                    // For semisolid: only collide when landing from above (previous bottom is <= platform.y)
                    if (platform.type === 'semisolid') {
                        const prevBottom = prevY + this.player.height;
                        if (prevBottom > platform.y + 1) {
                            // player was already intersecting from inside or below -> ignore collision
                            continue;
                        }
                        // only resolve if player's previous bottom was <= platform top (landing onto it)
                        if (prevBottom <= platform.y && overlapY <= overlapX) {
                            // allow normal vertical resolution below
                        } else if (prevBottom <= platform.y && overlapX < overlapY) {
                            // horizontal resolution (rare) still handled below
                        } else {
                            continue;
                        }
                    }
                    
                    if (overlapX < overlapY) {
                        // resolve horizontally
                        if (overlapX1 < overlapX2) {
                            this.player.x = platform.x - this.player.width;
                        } else {
                            this.player.x = platform.x + platform.width;
                        }
                        this.player.velocityX = 0;
                    } else {
                        // resolve vertically
                        if (overlapY1 < overlapY2) {
                            // landed on top
                            this.player.y = platform.y - this.player.height;
                            if (platform.type === 'jumppad') {
                                this.player.velocityY = -this.player.jumpPower * 1.2;
                                this.player.onGround = false;
                            } else {
                                this.player.velocityY = 0;
                                this.player.onGround = true;
                            }
                            // If platform is moving, move the player along with it
                            if (platform.vx) this.player.x += platform.vx;
                            if (platform.vy) this.player.y += platform.vy;
                        } else {
                            // hit from below
                            this.player.y = platform.y + platform.height;
                            this.player.velocityY = 0;
                        }
                    }
                }
                
                // Treat 'switch' like a solid block for collision resolution (same code path as block)
                else if (platform.type === 'switch') {
                    // reuse the same AABB resolution as 'block' above
                    const overlapX1 = (this.player.x + this.player.width) - platform.x;
                    const overlapX2 = (platform.x + platform.width) - this.player.x;
                    const overlapY1 = (this.player.y + this.player.height) - platform.y;
                    const overlapY2 = (platform.y + platform.height) - this.player.y;
                    const overlapX = Math.min(overlapX1, overlapX2);
                    const overlapY = Math.min(overlapY1, overlapY2);
                    
                    // If the player hit the switch from below (penetration from top of switch is smaller)
                    const hitFromBelow = overlapY2 < overlapY1 && overlapY2 <= overlapX;
                    if (hitFromBelow) {
                        // toggle the global shared switch state
                        this.switchOn = !this.switchOn;
                        // propagate state to all switch platforms across all rooms so visuals stay consistent
                        for (let r of this.rooms) {
                            for (let sp of r.platforms) {
                                if (sp.type === 'switch') sp.on = this.switchOn;
                            }
                        }
                    }
                    
                    if (overlapX < overlapY) {
                        if (overlapX1 < overlapX2) {
                            this.player.x = platform.x - this.player.width;
                        } else {
                            this.player.x = platform.x + platform.width;
                        }
                        this.player.velocityX = 0;
                    } else {
                        if (overlapY1 < overlapY2) {
                            this.player.y = platform.y - this.player.height;
                            this.player.velocityY = 0;
                            this.player.onGround = true;
                            if (platform.vx) this.player.x += platform.vx;
                            if (platform.vy) this.player.y += platform.vy;
                        } else {
                            this.player.y = platform.y + platform.height;
                            this.player.velocityY = 0;
                        }
                    }
                }
            }
        }
        
        // Keep player in bounds
        if (this.player.x < 0) {
            this.player.x = 0;
            this.player.velocityX = 0;
        }
        if (this.player.x + this.player.width > canvas.width) {
            this.player.x = canvas.width - this.player.width;
            this.player.velocityX = 0;
        }
        if (this.player.y > canvas.height) {
            // Reset player position if falls off screen
            this.spawnDeathParticles(this.player.x + this.player.width/2, canvas.height);
            this.resetPlayerToSpawn(true);
        }

        // after collision loop, check coins win condition in play mode for exported runtime
        if (this.isExported) {
            const winCond = window.INITIAL_WIN_CONDITION || this.winCondition;
            const coinGoal = (typeof window.INITIAL_COIN_GOAL === 'number') ? window.INITIAL_COIN_GOAL : (parseInt(window.INITIAL_COIN_GOAL) || this.coinGoal || 1);
            // Only auto-win on coins when win condition is explicitly "coins".
            // Aggregate collectible state across all rooms so counter is consistent across rooms.
            if (winCond === 'coins') {
                const allPlatforms = (this.rooms || []).reduce((acc, r) => acc.concat(r.platforms || []), []);
                const collected = allPlatforms.filter(p => p.type === 'collectible' && p.collected).length;
                if (collected >= coinGoal) {
                    this.won = true;
                }
            }
        } else {
            // in editor playtesting, also allow coins win if editor selected that mode
            // Only auto-win on coins in editor when explicitly set to "coins"
            if (!this.isExported && this.winCondition === 'coins') {
                const allPlatforms = (this.rooms || []).reduce((acc, r) => acc.concat(r.platforms || []), []);
                const collected = allPlatforms.filter(p => p.type === 'collectible' && p.collected).length;
                if (collected >= (this.coinGoal || 1)) {
                    this.won = true;
                }
            }
        }

        // update particles each frame
        this.updateParticles();
    }
    
    checkCollision(rect1, rect2) {
        return rect1.x < rect2.x + rect2.width &&
               rect1.x + rect1.width > rect2.x &&
               rect1.y < rect2.y + rect2.height &&
               rect1.y + rect1.height > rect2.y;
    }
    
    draw() {
        // Clear canvas
        ctx.fillStyle = '#000'; // Black background
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#FFF'; // White outline color
        
        // Draw platforms
        for (let platform of this.platforms) {
            
            // For spikes we want a transparent background (no filled rect)
            // Do not draw a full filled/stroked rect for spikes or semisolids; they have special visuals
            if (platform.type === 'spike' || platform.type === 'semisolid' || platform.type === 'collectible' || platform.type === 'switchblock' || platform.type === 'blueswitchblock') {
                // no stroked/filled rect for spikes, semisolids, or collectibles — they have special visuals
            } else {
                ctx.fillStyle = platform.type === 'jumppad' ? '#AAA' : '#FFF';
                ctx.fillRect(platform.x, platform.y, platform.width, platform.height);
                // removed stroke for regular blocks — only switches draw borders
            }

            // Draw Spike visual cue
            if (platform.type === 'spike') {
                // draw a single white triangle spanning the platform
                ctx.fillStyle = '#FFF';
                ctx.beginPath();
                ctx.moveTo(platform.x + platform.width / 2, platform.y);
                ctx.lineTo(platform.x, platform.y + platform.height);
                ctx.lineTo(platform.x + platform.width, platform.y + platform.height);
                ctx.closePath();
                ctx.fill();
            }
             
            // Draw Jumppad visual cue
            if (platform.type === 'jumppad') {
                 ctx.fillStyle = '#000'; 
                 const midX = platform.x + platform.width/2;
                 const topY = platform.y + platform.height * 0.2;
                 const midY = platform.y + platform.height * 0.7;
                 
                 ctx.fillRect(midX - 2, topY, 4, midY - topY); 
                 ctx.beginPath();
                 ctx.moveTo(midX, topY);
                 ctx.lineTo(midX - platform.width/4, topY + platform.height/4);
                 ctx.lineTo(midX + platform.width/4, topY + platform.height/4);
                 ctx.closePath();
                 ctx.fill();
            }

            // Draw Semisolid visual cue: half-height white filled block (top half transparent)
            if (platform.type === 'semisolid') {
                ctx.fillStyle = '#FFF';
                const hh = Math.floor(platform.height / 2);
                // draw the top half filled white, leave bottom transparent and do not stroke
                ctx.fillRect(platform.x, platform.y, platform.width, hh);
            }
            
            // Draw Flag visual as a yellow dot (editor runtime)
            if (platform.type === 'flag') {
                const cx = platform.x + platform.width/2;
                const cy = platform.y + platform.height/2;
                ctx.fillStyle = '#FFD400';
                ctx.beginPath();
                ctx.arc(cx, cy, Math.min(platform.width, platform.height) * 0.22, 0, Math.PI * 2);
                ctx.fill();
            }

            // Draw Door visual: slim tall rectangle with dark fill and light outline (match editor)
            if (platform.type === 'door') {
                ctx.fillStyle = '#222'; // dark interior
                ctx.fillRect(platform.x + platform.width*0.15, platform.y + platform.height*0.05, platform.width*0.7, platform.height*0.9);
                ctx.lineWidth = 2;
                ctx.strokeStyle = '#AAA';
                ctx.strokeRect(platform.x + platform.width*0.15, platform.y + platform.height*0.05, platform.width*0.7, platform.height*0.9);
            }

            // Draw Switch visual: render like a block but border color indicates shared state (red = on, blue = off)
            if (platform.type === 'switch') {
                ctx.fillStyle = '#FFF';
                ctx.fillRect(platform.x, platform.y, platform.width, platform.height);
                ctx.lineWidth = 3;
                // use shared state; prefer per-platform cached 'on' if present to remain consistent after history changes
                const onState = (typeof platform.on === 'boolean') ? platform.on : this.switchOn;
                ctx.strokeStyle = onState ? '#F00' : '#00F';
                ctx.strokeRect(platform.x, platform.y, platform.width, platform.height);
            }

            // Draw Switch Block visual: looks like a block but shows soft border when OFF
            if (platform.type === 'switchblock') {
                const onState = (typeof platform.on === 'boolean') ? platform.on : this.switchOn;
                if (onState) {
                    // ON: red fill, white solid border
                    ctx.fillStyle = '#F00';
                    ctx.fillRect(platform.x, platform.y, platform.width, platform.height);
                    ctx.lineWidth = 3;
                    ctx.strokeStyle = '#FFF';
                    ctx.setLineDash([]);
                    ctx.strokeRect(platform.x, platform.y, platform.width, platform.height);
                } else {
                    // OFF: transparent interior, dotted red border
                    ctx.clearRect(platform.x, platform.y, platform.width, platform.height);
                    ctx.lineWidth = 2;
                    ctx.strokeStyle = '#F00';
                    ctx.setLineDash([4, 4]);
                    ctx.strokeRect(platform.x + 0.5, platform.y + 0.5, platform.width - 1, platform.height - 1);
                    ctx.setLineDash([]);
                }
            }

            // Draw Blue Switch Block visual: collidable when switch is OFF (blue solid), transparent dotted when ON
            if (platform.type === 'blueswitchblock') {
                const onState = (typeof platform.on === 'boolean') ? platform.on : this.switchOn;
                if (!onState) { // switch is OFF => blue solid (collidable)
                    ctx.fillStyle = '#1E90FF';
                    ctx.fillRect(platform.x, platform.y, platform.width, platform.height);
                    ctx.lineWidth = 3;
                    ctx.strokeStyle = '#FFF';
                    ctx.setLineDash([]);
                    ctx.strokeRect(platform.x, platform.y, platform.width, platform.height);
                } else { // switch is ON => transparent dotted blue border (non-collidable)
                    ctx.clearRect(platform.x, platform.y, platform.width, platform.height);
                    ctx.lineWidth = 2;
                    ctx.strokeStyle = '#1E90FF';
                    ctx.setLineDash([4, 4]);
                    ctx.strokeRect(platform.x + 0.5, platform.y + 0.5, platform.width - 1, platform.height - 1);
                    ctx.setLineDash([]);
                }
            }

            // Draw Collectible visual: small cyan circle centered in the cell
            if (platform.type === 'collectible' && !platform.collected) {
                const cx = platform.x + platform.width/2;
                const cy = platform.y + platform.height/2;
                // borderless filled collectible: no cell fill/background, just a filled cyan dot
                ctx.fillStyle = '#00FFFF';
                ctx.beginPath();
                ctx.arc(cx, cy, Math.min(platform.width, platform.height) * 0.28, 0, Math.PI * 2);
                ctx.fill();
                // add white border
                ctx.lineWidth = 2;
                ctx.strokeStyle = '#FFF';
                ctx.stroke();
            }
            
            // If platform has velocity, draw a subtle blue border to indicate movement
            if ((platform.vx && platform.vx !== 0) || (platform.vy && platform.vy !== 0)) {
                ctx.save();
                ctx.strokeStyle = '#1E90FF'; // DodgerBlue
                ctx.lineWidth = 2;
                ctx.strokeRect(platform.x + 1, platform.y + 1, platform.width - 2, platform.height - 2);
                ctx.restore();
            }

            // Draw Flag visual as a yellow dot (editor runtime)
            if (platform.type === 'flag') {
                const cx = platform.x + platform.width/2;
                const cy = platform.y + platform.height/2;
                ctx.fillStyle = '#FFD400';
                ctx.beginPath();
                ctx.arc(cx, cy, Math.min(platform.width, platform.height) * 0.22, 0, Math.PI * 2);
                ctx.fill();
            }
        }
        
        // Draw player
        ctx.fillStyle = '#FFF'; // White fill
        ctx.fillRect(this.player.x, this.player.y, this.player.width, this.player.height);
        // (no outline for player)

        // Draw particles on top
        if (this.particles.length > 0) {
            for (let p of this.particles) {
                ctx.globalAlpha = Math.max(0, p.alpha);
                ctx.fillStyle = '#FFF';
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 1;
        }

        // Draw coin counter (if enabled)
        if (this.showCoinCounter) {
            // aggregate across all rooms so the counter is consistent between rooms
            const allPlatforms = this.rooms.reduce((acc, r) => acc.concat(r.platforms || []), []);
            const total = allPlatforms.filter(p => p.type === 'collectible').length;
            const collected = allPlatforms.filter(p => p.type === 'collectible' && p.collected).length;
            ctx.fillStyle = 'rgba(0,0,0,0.6)';
            ctx.fillRect(12, 12, 140, 36);
            ctx.fillStyle = '#FFF';
            ctx.font = '14px "Noto Sans", Arial';
            ctx.textAlign = 'left';
            ctx.fillText(`Coins: ${collected} / ${total}`, 20, 36);
        }

        // Draw Editor UI
        if (this.isEditing) {
            this.drawEditorOverlay();
            // draw spawn marker
            this.drawSpawnMarker();
        }
        // In editor/play mode if collectibles are marked collected, still hide them visually (only active in play)

        // Win overlay
        if (this.won) {
            ctx.fillStyle = 'rgba(0,0,0,0.6)';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#FFF';
            ctx.font = '28px "Noto Sans", Arial';
            ctx.textAlign = 'center';
            ctx.fillText('You Win!', canvas.width/2, canvas.height/2);
            ctx.font = '16px "Noto Sans", Arial';
            ctx.fillText('Attempts: ' + this.attempts, canvas.width/2, canvas.height/2 + 36);
            return;
        }

        // Draw room transition overlay (fade to black)
        if (this.transitioning || this.transitionAlpha > 0) {
            ctx.fillStyle = `rgba(0,0,0,${Math.max(0, Math.min(1, this.transitionAlpha))})`;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
    }
    
    drawEditorOverlay() {
        // Draw grid only when snapping is enabled
        if (this.snapToGrid) {
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
            ctx.lineWidth = 1;
            const ox = this.gridOffset.x;
            const oy = this.gridOffset.y;
            for (let x = ox; x < canvas.width; x += this.gridSize) {
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, canvas.height);
                ctx.stroke();
            }
            for (let y = oy; y < canvas.height; y += this.gridSize) {
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(canvas.width, y);
                ctx.stroke();
            }
        }

        // Draw tool cursor preview
        const { x: gx, y: gy } = this.getGridCoords(this.mouse.x, this.mouse.y);
        const w = this.gridSize;
        const h = this.gridSize;

        let fillStyle;
        let strokeStyle = '#FFF';

        if (this.currentTool === 'eraser') {
            fillStyle = 'rgba(255, 0, 0, 0.4)';
            strokeStyle = '#F00';
        } else if (this.currentTool === 'block') {
            fillStyle = 'rgba(255, 255, 255, 0.4)';
        } else if (this.currentTool === 'spike') {
             fillStyle = 'rgba(255, 255, 255, 0.4)'; 
        } else if (this.currentTool === 'jumppad') {
            fillStyle = 'rgba(204, 204, 204, 0.4)'; 
        } else if (this.currentTool === 'flag') {
             // flag preview handled separately
             // flag preview: yellow dot
             const cx = gx + w/2;
             const cy = gy + h/2;
             ctx.fillStyle = '#FFD400';
             ctx.beginPath();
             ctx.arc(cx, cy, Math.min(w, h) * 0.22, 0, Math.PI * 2);
             ctx.fill();
        } else if (this.currentTool === 'switch') {
            // switch preview: render same as a block (solid)
            fillStyle = 'rgba(255, 255, 255, 0.35)';
            strokeStyle = '#DDD';
        } else if (this.currentTool === 'semisolid') {
            // semisolid preview: draw the TOP half as semi-transparent white, no border
            ctx.fillStyle = 'rgba(255,255,255,0.5)';
            ctx.fillRect(gx, gy, w, Math.floor(h/2));
        }
        else if (this.currentTool === 'switchblock') {
            // preview should reflect current shared switch state
            const onState = this.switchOn;
            if (onState) {
                fillStyle = 'rgba(255,0,0,0.9)';
                strokeStyle = '#FFF';
            } else {
                fillStyle = 'rgba(255,0,0,0)'; // transparent
                strokeStyle = '#F00';
            }
        }
        else if (this.currentTool === 'blueswitchblock') {
            // blue switch block preview is inverse: solid blue when switch OFF, transparent dotted when ON
            const onState = this.switchOn;
            if (!onState) {
                fillStyle = 'rgba(30,144,255,0.9)';
                strokeStyle = '#FFF';
            } else {
                fillStyle = 'rgba(30,144,255,0)'; // transparent
                strokeStyle = '#1E90FF';
            }
        }

        ctx.fillStyle = fillStyle;
        ctx.strokeStyle = strokeStyle;
        ctx.lineWidth = 2;
        // draw full-cell preview where relevant (semisolid already drawn above)
        if (this.currentTool !== 'semisolid' && this.currentTool !== 'collectible') ctx.fillRect(gx, gy, w, h);
        // don't draw a border for spike, semisolid, or collectible preview to keep those cells borderless
        if (this.currentTool !== 'spike' && this.currentTool !== 'semisolid' && this.currentTool !== 'collectible') {
            if (this.currentTool === 'switchblock' && !this.switchOn) {
                ctx.setLineDash([4,4]);
                ctx.strokeRect(gx, gy, w, h);
                ctx.setLineDash([]);
            } else {
                ctx.strokeRect(gx, gy, w, h);
            }
        }
        
        // Add current tool visual cue inside the preview square
        if (this.currentTool === 'spike') {
            // preview: single white triangle in the cell
            ctx.fillStyle = '#FFF';
            ctx.beginPath();
            ctx.moveTo(gx + w / 2, gy);
            ctx.lineTo(gx, gy + h);
            ctx.lineTo(gx + w, gy + h);
            ctx.closePath();
            ctx.fill();
        } else if (this.currentTool === 'jumppad') {
             ctx.fillStyle = '#000'; 
             const midX = gx + w/2;
             const topY = gy + h * 0.2;
             const midY = gy + h * 0.7;
             
             ctx.fillRect(midX - 2, topY, 4, midY - topY); 
             ctx.beginPath();
             ctx.moveTo(midX, topY);
             ctx.lineTo(midX - w/4, topY + h/4);
             ctx.lineTo(midX + w/4, topY + h/4);
             ctx.closePath();
             ctx.fill();
        }
        else if (this.currentTool === 'collectible') {
            const cx = gx + w/2;
            const cy = gy + h/2;
            // preview as borderless filled cyan dot (no cell background)
            ctx.fillStyle = '#00FFFF';
            ctx.beginPath();
            ctx.arc(cx, cy, Math.min(w, h) * 0.28, 0, Math.PI * 2);
            ctx.fill();
            // white outline for preview
            ctx.lineWidth = 2;
            ctx.strokeStyle = '#FFF';
            ctx.stroke();
        }
        else if (this.currentTool === 'door') {
            // door preview: slim dark rectangle with light border centered in cell
            ctx.fillStyle = 'rgba(34,34,34,0.9)';
            ctx.fillRect(gx + w*0.15, gy + h*0.05, w*0.7, h*0.9);
            ctx.lineWidth = 2;
            ctx.strokeStyle = '#AAA';
            ctx.strokeRect(gx + w*0.15, gy + h*0.05, w*0.7, h*0.9);
        }

        // HUD moved to HTML instructions panel (left). Canvas HUD text removed for clarity.
    }

    drawSpawnMarker() {
        // Draw a simple green circle spawn marker centered in the spawn cell
        const s = this.spawn;
        const w = this.gridSize;
        const h = this.gridSize;
        const cx = s.x + w / 2;
        const cy = s.y + h / 2;
        const radius = Math.min(w, h) * 0.28;
        ctx.fillStyle = '#0F0';
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fill();
    }

    resetPlayerToSpawn(death = false) {
        if (death) this.attempts++;
        // place player at spawn (top-left of the player aligned to spawn cell)
        // ensure spawn is the active room's spawn
        if (this.rooms && this.rooms[this.currentRoom]) this.spawn = this.rooms[this.currentRoom].spawn;
        this.player.x = this.spawn.x;
        this.player.y = this.spawn.y - (this.player.height - this.gridSize); // align player bottom to top of spawn cell if needed
        // ensure player stays in bounds
        this.player.x = Math.max(0, Math.min(canvas.width - this.player.width, this.player.x));
        this.player.y = Math.max(0, Math.min(canvas.height - this.player.height, this.player.y));
        this.player.velocityX = 0;
        this.player.velocityY = 0;
        this.player.onGround = false;
        // On death, also reset moving platforms back to their original position and direction
        if (death) {
            for (let r of this.rooms) {
                for (let p of r.platforms) {
                    if (typeof p.initialX !== 'undefined') {
                        p.x = p.initialX;
                        p.y = p.initialY;
                        if (typeof p.initialVx !== 'undefined') p.vx = p.initialVx;
                        if (typeof p.initialVy !== 'undefined') p.vy = p.initialVy;
                        // restore collected collectibles on death
                        if (p.type === 'collectible') p.collected = false;
                    }
                }
            }
            // Ensure shared switch state defaults to ON after death and propagate to all switch platforms
            this.switchOn = true;
            for (let r of this.rooms) {
                for (let sp of r.platforms) {
                    if (sp.type === 'switch') sp.on = true;
                }
            }
        }
        // optional small flash / particle burst on death handled elsewhere; when toggling modes/undo shouldn't show effect
        // Do not spawn particles at the spawn point — death particles are emitted at the death location instead.
    }
    
    spawnDeathParticles(cx, cy, count = 16) {
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 1.5 + Math.random() * 2.5;
            this.particles.push({
                x: cx,
                y: cy,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed - 1.0, // slightly upward bias
                life: 40 + Math.floor(Math.random() * 20),
                age: 0,
                size: 2 + Math.random() * 3,
                alpha: 1
            });
        }
    }

    updateParticles() {
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.vy += GRAVITY * 0.06; // lightweight gravity
            p.x += p.vx;
            p.y += p.vy;
            p.age++;
            p.alpha = 1 - p.age / p.life;
            if (p.age >= p.life) this.particles.splice(i, 1);
        }
    }
    
    // Export Level implementation
    exportLevel() {
        // Export full rooms array
        const exportedRooms = this.rooms.map(r => ({
            platforms: r.platforms.map(p => ({ x: p.x, y: p.y, width: p.width, height: p.height, type: p.type, vx: p.vx || 0, vy: p.vy || 0, collidable: typeof p.collidable === 'undefined' ? true : p.collidable })),
            spawn: { x: r.spawn.x, y: r.spawn.y }
        }));
        
        const levelDataJson = JSON.stringify(exportedRooms, null, 2);
        const spawnJson = JSON.stringify(this.rooms[this.currentRoom].spawn);
        const showCoinCounterJson = JSON.stringify(!!this.showCoinCounter);
        const winConditionJson = JSON.stringify(this.winCondition || 'flag');
        const coinGoalJson = JSON.stringify(this.coinGoal || 1);

        // NOTE: runtime injection expects INITIAL_LEVEL_DATA shaped as array of rooms
        // --- Start Runtime Game Code Definition ---
        const runtimeGameContent = `const GRAVITY = 0.5;
const FRICTION = 0.8;
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
canvas.width = 800;
canvas.height = 600;
const SHOW_COIN_COUNTER = !!window.INITIAL_SHOW_COIN_COUNTER;
const WIN_CONDITION = window.INITIAL_WIN_CONDITION || 'flag';
const COIN_GOAL = (typeof window.INITIAL_COIN_GOAL === 'number') ? window.INITIAL_COIN_GOAL : (parseInt(window.INITIAL_COIN_GOAL) || 1);

class Platform {
    constructor(x, y, width, height, type = 'block', vx = 0, vy = 0, collidable = true) {
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
        this.type = type; 
        this.vx = vx;
        this.vy = vy;
        this.collidable = collidable;
        this.initialX = x;
        this.initialY = y;
        this.initialVx = vx;
        this.initialVy = vy;
        // track collected state so exported runtime can hide/restore collectibles
        this.collected = false;
    }
}

class InputHandler {
    constructor() {
        this.keys = {};
        window.addEventListener('keydown', (e) => {
            this.keys[e.key.toLowerCase()] = true;
        });
        window.addEventListener('keyup', (e) => {
            this.keys[e.key.toLowerCase()] = false;
        });
    }
    isPressed(key) {
        return this.keys[key.toLowerCase()] || false;
    }
}

class Player {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.width = 32;
        this.height = 32;
        this.velocityX = 0;
        this.velocityY = 0;
        this.speed = 0.9;
        this.jumpPower = 10;
        this.onGround = false;
        this.alpha = 1; // fade value for exported win fade-out
    }
}


class Game {
    constructor() {
        // transition state for exported runtime room changes
        this.transitioning = false;
        this.transitionTimer = 0;
        this.transitionDuration = 30;
        this.transitionAlpha = 0;
        this.transitionTargetRoom = null;
        
        // support multiple rooms: window.INITIAL_LEVEL_DATA is expected to be an array of rooms { platforms: [...], spawn: {x,y} }
        window.__rooms = window.INITIAL_LEVEL_DATA || window.__rooms || [];
        window.__currentRoom = (typeof window.__currentRoom === 'number') ? window.__currentRoom : 0;
        const room = (window.__rooms && window.__rooms[window.__currentRoom]) || { platforms: [], spawn: { x: 0, y: 0 } };
        this.player = new Player(room.spawn.x, room.spawn.y);
        this.platforms = (room.platforms || []).map(p => new Platform(p.x, p.y, p.width, p.height, p.type, p.vx || 0, p.vy || 0, typeof p.collidable === 'undefined' ? true : p.collidable));
        this.input = new InputHandler();
        this.keys = {};
        this.attempts = 0;
        this.won = false;
        // particle system
        this.particles = [];
        this.spawn = { x: room.spawn.x, y: room.spawn.y };
        this.showCoinCounter = SHOW_COIN_COUNTER;
        // shared switch state for exported runtime
        // default to ON for exported runtime when not previously set
        window.__switchOn = (typeof window.__switchOn === 'boolean') ? window.__switchOn : true;
        
        this.setupEventListeners();
        this.gameLoop();
    }
    
    setupEventListeners() {
        window.addEventListener('keydown', (e) => {
            this.keys[e.key.toLowerCase()] = true;
        });
        
        window.addEventListener('keyup', (e) => {
            this.keys[e.key.toLowerCase()] = false;
        });
    }
    
    spawnDeathParticles(cx, cy, count = 16) {
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = 1.5 + Math.random() * 2.5;
            this.particles.push({
                x: cx,
                y: cy,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed - 1.0,
                life: 40 + Math.floor(Math.random() * 20),
                age: 0,
                size: 2 + Math.random() * 3,
                alpha: 1
            });
        }
    }
    
    updateParticles() {
        const GR = GRAVITY;
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.vy += GR * 0.06;
            p.x += p.vx;
            p.y += p.vy;
            p.age++;
            p.alpha = 1 - p.age / p.life;
            if (p.age >= p.life) this.particles.splice(i, 1);
        }
    }
    
    resetPlayerToSpawnDeath() {
        this.player.x = this.spawn.x;
        this.player.y = this.spawn.y - (this.player.height - 32);
        this.player.velocityX = 0;
        this.player.velocityY = 0;
        this.player.onGround = false;
        // reset moving platforms to their original positions on respawn
        for (let p of this.platforms) {
            if (typeof p.initialX !== 'undefined') {
                p.x = p.initialX;
                p.y = p.initialY;
                if (typeof p.initialVx !== 'undefined') p.vx = p.initialVx;
                if (typeof p.initialVy !== 'undefined') p.vy = p.initialVy;
                // restore collected collectibles on respawn so they reappear after death/playtesting
                if (p.type === 'collectible') p.collected = false;
            }
        }
        // Ensure shared switch state defaults to ON after death in exported runtime and propagate to all rooms/platform lists
        window.__switchOn = true;
        for (let p of this.platforms) if (p.type === 'switch') p.on = true;
        if (window.__rooms) {
            for (let r of window.__rooms) {
                if (!r || !Array.isArray(r.platforms)) continue;
                for (let sp of r.platforms) {
                    if (sp.type === 'switch') sp.on = true;
                }
            }
        }
    }
    
    // runtime: step a fade transition and swap rooms at halfway point
    stepTransition() {
        if (!this.transitioning) return;
        this.transitionTimer++;
        const half = Math.floor(this.transitionDuration / 2);
        if (this.transitionTimer <= half) {
            this.transitionAlpha = this.transitionTimer / half;
        } else {
            this.transitionAlpha = 1 - ((this.transitionTimer - half) / (this.transitionDuration - half));
        }
        if (this.transitionTimer === half && typeof this.transitionTargetRoom === 'number') {
            window.__currentRoom = this.transitionTargetRoom;
            const room = window.INITIAL_LEVEL_DATA[window.__currentRoom];
            this.platforms = room.platforms.map(p => new Platform(p.x, p.y, p.width, p.height, p.type, p.vx || 0, p.vy || 0, typeof p.collidable === 'undefined' ? true : p.collidable));
            this.spawn = { x: room.spawn.x, y: room.spawn.y };
            this.resetPlayerToSpawnDeath();
        }
        if (this.transitionTimer >= this.transitionDuration) {
            this.transitioning = false;
            this.transitionTimer = 0;
            this.transitionAlpha = 0;
            this.transitionTargetRoom = null;
        }
        // update DOM overlay (exported HTML) if present so exported pages show fade overlay
        if (typeof window.__transitionOverlay !== 'undefined' && window.__transitionOverlay) {
            window.__transitionOverlay.style.opacity = String(Math.max(0, Math.min(1, this.transitionAlpha)));
            window.__transitionOverlay.style.display = (this.transitioning || this.transitionAlpha > 0) ? 'block' : 'none';
        }
    }
    
    update() {
        // If a transition is active, step it and pause gameplay updates while transitioning.
        if (this.transitioning) {
            this.stepTransition();
            this.updateParticles();
            // while fading we freeze gameplay updates until transition fully completes
            if (this.transitioning) return;
        }
        
        // If won, freeze movement and fade player out
        if (this.won) {
            // lock movement
            this.player.velocityX = 0;
            this.player.velocityY = 0;
            // steadily reduce alpha until fully transparent (monotonic)
            this.player.alpha = typeof this.player.alpha === 'number' ? Math.max(0, this.player.alpha - 0.02) : 1;
            // update particles during fade
            this.updateParticles();
            return;
        }
            
        // Handle input
        if (this.keys['arrowleft'] || this.keys['a']) {
            this.player.velocityX -= this.player.speed;
        }
        if (this.keys['arrowright'] || this.keys['d']) {
            this.player.velocityX += this.player.speed;
        }
        if ((this.keys[' '] || this.keys['arrowup'] || this.keys['w']) && this.player.onGround) {
            this.player.velocityY = -this.player.jumpPower;
            this.player.onGround = false;
        }
        
        // Apply physics
        this.player.velocityY += GRAVITY;
        this.player.velocityX *= FRICTION;
        
        // Update position
        this.player.x += this.player.velocityX;
        this.player.y += this.player.velocityY;
        
        // Check platform collisions
        this.player.onGround = false;
        
        // Move platforms that have velocities (simple horizontal bounce on canvas edges)
        for (let i = 0; i < this.platforms.length; i++) {
            const p = this.platforms[i];
            if ((p.vx && p.vx !== 0) || (p.vy && p.vy !== 0)) {
                const oldX = p.x, oldY = p.y;
                p.x += p.vx;
                p.y += p.vy;
                if (p.x < 0) { p.x = 0; p.vx *= -1; }
                if (p.x + p.width > canvas.width) { p.x = canvas.width - p.width; p.vx *= -1; }
                if (p.y < 0) { p.y = 0; p.vy *= -1; }
                if (p.y + p.height > canvas.height) { p.y = canvas.height - p.height; p.vy *= -1; }
                // check collisions with other platforms and revert + reverse if collided
                let collided = false;
                for (let k = 0; k < this.platforms.length; k++) {
                    if (this.platforms[k] === p) continue;
                    const q = this.platforms[k];
                    // skip non-collidable platforms
                    if (!q.collidable) continue;
                    // runtime: skip switchblocks/blueswitchblocks when they are non-collidable per shared window.__switchOn
                    if ((q.type === 'switchblock' && !window.__switchOn) || (q.type === 'blueswitchblock' && window.__switchOn)) continue;
                    if (p.x < q.x + q.width && p.x + p.width > q.x &&
                        p.y < q.y + q.height && p.y + p.height > q.y) {
                        collided = true;
                        break;
                    }
                }
                if (collided) {
                    p.x = oldX;
                    p.y = oldY;
                    p.vx *= -1;
                    p.vy *= -1;
                }
            }
        }
        
        const prevY = this.player.y - this.player.velocityY; 

        for (let platform of this.platforms) {
            // runtime switchblock rules:
            // Red switchblock: collidable when window.__switchOn === true
            // Blue switchblock: collidable when window.__switchOn === false
            if ((platform.type === 'switchblock' && !window.__switchOn) || (platform.type === 'blueswitchblock' && window.__switchOn)) continue;
            
            if (!platform.collidable) continue;
            if (this.checkCollision(this.player, platform)) {
                // Collectible handling (mark collected and spawn particles)
                if (platform.type === 'collectible') {
                    if (!platform.collected) {
                        this.spawnDeathParticles(platform.x + platform.width/2, platform.y + platform.height/2, 10);
                        platform.collected = true;
                        // sync collected state to the global rooms data so counters aggregate across rooms
                        if (window.__rooms && typeof window.__currentRoom === 'number') {
                            const roomPlatforms = window.__rooms[window.__currentRoom] && window.__rooms[window.__currentRoom].platforms;
                            if (roomPlatforms) {
                                for (let rp of roomPlatforms) {
                                    if (rp.x === platform.x && rp.y === platform.y && rp.width === platform.width && rp.height === platform.height && rp.type === platform.type) {
                                        rp.collected = true;
                                        break;
                                    }
                                }
                            }
                        }
                    }
                    // do not perform collision resolution for collectibles
                    continue;
                }
                
                // Spike handling
                if (platform.type === 'spike') {
                    this.spawnDeathParticles(this.player.x + this.player.width/2, this.player.y + this.player.height/2);
                    this.attempts++;
                    this.resetPlayerToSpawnDeath();
                    return;
                }
                // Flag win
                if (platform.type === 'flag') {
                    // only count flag as win if runtime configured for flag wins
                    // handle 'flag' and 'both' (both requires coins collected)
                    if (WIN_CONDITION === 'flag') {
                        this.player.x = platform.x;
                        this.player.y = platform.y - this.player.height;
                        this.player.velocityX = 0;
                        this.player.velocityY = 0;
                        this.won = true;
                        return;
                    } else if (WIN_CONDITION === 'both') {
                        // aggregate collected across all rooms
                        const allPlatforms = (window.__rooms || []).reduce((acc, r) => acc.concat(r.platforms || []), []);
                        const collected = allPlatforms.filter(p => p.type === 'collectible' && p.collected).length;
                        if (collected >= COIN_GOAL) {
                            this.player.x = platform.x;
                            this.player.y = platform.y - this.player.height;
                            this.player.velocityX = 0;
                            this.player.velocityY = 0;
                            this.won = true;
                            return;
                        } else {
                            continue;
                        }
                    } else {
                        continue;
                    }
                }
                // Door handling in exported runtime: advance to next room if available
                if (platform.type === 'door') {
                    if (window.INITIAL_LEVEL_DATA && Array.isArray(window.INITIAL_LEVEL_DATA) && window.INITIAL_LEVEL_DATA.length > 0) {
                        window.__currentRoom = (typeof window.__currentRoom === 'number') ? window.__currentRoom : 0;
                        const next = window.__currentRoom + 1;
                        if (next < window.INITIAL_LEVEL_DATA.length) {
                            // start a fade transition in exported runtime: set target and let the runtime step and switch at halfway point
                            if (window.__gameInstance && !window.__gameInstance.transitioning) {
                                window.__gameInstance.transitioning = true;
                                window.__gameInstance.transitionTimer = 0;
                                window.__gameInstance.transitionTargetRoom = next;
                                window.__gameInstance.transitionAlpha = 0;
                            }
                            return;
                        }
                     }
                     continue;
                 }
                 // Robust AABB overlap resolution for solid platforms (block / jumppad)
                 if (platform.type === 'block' || platform.type === 'jumppad' || platform.type === 'semisolid' || platform.type === 'switchblock' || platform.type === 'blueswitchblock' || platform.type === 'switch') {
                     // include blueswitchblock as a solid-type so exported runtime resolves collisions when it is collidable
                     // (added below to match editor logic)
                     // compute overlap on both axes
                     const overlapX1 = (this.player.x + this.player.width) - platform.x; // from left
                     const overlapX2 = (platform.x + platform.width) - this.player.x; // from right
                     const overlapY1 = (this.player.y + this.player.height) - platform.y; // from top
                     const overlapY2 = (platform.y + platform.height) - this.player.y; // from bottom
                     // find minimal penetration
                     const overlapX = Math.min(overlapX1, overlapX2);
                     const overlapY = Math.min(overlapY1, overlapY2);
                     // semisolid: allow only when landing from above
                     if (platform.type === 'semisolid') {
                         const prevBottom = prevY + this.player.height;
                         if (prevBottom > platform.y + 1) {
                             continue;
                         }
                         if (!(prevBottom <= platform.y && overlapY <= overlapX)) {
                             continue;
                         }
                     }
                     if (overlapX < overlapY) {
                         // resolve horizontally
                         if (overlapX1 < overlapX2) {
                             // push player left
                             this.player.x = platform.x - this.player.width;
                         } else {
                             // push player right
                             this.player.x = platform.x + platform.width;
                         }
                         this.player.velocityX = 0;
                     } else {
                         // resolve vertically
                         if (overlapY1 < overlapY2) {
                             // landed on top
                             this.player.y = platform.y - this.player.height;
                             if (platform.type === 'jumppad') {
                                 this.player.velocityY = -this.player.jumpPower * 1.2;
                                 this.player.onGround = false;
                             } else {
                                 this.player.velocityY = 0;
                                 this.player.onGround = true;
                             }
                             // If platform is moving, move the player along with it
                             if (platform.vx) this.player.x += platform.vx;
                             if (platform.vy) this.player.y += platform.vy;
                         } else {
                             // hit from below
                             this.player.y = platform.y + platform.height;
                             this.player.velocityY = 0;
                             // If this platform is a switch and player hit it from below, toggle the shared switch state
                             if (platform.type === 'switch') {
                                 window.__switchOn = !window.__switchOn;
                                 // propagate to all rooms' switch platform objects for consistent visuals/state
                                 if (window.__rooms) {
                                     for (let r of window.__rooms) {
                                         if (r && Array.isArray(r.platforms)) {
                                             for (let sp of r.platforms) {
                                                 if (sp.type === 'switch') sp.on = window.__switchOn;
                                             }
                                         }
                                     }
                                 }
                                 // also reflect state on this runtime instance platforms list
                                 for (let p of this.platforms) if (p.type === 'switch') p.on = window.__switchOn;
                             }
                         }
                     }
                     // Also support 'switch' as a solid platform in exported runtime by handling it similarly
                     if (platform.type === 'switch') {
                         if (overlapX < overlapY) {
                             if (overlapX1 < overlapX2) this.player.x = platform.x - this.player.width;
                             else this.player.x = platform.x + platform.width;
                             this.player.velocityX = 0;
                         } else {
                             if (overlapY1 < overlapY2) {
                                 this.player.y = platform.y - this.player.height;
                                 this.player.velocityY = 0;
                                 this.player.onGround = true;
                                 if (platform.vx) this.player.x += platform.vx;
                                 if (platform.vy) this.player.y += platform.vy;
                             } else {
                                 this.player.y = platform.y + platform.height;
                                 this.player.velocityY = 0;
                             }
                         }
                     }
                }
            }
        }

        // Keep player in bounds
        if (this.player.x < 0) {
            this.player.x = 0;
            this.player.velocityX = 0;
        }
        if (this.player.x + this.player.width > canvas.width) {
            this.player.x = canvas.width - this.player.width;
            this.player.velocityX = 0;
        }
        if (this.player.y > canvas.height) {
            // spawn particles at bottom and reset to exported spawn
            this.spawnDeathParticles(this.player.x + this.player.width/2, canvas.height);
            this.attempts++;
            this.resetPlayerToSpawnDeath();
        }

        // after collisions and particle updates, check coins win condition
        // Only auto-win on coins when WIN_CONDITION is explicitly "coins".
        // If WIN_CONDITION is "both", the player must still touch the flag after collecting coins.
        if (WIN_CONDITION === 'coins') {
            const allPlatforms = (window.__rooms || []).reduce((acc, r) => acc.concat(r.platforms || []), []);
            const collected = allPlatforms.filter(p => p.type === 'collectible' && p.collected).length;
            if (collected >= COIN_GOAL) {
                this.won = true;
            }
        }
        
        // update particles each frame
        this.updateParticles();
    }
    
    checkCollision(rect1, rect2) {
        return rect1.x < rect2.x + rect2.width &&
               rect1.x + rect1.width > rect2.x &&
               rect1.y < rect2.y + rect2.height &&
               rect1.y + rect1.height > rect2.y;
    }
    
    draw() {
        ctx.fillStyle = '#000'; 
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#FFF'; 
        
        // Draw platforms
        for (let platform of this.platforms) {
            
            // In exported runtime do not draw a full filled/stroked rect for spikes or semisolids
            if (platform.type === 'spike' || platform.type === 'semisolid' || platform.type === 'collectible' || platform.type === 'switchblock' || platform.type === 'blueswitchblock') {
                // leave background transparent; semisolid will draw its top-half below
            } else {
                ctx.fillStyle = platform.type === 'jumppad' ? '#AAA' : '#FFF';
                ctx.fillRect(platform.x, platform.y, platform.width, platform.height);
                // removed stroke for regular blocks in exported runtime — only switches draw borders
            }

            // draw flag visual as a yellow dot (exported runtime)
            if (platform.type === 'flag') {
                const cx = platform.x + platform.width/2;
                const cy = platform.y + platform.height/2;
                ctx.fillStyle = '#FFD400';
                ctx.beginPath();
                ctx.arc(cx, cy, Math.min(platform.width, platform.height) * 0.22, 0, Math.PI * 2);
                ctx.fill();
            }

            // Draw Door visual: slim tall rectangle with dark fill and light outline (match editor)
            if (platform.type === 'door') {
                ctx.fillStyle = '#222'; // dark interior
                ctx.fillRect(platform.x + platform.width*0.15, platform.y + platform.height*0.05, platform.width*0.7, platform.height*0.9);
                ctx.lineWidth = 2;
                ctx.strokeStyle = '#AAA';
                ctx.strokeRect(platform.x + platform.width*0.15, platform.y + platform.height*0.05, platform.width*0.7, platform.height*0.9);
            }

            // Draw Switch visual: render like a block but border color indicates shared state (red = on, blue = off)
            if (platform.type === 'switch') {
                ctx.fillStyle = '#FFF';
                ctx.fillRect(platform.x, platform.y, platform.width, platform.height);
                ctx.lineWidth = 3;
                // use shared state; prefer per-platform cached 'on' if present to remain consistent after history changes
                const onState = (typeof platform.on === 'boolean') ? platform.on : (window.__switchOn || false);
                ctx.strokeStyle = onState ? '#F00' : '#00F';
                ctx.strokeRect(platform.x, platform.y, platform.width, platform.height);
            }

            // Draw Switch Block visual in exported runtime: block with green border when ON, faint when OFF
            if (platform.type === 'switchblock') {
                const onState = (typeof platform.on === 'boolean') ? platform.on : (window.__switchOn || false);
                if (onState) {
                    ctx.fillStyle = '#F00';
                    ctx.fillRect(platform.x, platform.y, platform.width, platform.height);
                    ctx.lineWidth = 3;
                    ctx.strokeStyle = '#FFF';
                    ctx.setLineDash([]);
                    ctx.strokeRect(platform.x, platform.y, platform.width, platform.height);
                } else {
                    // OFF: transparent with dotted red border
                    ctx.clearRect(platform.x, platform.y, platform.width, platform.height);
                    ctx.lineWidth = 2;
                    ctx.strokeStyle = '#F00';
                    ctx.setLineDash([4,4]);
                    ctx.strokeRect(platform.x + 0.5, platform.y + 0.5, platform.width - 1, platform.height - 1);
                    ctx.setLineDash([]);
                }
            }

            // Draw Blue Switch Block visual in exported runtime (inverse behavior of red): solid blue when switch OFF, dotted when ON
            if (platform.type === 'blueswitchblock') {
                const onState = (typeof platform.on === 'boolean') ? platform.on : (window.__switchOn || false);
                if (!onState) {
                    ctx.fillStyle = '#1E90FF';
                    ctx.fillRect(platform.x, platform.y, platform.width, platform.height);
                    ctx.lineWidth = 3;
                    ctx.strokeStyle = '#FFF';
                    ctx.setLineDash([]);
                    ctx.strokeRect(platform.x, platform.y, platform.width, platform.height);
                } else {
                    ctx.clearRect(platform.x, platform.y, platform.width, platform.height);
                    ctx.lineWidth = 2;
                    ctx.strokeStyle = '#1E90FF';
                    ctx.setLineDash([4,4]);
                    ctx.strokeRect(platform.x + 0.5, platform.y + 0.5, platform.width - 1, platform.height - 1);
                    ctx.setLineDash([]);
                }
            }

            if (platform.type === 'spike') {
                // exported runtime: single white triangle spanning the platform
                ctx.fillStyle = '#FFF';
                ctx.beginPath();
                ctx.moveTo(platform.x + platform.width / 2, platform.y);
                ctx.lineTo(platform.x, platform.y + platform.height);
                ctx.lineTo(platform.x + platform.width, platform.y + platform.height);
                ctx.closePath();
                ctx.fill();
                // no stroke for spikes
            }
            
            // Draw Collectible visual: small cyan circle centered in the cell (only if not collected)
            if (platform.type === 'collectible' && !platform.collected) {
                const cx = platform.x + platform.width/2;
                const cy = platform.y + platform.height/2;
                ctx.fillStyle = '#00FFFF';
                ctx.beginPath();
                ctx.arc(cx, cy, Math.min(platform.width, platform.height) * 0.28, 0, Math.PI * 2);
                ctx.fill();
                ctx.lineWidth = 2;
                ctx.strokeStyle = '#FFF';
                ctx.stroke();
            }
             
            if (platform.type === 'jumppad') {
                 ctx.fillStyle = '#000'; 
                 const midX = platform.x + platform.width/2;
                 const topY = platform.y + platform.height * 0.2;
                 const midY = platform.y + platform.height * 0.7;
                 
                 ctx.fillRect(midX - 2, topY, 4, midY - topY); 
                 ctx.beginPath();
                 ctx.moveTo(midX, topY);
                 ctx.lineTo(midX - platform.width/4, topY + platform.height/4);
                 ctx.lineTo(midX + platform.width/4, topY + platform.height/4);
                 ctx.closePath();
                 ctx.fill();
            }

            // Draw Semisolid visual cue: half-height white filled block (top half transparent)
            if (platform.type === 'semisolid') {
                ctx.fillStyle = '#FFF';
                const hh = Math.floor(platform.height / 2);
                // draw the top half filled white, leave bottom transparent and do not stroke
                ctx.fillRect(platform.x, platform.y, platform.width, hh);
            }
            
            // If platform has velocity, draw a subtle blue border to indicate movement (exported runtime)
            if ((platform.vx && platform.vx !== 0) || (platform.vy && platform.vy !== 0)) {
                ctx.save();
                ctx.strokeStyle = '#1E90FF';
                ctx.lineWidth = 2;
                ctx.strokeRect(platform.x + 1, platform.y + 1, platform.width - 2, platform.height - 2);
                ctx.restore();
            }
            
            // Draw switch visuals in exported runtime: border color driven by shared window.__switchOn or per-platform .on
            if (platform.type === 'switch') {
                ctx.fillStyle = '#FFF';
                ctx.fillRect(platform.x, platform.y, platform.width, platform.height);
                ctx.lineWidth = 3;
                const onState = (typeof platform.on === 'boolean') ? platform.on : (window.__switchOn || false);
                ctx.strokeStyle = onState ? '#F00' : '#00F';
                ctx.strokeRect(platform.x, platform.y, platform.width, platform.height);
            }
        }
        
        // Draw player with fading alpha (when won)
        if (!this.player.alpha || this.player.alpha > 0) {
            ctx.save();
            ctx.globalAlpha = (typeof this.player.alpha === 'number') ? this.player.alpha : 1;
            ctx.fillStyle = '#FFF'; 
            ctx.fillRect(this.player.x, this.player.y, this.player.width, this.player.height);
            // no stroke for player
            ctx.restore();
        }

        // draw particles on top
        if (this.particles.length > 0) {
            for (let p of this.particles) {
                ctx.globalAlpha = Math.max(0, p.alpha);
                ctx.fillStyle = '#FFF';
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 1;
        }

        // Draw coin counter (if enabled in exported runtime)
        if (this.showCoinCounter) {
            const total = this.platforms.filter(p => p.type === 'collectible').length;
            const collected = this.platforms.filter(p => p.type === 'collectible' && p.collected).length;
            ctx.fillStyle = 'rgba(0,0,0,0.6)';
            ctx.fillRect(12, 12, 140, 36);
            ctx.fillStyle = '#FFF';
            ctx.font = '14px Arial';
            ctx.textAlign = 'left';
            ctx.fillText(\`Coins: \${collected} / \${total}\`, 20, 36);
        }

        // Win overlay for exported runtime
        if (this.won) {
            ctx.fillStyle = 'rgba(0,0,0,0.6)';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#FFF';
            ctx.font = '28px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('You Win!', canvas.width/2, canvas.height/2);
            ctx.font = '16px Arial';
            ctx.fillText('Attempts: ' + (this.attempts || 0), canvas.width/2, canvas.height/2 + 36);
        }

        // in update() near top:
        if (this.transitioning) { this.stepTransition(); this.updateParticles(); if (this.transitioning) return; }

        // in draw(), after drawing everything else, add:
        if (this.transitioning || this.transitionAlpha > 0) {
            ctx.fillStyle = 'rgba(0,0,0,' + Math.max(0, Math.min(1, this.transitionAlpha)) + ')';
            ctx.fillRect(0,0,canvas.width,canvas.height);
        }
    }
    
    gameLoop() {
        this.update();
        this.draw();
        requestAnimationFrame(() => this.gameLoop());
    }
}

document.addEventListener('DOMContentLoaded', () => {
    // initialize rooms and start game instance that will load room 0
    window.__rooms = ${levelDataJson};
    window.__currentRoom = 0;
    const __game = new Game();
    
    window.__gameInstance = __game;

    // create a simple fade overlay in exported HTML so transitions are visible even when canvas scales
    (function createExportTransitionOverlay(){
        try {
            const ov = document.createElement('div');
            ov.id = 'exportTransitionOverlay';
            ov.style.position = 'fixed';
            ov.style.left = '0';
            ov.style.top = '0';
            ov.style.width = '100%';
            ov.style.height = '100%';
            ov.style.background = '#000';
            ov.style.pointerEvents = 'none';
            ov.style.transition = 'opacity 80ms linear';
            ov.style.opacity = '0';
            ov.style.display = 'none';
            document.body.appendChild(ov);
            window.__transitionOverlay = ov;
        } catch (e) { /* no-op in restrictive environments */ }
    })();
    
    window.__gameInstance = __game;
    
    // Create / manage left side panel for coin-based win conditions
    (function setupSidePanel() {
        const panel = document.createElement('div');
        panel.id = 'sidePanel';
        panel.style.position = 'absolute';
        panel.style.left = '12px';
        panel.style.top = '12px';
        panel.style.width = '220px';
        panel.style.padding = '12px';
        panel.style.background = 'rgba(255,255,255,0.04)';
        panel.style.color = '#FFF';
        panel.style.fontFamily = 'Arial, sans-serif';
        panel.style.border = '1px solid rgba(255,255,255,0.06)';
        panel.style.borderRadius = '6px';
        panel.style.pointerEvents = 'none';
        panel.style.display = (WIN_CONDITION === 'coins' || WIN_CONDITION === 'both') ? 'block' : 'none';
        panel.innerHTML = \`
            <div style="font-weight:600;margin-bottom:8px;color:#FFF;">Objective</div>
            <div id="panelGoal" style="margin-bottom:6px;color:#FFF;">Collect \${COIN_GOAL} coin(s)</div>
            <div id="panelProgress" style="font-size:14px;color:#FFF;">0 / 0 collected</div>
            <div id="panelHint" style="margin-top:8px;font-size:12px;color:#FFF;">\${WIN_CONDITION === 'both' ? 'Touch goal after collecting.' : ''}</div>
        \`;
        document.body.appendChild(panel);

        // Update loop for panel (keeps in sync with runtime state)
        const updatePanel = () => {
            // aggregate across all rooms to keep counter consistent across rooms
            const allPlatforms = (window.__rooms || []).reduce((acc, r) => acc.concat(r.platforms || []), []);
            const total = allPlatforms.filter(p => p.type === 'collectible').length;
            const collected = allPlatforms.filter(p => p.type === 'collectible' && p.collected).length;
            const goalEl = document.getElementById('panelGoal');
            const progEl = document.getElementById('panelProgress');
            if (goalEl) goalEl.textContent = \`Collect \${COIN_GOAL} coin(s)\`;
            if (progEl) progEl.textContent = \`\${collected} / \${Math.max(total, COIN_GOAL)} collected\`;
            // hide the panel when player has won
            if (__game.won) {
                panel.style.display = 'none';
            }
        };
        // update every 200ms — lightweight and keeps DOM in sync
        const iv = setInterval(updatePanel, 200);
        // clear interval if the game instance is removed
        window.addEventListener('beforeunload', () => clearInterval(iv));
    })();
});
`;

        // --- Runtime Game Code Definition ---
              // DO NOT REMOVE

        
        const exportedHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Exported Platformer Level</title>
    <style>
        body {
            margin: 0;
            padding: 0;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            background: #000;
            font-family: Arial, sans-serif;
            overflow: hidden; /* prevent scrollbars */
        }
        /* layout: canvas centered, allow a left panel to sit on top */
        canvas {
            border: 2px solid #fff;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
            background: #000;
            /* Let the canvas scale down to fit viewport while preserving its internal 800x600 resolution */
            max-width: calc(100vw - 40px);
            max-height: calc(100vh - 40px);
            width: auto;
            height: auto;
            display: block;
        }
        /* small responsive tweak so the panel doesn't overflow on very small viewports */
        @media (max-width: 520px) {
            #sidePanel { display: none !important; }
        }
     </style>
</head>
<body>
    <canvas id="gameCanvas"></canvas>
    
    <script>
        // Level Data injected here
        // INITIAL_LEVEL_DATA is an array of rooms: [{ platforms: [...], spawn: {x,y} }, ...]
        window.INITIAL_LEVEL_DATA = ${levelDataJson};
        // provide INITIAL_SPAWN as the spawn of first room for compatibility
        window.INITIAL_SPAWN = ${spawnJson};
        window.INITIAL_SHOW_COIN_COUNTER = ${showCoinCounterJson};
        window.INITIAL_WIN_CONDITION = ${winConditionJson};
        window.INITIAL_COIN_GOAL = ${coinGoalJson};
    </script>

    <script>
${runtimeGameContent}
    </script>
</body>
</html>
        `;

        // Trigger download
        const blob = new Blob([exportedHtml], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        // Prompt for filename, sanitize, and ensure .html extension
        let filename = (prompt('Enter filename for export', 'exported_level') || 'exported_level').trim();
        filename = filename.replace(/[^a-z0-9_\-\.]/gi, '_');
        if (!filename.toLowerCase().endsWith('.html')) filename += '.html';
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
    
    gameLoop() {
        this.update();
        this.draw();
        requestAnimationFrame(() => this.gameLoop());
    }
}

// add keyboard shortcuts for undo/redo
window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        const g = window.__gameInstance;
        if (g) g.undo();
        e.preventDefault();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        const g = window.__gameInstance;
        if (g) g.redo();
        e.preventDefault();
    }
});

// Initialize the editor runtime (or exported runtime) correctly and expose instance for shortcuts
if (!window.INITIAL_LEVEL_DATA) {
    // Editor mode: start the Game instance (no initial level data)
    window.__gameInstance = new Game();
} else {
    // Exported runtime: use provided INITIAL_LEVEL_DATA and INITIAL_SPAWN
    const platforms = window.INITIAL_LEVEL_DATA.map(p => ({ x: p.x, y: p.y, width: p.width, height: p.height, type: p.type }));
    const spawn = { x: window.INITIAL_SPAWN.x, y: window.INITIAL_SPAWN.y };
    window.__currentRoom = 0; // initialize current room index for exported runtime navigation
    window.__gameInstance = new Game();
    // If the exported runtime expects the Game to be constructed with data, call update on instance
    // For compatibility, replace platforms and spawn on the instance if present
    if (window.__gameInstance) {
        window.__gameInstance.platforms = platforms.map(p => new Platform(p.x, p.y, p.width, p.height, p.type));
        window.__gameInstance.spawn = spawn;
        window.__gameInstance.resetPlayerToSpawn();
    }
}