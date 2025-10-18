export class InputHandler {
    constructor() {
        this.keys = {};
        this.justPressed = {};
        
        window.addEventListener('keydown', (e) => {
            this.keys[e.key.toLowerCase()] = true;
            this.justPressed[e.key.toLowerCase()] = true;
        });
        
        window.addEventListener('keyup', (e) => {
            this.keys[e.key.toLowerCase()] = false;
        });
    }
    
    isPressed(key) {
        return this.keys[key.toLowerCase()] || false;
    }
    
    isJustPressed(key) {
        return !!this.justPressed[key.toLowerCase()];
    }
    
    clearJustPressed() {
        this.justPressed = {};
    }
}