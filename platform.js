export class Platform {
    constructor(x, y, width, height, type = 'block', vx = 0, vy = 0) {
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
        this.type = type; // 'block', 'spike', 'jumppad', 'semisolid'
        this.vx = vx; // horizontal velocity for moving blocks
        this.vy = vy;
        // remember original placement so moving platforms can be reset
        this.initialX = x;
        this.initialY = y;
    }
}