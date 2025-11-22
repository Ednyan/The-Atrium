import * as PIXI from 'pixi.js'

export interface ThemeConfig {
  groundElements: string[] // Paths to ground element images
  particles: string[] // Paths to particle images
  particleCount: number // Number of floating particles
  groundDensity: number // Elements per 1000x1000 area
  particleColor?: number // Hex color for particles
  particlesEnabled?: boolean // Toggle particles
  groundEnabled?: boolean // Toggle ground elements
  groundElementScale?: number // Base scale for ground elements
  groundElementScaleRange?: number // Random scale variation range
  particleOpacity?: number // Opacity for floating particles (0-1)
  particleDensity?: number // Density multiplier for particles (0.1-3.0)
  groundParticleOpacity?: number // Opacity for ground particles (0-1)
  groundPatternMode?: 'grid' | 'random' // Placement pattern for ground elements
  gridSpacing?: number // Grid spacing in pixels for grid pattern mode (default 100)
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
  particleColor: 0xffffff,
  particlesEnabled: true,
  groundEnabled: true,
  groundElementScale: 0.0625,
  groundElementScaleRange: 0.025,
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
    
    // Disable mouse interaction on ground and particle containers
    this.groundContainer.eventMode = 'none'
    this.groundContainer.interactiveChildren = false
    this.particleContainer.eventMode = 'none'
    this.particleContainer.interactiveChildren = false
    
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
    
    // Only set default ground elements if not already set by custom URLs
    if (this.config.groundElements.length === 0) {
      this.config.groundElements = groundPaths
    }

    // Load textures for ground elements only
    for (const path of this.config.groundElements) {
      if (this.loadedTextures.has(path)) continue
      
      try {
        const texture = await PIXI.Texture.from(path)
        this.loadedTextures.set(path, texture)
      } catch (e) {
        console.warn(`Failed to load ground element: ${path}`)
      }
    }
    
