import * as PIXI from 'pixi.js'

export interface ThemeConfig {
  particleCount: number // Number of floating particles
  particleColor?: number // Hex color for particles
  // The atrium's background, so particle rendering can adapt to it. Additive
  // blending only reads as a glow against a dark ground.
  backgroundColor?: number
  particlesEnabled?: boolean // Toggle particles
  particleOpacity?: number // Opacity for floating particles (0-1)
  particleDensity?: number // Density multiplier for particles (0.1-3.0)
}

export interface Particle {
  sprite: PIXI.Sprite
  vx: number
  vy: number
  worldX: number
  worldY: number
}

const DEFAULT_THEME: ThemeConfig = {
  particleCount: 50,
  particleColor: 0xffffff,
  particlesEnabled: true,
}

// The atrium's floating particles. (It placed pictures on the ground as well
// once -- stones, grass -- which nobody wanted: gone, with their settings.)
// `offset` brought into [-half, half) by whole field widths (2 * half).
export function wrapInto(offset: number, half: number): number {
  const width = 2 * half
  return ((((offset + half) % width) + width) % width) - half
}

export class ThemeManager {
  private config: ThemeConfig
  private particles: Particle[] = []
  private particleContainer: PIXI.Container

  constructor(container: PIXI.Container, config?: Partial<ThemeConfig>) {
    this.config = { ...DEFAULT_THEME, ...config }
    this.particleContainer = new PIXI.Container()
    this.particleContainer.eventMode = 'none'
    this.particleContainer.interactiveChildren = false
    // Above the lighting layer, the world's only child when this is made, and
    // below the players, added after.
    container.addChild(this.particleContainer)
  }

  createParticles(viewportWidth: number, viewportHeight: number, centerX: number = 0, centerY: number = 0) {
    // Clear existing particles
    this.particles.forEach(p => {
      this.particleContainer.removeChild(p.sprite)
      p.sprite.destroy()
    })
    this.particles = []

    if (!this.config.particlesEnabled) {
      return
    }

    const particleColor = this.config.particleColor ?? 0xffffff

    // Perceived luminance of the atrium background, used to pick a blend mode
    // (and to strengthen the glow ring, which is likewise near-invisible when
    // it isn't adding light).
    const bg = this.config.backgroundColor ?? 0x0a0a0f
    const bgLuma = (
      0.299 * ((bg >> 16) & 0xff) +
      0.587 * ((bg >> 8) & 0xff) +
      0.114 * (bg & 0xff)
    )
    const isLightBackground = bgLuma > 140
    const baseOpacity = this.config.particleOpacity ?? 0.6
    const densityMultiplier = this.config.particleDensity ?? 1.0
    const particleCount = Math.floor(this.config.particleCount * densityMultiplier)

    // Create simple circle particles (dust-like)
    for (let i = 0; i < particleCount; i++) {
      const graphics = new PIXI.Graphics()
      
      // Random size
      const size = 2 + Math.random() * 4
      
      // Draw glowing circle with configured opacity
      graphics.beginFill(particleColor, baseOpacity * (0.5 + Math.random() * 0.5))
      graphics.drawCircle(0, 0, size)
      graphics.endFill()
      
      // Add glow effect with outer circle. At 0.1 alpha this only registers
      // when it's adding light; on a light background it needs real opacity
      // to be a visible ring at all.
      graphics.lineStyle(1, particleColor, isLightBackground ? 0.35 : 0.1)
      graphics.drawCircle(0, 0, size + 2)
      
      // Random position in viewport, centered on the camera rather than raw
      // world origin -- otherwise particles all spawn around (0,0) and only
      // reach a camera that started elsewhere once the wrap logic catches up.
      const worldX = centerX + (Math.random() - 0.5) * viewportWidth * 3
      const worldY = centerY + (Math.random() - 0.5) * viewportHeight * 3
      graphics.x = worldX
      graphics.y = worldY
      
      // Random velocity (slow drift)
      const vx = (Math.random() - 0.5) * 0.3
      const vy = (Math.random() - 0.5) * 0.3
      
      // Additive blend only reads as a glow against a dark ground: ADD pushes
      // the result toward white, so on a light background (White Room) it
      // lands on near-white and the particles vanish. Fall back to NORMAL
      // there so a dark particle colour actually paints.
      graphics.blendMode = isLightBackground ? PIXI.BLEND_MODES.NORMAL : PIXI.BLEND_MODES.ADD

      this.particleContainer.addChild(graphics)
      this.particles.push({ 
        sprite: graphics as any, 
        vx, 
        vy, 
        worldX, 
        worldY 
      })
    }
  }

  private _particleFrameCounter = 0
  
  updateParticles(cameraX: number, cameraY: number, viewportWidth: number, viewportHeight: number) {
    // Skip frames for performance (update every 2nd frame)
    this._particleFrameCounter++
    if (this._particleFrameCounter % 2 !== 0) return
    
    const time = Date.now() * 0.001
    
    // Calculate viewport radius for fade effect (in world coordinates)
    // viewportWidth/Height are in pixels, we need world units
    const worldViewportRadius = Math.sqrt(Math.pow(viewportWidth / 2, 2) + Math.pow(viewportHeight / 2, 2))
    const fadeStartRadius = worldViewportRadius * 1.5 // Larger radius in world space
    const fadeEndRadius = worldViewportRadius * 2.5
    
    for (let i = 0; i < this.particles.length; i++) {
      const particle = this.particles[i]
      
      // Update position
      particle.worldX += particle.vx
      particle.worldY += particle.vy

      // Calculate distance from camera center for fade effect
      const dx = particle.worldX - cameraX
      const dy = particle.worldY - cameraY
      const distanceFromCamera = Math.sqrt(dx * dx + dy * dy)
      
      // Calculate fade based on distance from camera
      let fadeOpacity = 1.0
      if (distanceFromCamera > fadeStartRadius) {
        const fadeProgress = (distanceFromCamera - fadeStartRadius) / (fadeEndRadius - fadeStartRadius)
        fadeOpacity = Math.max(0, 1 - fadeProgress)
      }
      
      // Wrap around viewport bounds. Each axis uses its own dimension --
      // reusing viewportWidth for the Y axis made the vertical wrap distance
      // wildly inconsistent with what's actually visible on non-square
      // windows, so particles that drifted off the top/bottom could wander
      // far out of view for a long time before ever wrapping back in,
      // making the field look like it was slowly thinning out.
      //
      // By whole widths of the field, so a particle keeps its place in it.
      // Set down exactly at the far edge instead, every particle that left
      // in the same frame -- dozens, on a fast pan -- landed on one line, in
      // a cluster.
      particle.worldX = cameraX + wrapInto(particle.worldX - cameraX, viewportWidth * 1.5)
      particle.worldY = cameraY + wrapInto(particle.worldY - cameraY, viewportHeight * 1.5)
      particle.sprite.x = particle.worldX
      particle.sprite.y = particle.worldY
      
      // Gentle pulsing opacity combined with distance fade
      const baseAlpha = 0.2
      const pulseOffset = i * 0.5 // Different phase for each particle
      const pulseAlpha = baseAlpha + Math.sin(time * 0.5 + pulseOffset) * 0.15
      particle.sprite.alpha = pulseAlpha * fadeOpacity
    }
  }

  destroy() {
    this.particles.forEach(p => {
      p.sprite.destroy()
    })
    this.particles = []
    this.particleContainer.destroy({ children: true })
  }

  // Update theme configuration
  updateConfig(config: Partial<ThemeConfig>) {
    this.config = { ...this.config, ...config }
  }
}
