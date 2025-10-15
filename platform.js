export class Platform {
    constructor(x, y, width, height, type = 'block', vx = 0, vy = 0, collidable = true) {
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
        this.type = type; // 'block', 'spike', 'jumppad', 'semisolid'
        this.vx = vx; // horizontal velocity for moving blocks
        this.vy = vy;
        this.collidable = collidable;
        // remember original placement so moving platforms can be reset
        this.initialX = x;
        this.initialY = y;
        // remember original velocities so direction can be restored on reset
        this.initialVx = vx;
        this.initialVy = vy;
        // track collected state for collectibles so they can be restored on death/reset
        this.collected = false;
    }
}