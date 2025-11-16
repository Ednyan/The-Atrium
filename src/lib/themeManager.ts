import * as PIXI from 'pixi.js'

export interface ThemeConfig {
  groundElements: string[] // Paths to ground element images
  particles: string[] // Paths to particle images
  particleCount: number // Number of floating particles
  groundDensity: number // Elements per 1000x1000 area
}

export interface GroundElement {
  sprite: PIXI.Sprite
  worldX: number
  worldY: number
  targetAlpha: number // Target alpha for fade in/out
  fadeSpeed: number // Speed of fade transition
}

export interface Particle {
  sprite: PIXI.Sprite
  vx: number
  vy: number
  worldX: number
  worldY: number
}

const DEFAULT_THEME: ThemeConfig = {
  groundElements: [],
  particles: [],
  particleCount: 50,
  groundDensity: 0.5, // 0.5 elements per 1000x1000 pixels
}

export class ThemeManager {
  private config: ThemeConfig
  private groundElements: GroundElement[] = []
  private particles: Particle[] = []
  private groundContainer: PIXI.Container
  private particleContainer: PIXI.Container
  private loadedTextures: Map<string, PIXI.Texture> = new Map()
  private seed: number

  constructor(container: PIXI.Container, config?: Partial<ThemeConfig>) {
    this.config = { ...DEFAULT_THEME, ...config }
    this.seed = Math.random() * 10000
    
    // Create containers for layering
    this.groundContainer = new PIXI.Container()
    this.particleContainer = new PIXI.Container()
    
    // Add at specific indices for proper layering:
    // 0: Grid
    // 1: Ground elements (below lighting)
    // 2: Lighting layer
    // 3: Particles (above lighting, below players)
    const gridIndex = 0
    container.addChildAt(this.groundContainer, gridIndex + 1) // After grid
    container.addChildAt(this.particleContainer, gridIndex + 3) // After lighting
    
    console.log('🎨 ThemeManager initialized')
  }

  async loadTheme() {
    // Try to load ground elements
    const groundPaths = await this.discoverAssets('/themes/ground')
    
    this.config.groundElements = groundPaths

    // Load textures for ground elements only
    for (const path of groundPaths) {
      try {
        const texture = await PIXI.Texture.from(path)
        this.loadedTextures.set(path, texture)
      } catch (e) {
        console.warn(`Failed to load ground element: ${path}`)
      }
    }
    
    console.log(`🎨 Theme loaded: ${groundPaths.length} ground elements`)
  }

  private async discoverAssets(basePath: string): Promise<string[]> {
    // Try to discover PNG files in the folder
    const knownGroundElements = [
      'rock-7562944_1280.png', // Add actual files found
      'stone_1.png', 'stone_2.png', 'stone_3.png',
      'grass_1.png', 'grass_2.png', 'grass_3.png',
      'flower_1.png', 'flower_2.png', 'flower_3.png',
      'rock_1.png', 'rock_2.png', 'rock_3.png'
    ]
    
    const list = basePath.includes('ground') ? knownGroundElements : []
    const discovered: string[] = []

    for (const filename of list) {
      const path = `${basePath}/${filename}`
      // Check if file exists by attempting to fetch
      try {
        const response = await fetch(path, { method: 'HEAD' })
        if (response.ok) {
          discovered.push(path)
          console.log(`✅ Found ground element: ${filename}`)
        }
      } catch (e) {
        // File doesn't exist, skip
      }
    }

    console.log(`🎨 Discovered ${discovered.length} ground elements`)
    return discovered
  }

  // Seeded random for consistent placement
  private seededRandom(x: number, y: number): number {
    const seed = this.seed + x * 12.9898 + y * 78.233
    return (Math.sin(seed) * 43758.5453123) % 1
  }

