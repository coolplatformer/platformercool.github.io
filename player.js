export class Player {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.width = 32;
        this.height = 32;
        this.velocityX = 0;
        this.velocityY = 0;
        this.speed = 0.9;
        this.jumpPower = 10.1;
        this.onGround = false;
    }
}