    console.log(`🎨 Theme loaded: ${this.config.groundElements.length} ground elements`)
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
        }
      } catch (e) {
        // File doesn't exist, skip
      }
    }

    // Discovered ${discovered.length} ground elements
    return discovered
  }

  // Seeded random for consistent placement
  private seededRandom(x: number, y: number): number {
    const seed = this.seed + x * 12.9898 + y * 78.233
    return (Math.sin(seed) * 43758.5453123) % 1
  }

  generateGroundElements(minX: number, minY: number, maxX: number, maxY: number) {
    if (!this.config.groundEnabled) {
      return
    }
    
    if (this.config.groundElements.length === 0) {
      return
    }

    const patternMode = this.config.groundPatternMode ?? 'grid'
    const density = this.config.groundDensity / 10 // Adjusted density calculation
    const gridSize = this.config.gridSpacing ?? 100
    let created = 0

    if (patternMode === 'grid') {
      // GRID MODE: Use integer math for perfect coverage
      const startX = Math.ceil(minX / gridSize) * gridSize;
      const startY = Math.ceil(minY / gridSize) * gridSize;
      const endX = Math.floor(maxX / gridSize) * gridSize;
      const endY = Math.floor(maxY / gridSize) * gridSize;

      for (let x = startX; x <= endX; x += gridSize) {
        for (let y = startY; y <= endY; y += gridSize) {
          // Check if we already have an element at this exact position
          const exists = this.groundElements.some(
            el => el.worldX === x && el.worldY === y
          );
          if (!exists) {
            this.createGroundElement(x, y);
            created++;
          }
        }
      }
    } else {
      // RANDOM MODE: Grid-based with density and offsets (procedural)
      for (let x = Math.floor(minX / gridSize) * gridSize; x <= maxX; x += gridSize) {
        for (let y = Math.floor(minY / gridSize) * gridSize; y <= maxY; y += gridSize) {
          // Use seeded random to determine if element should exist at this grid point
          const rand = this.seededRandom(x, y)
          if (rand >= density) {
            continue
          }
          
          // Check if we already have an element at this grid position
          const exists = this.groundElements.some(
            el => el.worldX === x && el.worldY === y
          )
          
          if (!exists) {
            this.createGroundElement(x, y)
            created++
          }
        }
      }
    }
    
    // Silent generation - only log if there are issues
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
    
    // Apply offsets based on pattern mode
    const patternMode = this.config.groundPatternMode ?? 'grid'
    if (patternMode === 'grid') {
      // Perfect grid alignment - no offsets
      sprite.x = worldX
      sprite.y = worldY
    } else {
      // Random mode: add random offsets from grid position for procedural look
      const offsetRange = this.config.gridSpacing ? this.config.gridSpacing * 0.4 : 40
      const offsetX = (this.seededRandom(worldX * 1.1, worldY * 0.9) - 0.5) * offsetRange
      const offsetY = (this.seededRandom(worldX * 0.8, worldY * 1.2) - 0.5) * offsetRange
      sprite.x = worldX + offsetX
      sprite.y = worldY + offsetY
    }
    
    // Random scale using config values (always positive)
    const baseScale = this.config.groundElementScale ?? 0.0625
    const scaleRange = this.config.groundElementScaleRange ?? 0.025
    const scale = baseScale + this.seededRandom(worldX * 0.3, worldY * 0.6) * scaleRange
    sprite.scale.set(scale)
    
    // Start invisible for fade in
    sprite.alpha = 0

    this.groundContainer.addChild(sprite)
    
    // Use configured ground particle opacity
    const targetAlpha = this.config.groundParticleOpacity ?? 1.0
    // Store the GRID position (worldX, worldY) not sprite position for accurate tracking
    this.groundElements.push({ 
      sprite, 
      worldX: worldX,  // Store grid position, not sprite.x
      worldY: worldY,  // Store grid position, not sprite.y
      targetAlpha: targetAlpha,
      fadeSpeed: 0.02 // Fade in over ~50 frames
    })
  }

  createParticles(viewportWidth: number, viewportHeight: number) {
    // Clear existing particles
    this.particles.forEach(p => {
      this.particleContainer.removeChild(p.sprite)
      p.sprite.destroy()
    })
    this.particles = []

    if (!this.config.particlesEnabled) {
      console.log('✨ Particles disabled')
      return
    }

    const particleColor = this.config.particleColor ?? 0xffffff
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
      
      // Add glow effect with outer circle
      graphics.lineStyle(1, particleColor, 0.1)
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
      
      // Update target alpha for this element (multiply by configured opacity)
      const configuredOpacity = this.config.groundParticleOpacity ?? 1.0
      element.targetAlpha = targetFadeOpacity * configuredOpacity
      
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

  // Update theme configuration
  updateConfig(config: Partial<ThemeConfig>) {
    this.config = { ...this.config, ...config }
  }

  // Load custom ground element URLs
  async loadCustomGroundElements(urls: string[]) {
    if (!urls || urls.length === 0) {
      return
    }

    // Replace ground elements with custom URLs (completely replace, don't merge)
    this.config.groundElements = []

    // Clear ALL old textures
    this.loadedTextures.clear()

    // Load textures for custom URLs with CORS support
    const successCount = { count: 0 }
    const failedUrls: string[] = []

    for (const url of urls) {
      try {
        // Try method 1: Direct loading with CORS
        const img = new Image()
        img.crossOrigin = 'anonymous'
        
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Timeout')), 5000)
          img.onload = () => {
            clearTimeout(timeout)
            resolve(null)
          }
          img.onerror = () => {
            clearTimeout(timeout)
            reject(new Error('CORS blocked'))
          }
          img.src = url
        })

        const texture = await PIXI.Texture.from(img)
        
        // Verify texture is valid before adding
        if (texture && texture.valid) {
          this.loadedTextures.set(url, texture)
          this.config.groundElements.push(url)
          successCount.count++
        } else {
          throw new Error('Invalid texture')
        }
      } catch (firstError) {
        // Method 2: Try using proxy for CORS-blocked images
        try {
          const proxyUrl = `/api/proxy-image?url=${encodeURIComponent(url)}`
          
          const img = new Image()
          img.crossOrigin = 'anonymous'
          
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Timeout')), 10000)
            img.onload = () => {
              clearTimeout(timeout)
              resolve(null)
            }
            img.onerror = () => {
              clearTimeout(timeout)
              reject(new Error('Proxy failed'))
            }
            img.src = proxyUrl
          })

          const texture = await PIXI.Texture.from(img)
          
          if (texture && texture.valid) {
            // Store with original URL as key
            this.loadedTextures.set(url, texture)
            this.config.groundElements.push(url)
            successCount.count++
          } else {
            throw new Error('Invalid texture from proxy')
          }
        } catch (proxyError) {
          failedUrls.push(url)
          const directMsg = firstError instanceof Error ? firstError.message : String(firstError)
          const proxyMsg = proxyError instanceof Error ? proxyError.message : String(proxyError)
          console.error(`Failed to load: ${url}`, { direct: directMsg, proxy: proxyMsg })
        }
      }
    }

    // Loaded ${successCount.count}/${urls.length} ground elements
    
    if (failedUrls.length > 0) {
      console.warn(`⚠️ Failed to load ${failedUrls.length} ground element(s):`, failedUrls)
      const failedList = failedUrls.map(url => {
        const shortUrl = url.length > 50 ? url.substring(0, 50) + '...' : url
        return `• ${shortUrl}`
      }).join('\n')
      alert(`Failed to load ${failedUrls.length} ground image(s):\n\n${failedList}\n\nThe images may be completely inaccessible or the proxy failed.`)
    }
  }

  // Clear all ground elements (useful when disabling ground)
  clearGroundElements() {
    this.groundElements.forEach(element => {
      this.groundContainer.removeChild(element.sprite)
      element.sprite.destroy()
    })
    this.groundElements = []
  }
}