  generateGroundElements(minX: number, minY: number, maxX: number, maxY: number, playerX: number, playerY: number, traces: Array<{x: number, y: number}>) {
    if (this.config.groundElements.length === 0) {
      console.log('⚠️ No ground elements loaded')
      return
    }

    const gridSize = 100 // Check every 50 pixels for ground elements (closer spacing)
    const density = this.config.groundDensity / 10 // Adjusted density calculation
    const generationRadius = 800 // Only generate within 800 pixels of player or traces
    let created = 0
    let checked = 0
    let skippedFar = 0

    // Only generate in camera view bounds (minX, minY, maxX, maxY)
    // Don't expand to include all traces - just what's visible
    for (let x = Math.floor(minX / gridSize) * gridSize; x < maxX; x += gridSize) {
      for (let y = Math.floor(minY / gridSize) * gridSize; y < maxY; y += gridSize) {
        checked++
        
        // Check if this position is within generation radius of player or any trace
        const distToPlayer = Math.sqrt(Math.pow(x - playerX, 2) + Math.pow(y - playerY, 2))
        let nearTrace = false
        
        for (const trace of traces) {
          const distToTrace = Math.sqrt(Math.pow(x - trace.x, 2) + Math.pow(y - trace.y, 2))
          if (distToTrace < generationRadius) {
            nearTrace = true
            break
          }
        }
        
        // Skip if not near player or any trace
        if (distToPlayer >= generationRadius && !nearTrace) {
          skippedFar++
          continue
        }
        
        // Use seeded random to determine if element should exist here
        const rand = this.seededRandom(x, y)
        
        if (rand < density) {
          // Check if we already have an element at this position
          const exists = this.groundElements.some(
            el => Math.abs(el.worldX - x) < gridSize && Math.abs(el.worldY - y) < gridSize
          )
          
          if (!exists) {
            this.createGroundElement(x, y)
            created++
          }
        }
      }
    }
    
    if (created > 0 || checked > 0) {
      console.log(`🌱 Generation: checked ${checked} cells, skipped ${skippedFar} (too far), created ${created} new elements. Total traces: ${traces.length}`)
    }
  }

  private createGroundElement(worldX: number, worldY: number) {
    const texturePaths = this.config.groundElements
    if (texturePaths.length === 0) return

    // Pick random texture
    const textureIndex = Math.floor(this.seededRandom(worldX * 0.5, worldY * 0.7) * texturePaths.length)
    const texturePath = texturePaths[textureIndex]
    const texture = this.loadedTextures.get(texturePath)
    
    if (!texture) return

    const sprite = new PIXI.Sprite(texture)
    sprite.anchor.set(0.5)
    
    // Random offset within grid cell
    const offsetX = (this.seededRandom(worldX * 1.1, worldY * 0.9) - 0.5) * 50
    const offsetY = (this.seededRandom(worldX * 0.8, worldY * 1.2) - 0.5) * 50
    
    sprite.x = worldX + offsetX
    sprite.y = worldY + offsetY
    
    // Random scale (much smaller: 0.15 to 0.25)
    const scale = 0.05 + this.seededRandom(worldX * 0.3, worldY * 0.6) * 0.025
    sprite.scale.set(scale)
    
    // Start invisible for fade in
    sprite.alpha = 0

    this.groundContainer.addChild(sprite)
    this.groundElements.push({ 
      sprite, 
      worldX: sprite.x, 
      worldY: sprite.y,
      targetAlpha: 1.0,
      fadeSpeed: 0.02 // Fade in over ~50 frames
    })
  }

  createParticles(viewportWidth: number, viewportHeight: number) {
    // Create simple circle particles (dust-like)
    for (let i = 0; i < this.config.particleCount; i++) {
      const graphics = new PIXI.Graphics()
      
      // Random size
      const size = 2 + Math.random() * 4
      
      // Draw glowing circle
      graphics.beginFill(0xffffff, 0.3 + Math.random() * 0.3)
      graphics.drawCircle(0, 0, size)
      graphics.endFill()
      
      // Add glow effect with outer circle
      graphics.lineStyle(1, 0xffffff, 0.1)
      graphics.drawCircle(0, 0, size + 2)
      
      // Random position in viewport
      const worldX = (Math.random() - 0.5) * viewportWidth * 3
      const worldY = (Math.random() - 0.5) * viewportHeight * 3
      graphics.x = worldX
      graphics.y = worldY
      
      // Random velocity (slow drift)
      const vx = (Math.random() - 0.5) * 0.3
      const vy = (Math.random() - 0.5) * 0.3
      
      // Additive blend for glow
      graphics.blendMode = PIXI.BLEND_MODES.ADD

      this.particleContainer.addChild(graphics)
      this.particles.push({ 
        sprite: graphics as any, 
        vx, 
        vy, 
        worldX, 
        worldY 
      })
    }
    
    console.log(`✨ Created ${this.config.particleCount} dust particles`)
  }

  updateParticles(cameraX: number, cameraY: number, viewportWidth: number, viewportHeight: number) {
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
      particle.sprite.x = particle.worldX
      particle.sprite.y = particle.worldY
      
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
      
      // Wrap around viewport bounds
      const relX = particle.worldX - cameraX
      const relY = particle.worldY - cameraY
      
      const wrapDistance = viewportWidth * 1.5
      
      if (relX < -wrapDistance) {
        particle.worldX = cameraX + wrapDistance
      } else if (relX > wrapDistance) {
        particle.worldX = cameraX - wrapDistance
      }
      
      if (relY < -wrapDistance) {
        particle.worldY = cameraY + wrapDistance
      } else if (relY > wrapDistance) {
        particle.worldY = cameraY - wrapDistance
      }
      
      // Gentle pulsing opacity combined with distance fade
      const baseAlpha = 0.2
      const pulseOffset = i * 0.5 // Different phase for each particle
      const pulseAlpha = baseAlpha + Math.sin(time * 0.5 + pulseOffset) * 0.15
      particle.sprite.alpha = pulseAlpha * fadeOpacity
    }
  }

  cullGroundElements(cameraX: number, cameraY: number, viewportWidth: number, viewportHeight: number, playerX: number, playerY: number, traces: Array<{x: number, y: number}>, zoom: number) {
    // If zoom is too small (< 0.5), fade out all ground elements
    if (zoom < 0.3) {
      this.groundElements.forEach(element => {
        element.targetAlpha = 0
        if (element.sprite.alpha > 0) {
          element.sprite.alpha = Math.max(0, element.sprite.alpha - element.fadeSpeed)
        }
      })
      // Remove fully faded elements
      this.groundElements = this.groundElements.filter(element => {
        if (element.sprite.alpha <= 0.01) {
          this.groundContainer.removeChild(element.sprite)
          element.sprite.destroy()
          return false
        }
        return true
      })
      return
    }
    
    // Calculate viewport dimensions in WORLD coordinates (not screen pixels)
    const worldViewportWidth = viewportWidth / zoom
    const worldViewportHeight = viewportHeight / zoom
    
    // Fade zones as multipliers of half-width/half-height
    const fadeStartMultiplier = 0.7 // Start fade at 70% of viewport edge
    const fadeEndMultiplier = 1.2 // Fully fade at 120% of viewport edge
    
    const generationRadius = 800 // Same as generation radius
    
    this.groundElements = this.groundElements.filter(element => {
      const dx = element.worldX - cameraX
      const dy = element.worldY - cameraY
      
      // Calculate fade based on RECTANGULAR distance (not circular)
      // Normalize distance in each axis relative to viewport size
      const normalizedX = Math.abs(dx) / (worldViewportWidth / 2)
      const normalizedY = Math.abs(dy) / (worldViewportHeight / 2)
      
      // Use the maximum of the two to create rectangular vignette
      const normalizedDistance = Math.max(normalizedX, normalizedY)
      
      // Check if element is still near player or any trace
      const distToPlayer = Math.sqrt(Math.pow(element.worldX - playerX, 2) + Math.pow(element.worldY - playerY, 2))
      let nearTrace = false
      
      for (const trace of traces) {
        const distToTrace = Math.sqrt(Math.pow(element.worldX - trace.x, 2) + Math.pow(element.worldY - trace.y, 2))
        if (distToTrace < generationRadius) {
          nearTrace = true
          break
        }
      }
      
      // Element should exist if near player OR near any trace
      const shouldExist = distToPlayer < generationRadius || nearTrace
      
      // Calculate target fade based on:
      // 1. Whether it should exist (near player/trace)
      // 2. Distance from camera (for rectangular vignette effect)
      let targetFadeOpacity = 1.0
      
      if (!shouldExist) {
        // Fade out if no longer near player/trace
        targetFadeOpacity = 0
      } else {
        // Element should exist, apply camera-based rectangular vignette fade
        if (normalizedDistance > fadeStartMultiplier) {
          const fadeProgress = (normalizedDistance - fadeStartMultiplier) / (fadeEndMultiplier - fadeStartMultiplier)
          targetFadeOpacity = Math.max(0, 1 - fadeProgress)
        }
      }
      
      // Update target alpha for this element
      element.targetAlpha = targetFadeOpacity
      
      // Smoothly interpolate current alpha towards target
      if (element.sprite.alpha < element.targetAlpha) {
        element.sprite.alpha = Math.min(element.targetAlpha, element.sprite.alpha + element.fadeSpeed)
      } else if (element.sprite.alpha > element.targetAlpha) {
        element.sprite.alpha = Math.max(element.targetAlpha, element.sprite.alpha - element.fadeSpeed)
      }
      
      // Only remove elements that meet ALL these conditions:
      // 1. Fully faded out (alpha <= 0.01)
      // 2. Either: far from viewport (normalized distance > fadeEnd) OR shouldn't exist (not near player/trace)
      const isFarFromViewport = normalizedDistance > fadeEndMultiplier * 1.5
      if (element.sprite.alpha <= 0.01 && (isFarFromViewport || !shouldExist)) {
        this.groundContainer.removeChild(element.sprite)
        element.sprite.destroy()
        return false
      }
      return true
    })
  }

  destroy() {
    this.groundContainer.destroy({ children: true })
    this.particleContainer.destroy({ children: true })
    this.loadedTextures.clear()
  }
}
